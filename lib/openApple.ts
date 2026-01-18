// lib/openApple.ts
// Central open handler with simple in-memory cache and optional persistence.

import { Linking } from 'react-native';
import { resolveAppleTrackStrict, resolveAppleUrl } from './appleResolver';
import { debugNS } from './debug';
import { supabase } from './supabase';

const memCache = new Map<string,string>();
const debug = debugNS('openApple');

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
  appleTrackId?: string | null;
  appleAlbumId?: string | null;
  isrc?: string | null;
  title?: string | null;
  artist?: string | null;
  storefront?: string | null;
  itemType?: 'track' | 'album';
}): Promise<boolean> {
  const key = opts.rowId;
  if (key && memCache.has(key)) {
    const cached = memCache.get(key)!;
    debug('cache:hit', cached);
    return await safeOpen(cached);
  }
  const resolved = await resolveAppleUrl({
    appleTrackId: opts.appleTrackId ?? undefined,
    appleAlbumId: opts.appleAlbumId ?? undefined,
    isrc: opts.isrc ?? undefined,
    title: opts.title ?? undefined,
    artist: opts.artist ?? undefined,
    storefront: (opts.storefront || 'gb').toLowerCase(),
  itemType: opts.itemType,
  });
  if (!resolved?.url) {
    debug('resolve:miss', { title: opts.title, artist: opts.artist });
    return false; // avoid opening generic homepage which confuses user
  }

  // Guard: ensure artist matches (normalized) before using result.
  const norm = (s: string | null | undefined) => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const compress = (s: string | null | undefined) => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^0-9a-z]+/g,'');
  const wantArtist = norm(opts.artist);
  const gotArtist = norm(resolved.artistName);
  const wantArtistComp = compress(opts.artist);
  const gotArtistComp = compress(resolved.artistName);
  debug('resolve:artistCheck', { wantArtist, gotArtist, url: resolved.url });
  if (wantArtist) {
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
          // Recompute gotArtist
          const newGot = norm(strict.artistName);
          if (newGot) {
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
  variants.push(base);

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

  debug('open:variants', variants);

  for (const v of variants) {
    if (await safeOpen(v)) {
      if (key) {
        memCache.set(key, v);
        try { await supabase.from('listen_list').update({ apple_url: v }).eq('id', key); } catch {}
      }
      return true;
    }
  }

  debug('open:allFailed');
  return false; // none of the variants opened; let caller fall back to Spotify
}