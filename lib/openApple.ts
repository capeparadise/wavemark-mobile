// lib/openApple.ts
// Central open handler with simple in-memory cache and optional persistence.

import { Linking } from 'react-native';
import { resolveAppleTrackStrict, resolveAppleUrl } from './appleResolver';
import { debugNS } from './debug';
import { supabase } from './supabase';

const memCache = new Map<string,string>();
const debug = debugNS('openApple');

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

function appleUrlVariants(rawUrl: string, fallbackStorefront = 'gb'): string[] {
  const variants: string[] = [];
  try {
    const url = new URL(rawUrl.trim());
    if (url.hostname.endsWith('itunes.apple.com')) {
      url.hostname = url.hostname.replace('itunes.apple.com', 'music.apple.com');
    }
    if (!url.hostname.endsWith('music.apple.com')) return [rawUrl];

    const canonical = new URL(url.toString());
    canonical.protocol = 'https:';
    const parts = canonical.pathname.split('/').filter(Boolean);
    if (!parts[0] || parts[0].length !== 2) {
      parts.unshift(fallbackStorefront.toLowerCase());
      canonical.pathname = '/' + parts.join('/');
    }

    variants.push(canonical.toString());

    const clean = new URL(canonical.toString());
    clean.searchParams.delete('uo');
    variants.push(clean.toString());

    const noApp = new URL(clean.toString());
    noApp.searchParams.delete('app');
    variants.push(noApp.toString());

    const alt = new URL(noApp.toString());
    const altParts = alt.pathname.split('/').filter(Boolean);
    if (altParts[0]?.length === 2) {
      altParts[0] = altParts[0].toLowerCase() === 'us' ? 'gb' : 'us';
      alt.pathname = '/' + altParts.join('/');
      variants.push(alt.toString());
    }
  } catch {
    variants.push(rawUrl);
  }
  return unique(variants);
}

function hasCompleteAppleIds(opts: { itemType?: 'track' | 'album'; appleTrackId?: string | null; appleAlbumId?: string | null }) {
  return opts.itemType === 'album'
    ? !!opts.appleAlbumId
    : !!opts.appleTrackId && !!opts.appleAlbumId;
}

function trustedEdgeResolution(data: any) {
  if (!data?.url) return false;
  if (data.source === 'isrc') return true;
  if (data.source === 'upc') return true;
  return typeof data.confidence === 'number' && data.confidence >= 0.92;
}

async function safeOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch (e) {
    debug('open:fail', { url, error: (e as any)?.message ?? String(e) });
    return false;
  }
}

export async function openInApple(opts: {
  rowId?: string; // listen_list.id for caching/persisting
  appleUrl?: string | null;
  appleTrackId?: string | null;
  appleAlbumId?: string | null;
  isrc?: string | null;
  upc?: string | null;
  title?: string | null;
  artist?: string | null;
  storefront?: string | null;
  itemType?: 'track' | 'album';
}): Promise<boolean> {
  const key = opts.rowId;
  const remember = async (url: string) => {
    if (key) {
      memCache.set(key, url);
      try { await supabase.from('listen_list').update({ apple_url: url }).eq('id', key); } catch {}
    }
  };

  const openRemembered = async (url: string, storefront?: string | null) => {
    for (const candidate of appleUrlVariants(url, storefront || 'gb')) {
      if (await safeOpen(candidate)) {
        await remember(candidate);
        return true;
      }
    }
    return false;
  };

  if (key && memCache.has(key)) {
    const cached = memCache.get(key)!;
    if (hasCompleteAppleIds(opts)) {
      debug('cache:trustedHit', cached);
      if (await openRemembered(cached, opts.storefront || 'gb')) return true;
    } else {
      memCache.delete(key);
      debug('cache:dropUnvalidated', {
        hasTrackId: !!opts.appleTrackId,
        hasAlbumId: !!opts.appleAlbumId,
        itemType: opts.itemType,
      });
    }
  }

  if (opts.isrc) {
    const isrcResolved = await resolveAppleUrl({
      isrc: opts.isrc,
      storefront: (opts.storefront || 'gb').toLowerCase(),
      itemType: opts.itemType,
    });
    if (isrcResolved?.url) {
      if (await openRemembered(isrcResolved.url, opts.storefront || isrcResolved.storefront || 'gb')) return true;
    }
  }

  const storedUrl = opts.appleUrl?.trim();
  const hasTrustedStoredIdentity = !!storedUrl && hasCompleteAppleIds(opts);
  if (storedUrl && hasTrustedStoredIdentity) {
    const storedVariants = appleUrlVariants(storedUrl, opts.storefront || 'gb');
    debug('storedUrl:try', storedVariants);
    for (const candidate of storedVariants) {
      if (await safeOpen(candidate)) {
        await remember(candidate);
        return true;
      }
    }
  } else if (storedUrl) {
    debug('storedUrl:skipUnvalidated', {
      hasTrackId: !!opts.appleTrackId,
      hasAlbumId: !!opts.appleAlbumId,
      itemType: opts.itemType,
    });
  }

  const hasTrustedAppleIdentity = !!(opts.appleTrackId || opts.appleAlbumId || opts.isrc || opts.upc);
  const resolved = await resolveAppleUrl({
    appleTrackId: opts.appleTrackId ?? undefined,
    appleAlbumId: opts.appleAlbumId ?? undefined,
    isrc: opts.isrc ?? undefined,
    upc: opts.upc ?? undefined,
    title: opts.title ?? undefined,
    artist: opts.artist ?? undefined,
    storefront: (opts.storefront || 'gb').toLowerCase(),
  itemType: opts.itemType,
  });
  if (resolved?.url && !hasTrustedAppleIdentity && (resolved.confidence ?? 0) < 0.9) {
    debug('resolve:lowConfidence', { confidence: resolved.confidence, source: resolved.source });
    return false;
  }
  if (!resolved?.url) {
    debug('resolve:miss', { title: opts.title, artist: opts.artist });
    if (opts.title) {
      try {
        const { data } = await supabase.functions.invoke('apple-resolve', {
          body: {
            type: opts.itemType === 'album' ? 'album' : 'track',
            title: opts.title,
            artist: opts.artist ?? undefined,
            isrc: opts.isrc ?? undefined,
            upc: opts.upc ?? undefined,
          },
        });
        const resolvedUrl = trustedEdgeResolution(data) && typeof data?.url === 'string' ? data.url : null;
        if (resolvedUrl) {
          if (await openRemembered(resolvedUrl, opts.storefront || 'gb')) return true;
        } else if (data?.url) {
          debug('edgeResolve:lowConfidence', {
            source: data.source ?? null,
            confidence: data.confidence ?? null,
            matchReason: data.matchReason ?? null,
          });
        }
      } catch (e) {
        debug('edgeResolve:missFail', { error: (e as any)?.message ?? String(e) });
      }
    }
    return false;
  }

  // Guard: ensure artist matches (normalized) before using result.
  const norm = (s: string | null | undefined) => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const compress = (s: string | null | undefined) => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^0-9a-z]+/g,'');
  const wantArtist = norm(opts.artist);
  let gotArtist = norm(resolved.artistName);
  const wantArtistComp = compress(opts.artist);
  let gotArtistComp = compress(resolved.artistName);
  debug('resolve:artistCheck', { wantArtist, gotArtist, url: resolved.url });
  if (wantArtist && !hasTrustedAppleIdentity) {
    if (!gotArtist) {
      debug('resolve:artistUnknown', { wantArtist });
      // Strict fallback for track items with numeric / special artist formatting
      if (opts.itemType === 'track' && opts.title && opts.artist) {
        const strict = await resolveAppleTrackStrict(opts.title, opts.artist, (opts.storefront || 'gb'));
        if (strict?.url) {
          debug('resolve:strictArtist', { url: strict.url });
          resolved.url = strict.url; // replace
          resolved.trackId = strict.trackId;
          resolved.albumId = strict.albumId;
          resolved.artistName = strict.artistName;
          gotArtist = norm(strict.artistName);
          gotArtistComp = compress(strict.artistName);
          if (gotArtist) {
            // continue to variant construction
          } else {
            return false;
          }
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
    if (wantArtist !== gotArtist && !gotArtist.includes(wantArtist) && !wantArtist.includes(gotArtist)) {
      // Allow if compressed versions match (punctuation differences like 11:11 vs 11 11)
      if (wantArtistComp && gotArtistComp && wantArtistComp === gotArtistComp) {
        debug('resolve:artistLenientMatch', { wantArtistComp, gotArtistComp });
      } else if (resolved.trackId && resolved.albumId) {
        // If we have concrete IDs we trust them even if artist text differs (data shift, localized name etc.)
        debug('resolve:artistIDsOverride', { trackId: resolved.trackId, albumId: resolved.albumId });
      } else {
        debug('resolve:artistMismatch', { wantArtist, gotArtist });
        return false; // final block
      }
    }
  }

  // Build a small set of fallback variants to improve reliability in edge storefront/app cases.
  const variants: string[] = [];
  // Remove tracking param uo=4 if present for canonical cleanliness
  let base = resolved.url;
  try {
    const bu = new URL(base);
    if (bu.searchParams.has('uo')) {
      bu.searchParams.delete('uo');
      base = bu.toString();
    }
  } catch {}
  variants.push(...appleUrlVariants(base, opts.storefront || resolved.storefront || 'gb'));

  // Variant 2: same URL without app=music (some Apple Music installs behave better without it)
  try {
    const u = new URL(base);
    if (u.searchParams.has('app')) {
      u.searchParams.delete('app');
      variants.push(u.toString());
    }
  } catch {}

  // Variant 3: alternate storefront (toggle US/GB)
  try {
    const u = new URL(base);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0 && parts[0].length === 2) {
      const current = parts[0].toLowerCase();
      const alt = current === 'us' ? 'gb' : 'us';
      if (alt !== current) {
        parts[0] = alt;
        u.pathname = '/' + parts.join('/');
        variants.push(u.toString());
        // Also add the alt without app=music if present
        const u2 = new URL(u.toString());
        if (u2.searchParams.has('app')) {
          u2.searchParams.delete('app');
          variants.push(u2.toString());
        }
      }
    }
  } catch {}

  const openVariants = unique(variants);
  debug('open:variants', openVariants);

  for (const v of openVariants) {
    if (await safeOpen(v)) {
      await remember(v);
      return true;
    }
  }

  if (opts.title) {
    try {
      const { data } = await supabase.functions.invoke('apple-resolve', {
        body: {
          type: opts.itemType === 'album' ? 'album' : 'track',
          title: opts.title,
          artist: opts.artist ?? undefined,
          isrc: opts.isrc ?? undefined,
          upc: opts.upc ?? undefined,
        },
      });
      const resolvedUrl = trustedEdgeResolution(data) && typeof data?.url === 'string' ? data.url : null;
      if (resolvedUrl) {
        if (await openRemembered(resolvedUrl, opts.storefront || 'gb')) return true;
      } else if (data?.url) {
        debug('edgeResolve:lowConfidence', {
          source: data.source ?? null,
          confidence: data.confidence ?? null,
          matchReason: data.matchReason ?? null,
        });
      }
    } catch (e) {
      debug('edgeResolve:fail', { error: (e as any)?.message ?? String(e) });
    }
  }

  debug('open:allFailed');
  return false; // none of the variants opened; let caller fall back to Spotify
}
