import * as Localization from 'expo-localization';
import { FN_BASE } from './fnBase';
import { getMarketOverride } from './market';

export type SpotifyResult = {
  id: string;              // Spotify id
  providerId: string;      // same as id (explicit)
  provider: 'spotify';
  type: 'track' | 'album' | 'artist';
  title: string;
  artist?: string;
  releaseDate?: string | null;
  spotifyUrl?: string | null;
  imageUrl?: string | null;
  albumType?: 'album' | 'single' | 'compilation';
  albumId?: string | null;   // for tracks (parent album), for albums (same as id)
  artistId?: string | null;  // primary artist id when available
};

// Use centralized base (with safe fallback)
const FN_BASE_ENV = process.env.EXPO_PUBLIC_FN_BASE ?? '';
const FN = FN_BASE_ENV || FN_BASE;

export function getMarket(): string {
  const ov = getMarketOverride();
  if (ov) return ov;
  try {
    const anyLoc = Localization as any;
    const locales = typeof anyLoc.getLocales === 'function' ? anyLoc.getLocales() : [];
    if (locales && locales.length) {
      const l = locales[0] || {};
      const country = String(l.region ?? l.country ?? '').toUpperCase();
      if (country) return country;
    }
    const locale: string = String(anyLoc.locale ?? '');
    const inferred = (locale.split('-')[1] || '').toUpperCase();
    if (inferred) return inferred;
  } catch {}
  // Fallback to GB
  return 'GB';
}

// If user pasted a URL or raw ID, pull id + type
export function parseSpotifyUrlOrId(input: string): { id: string; lookupType: 'album' | 'track' } | null {
  const trimmed = input.trim();
  // spotify url forms
  const m1 = trimmed.match(/open\.spotify\.com\/(album|track)\/([A-Za-z0-9]+)/i);
  if (m1) return { lookupType: m1[1].toLowerCase() as 'album'|'track', id: m1[2] };
  // spotify uri forms
  const m2 = trimmed.match(/^spotify:(album|track):([A-Za-z0-9]+)$/i);
  if (m2) return { lookupType: m2[1].toLowerCase() as 'album'|'track', id: m2[2] };
  // raw 22-char ids — default to album first (we’ll try both in Discover if needed)
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) {
    return { lookupType: 'album', id: trimmed };
  }
  return null;
}

export async function spotifyLookup(id: string, lookupType: 'album' | 'track'): Promise<SpotifyResult[]> {
  const market = getMarket();
  const res = await fetch(`${FN}/spotify-search/lookup?` + new URLSearchParams({ id, lookupType, market }));
  if (!res.ok) throw new Error('Spotify lookup failed');
  const data: any = await res.json();
  if (lookupType === 'album') {
    return [{
      id: data.id,
      providerId: data.id,
      provider: 'spotify',
      type: 'album',
      title: data.name,
      artist: data.artists?.[0]?.name ?? '',
      releaseDate: data.release_date ?? null,
      spotifyUrl: data.external_urls?.spotify ?? null,
  imageUrl: data.images?.[0]?.url ?? null,
  albumType: (data.album_type ?? null) as any,
  albumId: data.id ?? null,
  artistId: data.artists?.[0]?.id ?? null,
    }];
  } else {
    return [{
      id: data.id,
      providerId: data.id,
      provider: 'spotify',
      type: 'track',
      title: data.name,
      artist: data.artists?.[0]?.name ?? '',
      releaseDate: data.album?.release_date ?? null,
      spotifyUrl: data.external_urls?.spotify ?? null,
  imageUrl: data.album?.images?.[0]?.url ?? null,
  albumId: data.album?.id ?? null,
  artistId: data.artists?.[0]?.id ?? null,
    }];
  }
}

export async function spotifySearch(q: string): Promise<SpotifyResult[]> {
  const direct = parseSpotifyUrlOrId(q);
  if (direct) {
    try {
      return await spotifyLookup(direct.id, direct.lookupType);
    } catch {
      // If we guessed album for a raw id, try track
      if (!q.includes(':') && !q.includes('open.spotify.com') && direct.lookupType === 'album') {
        return spotifyLookup(direct.id, 'track');
  }
  // Re-throw a generic error to satisfy TS/ES
  throw new Error('Spotify lookup failed');
    }
  }

  const market = getMarket();
  const res = await fetch(`${FN}/spotify-search?` + new URLSearchParams({
    q, type: 'album,track,artist', market
  }));
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    // eslint-disable-next-line no-console
    console.warn('[spotifySearch]', res.status, t.slice(0, 200));
    throw new Error('Spotify search failed');
  }
  const data: any = await res.json();

  const out: SpotifyResult[] = [];
  for (const t of data.tracks?.items ?? []) {
    out.push({
      id: t.id, providerId: t.id, provider: 'spotify',
      type: 'track', title: t.name,
      artist: t.artists?.[0]?.name ?? '',
      releaseDate: t.album?.release_date ?? null,
      spotifyUrl: t.external_urls?.spotify ?? null,
  imageUrl: t.album?.images?.[0]?.url ?? null,
  albumId: t.album?.id ?? null,
  artistId: t.artists?.[0]?.id ?? null,
    });
  }
  for (const a of data.albums?.items ?? []) {
    out.push({
      id: a.id, providerId: a.id, provider: 'spotify',
      type: 'album', title: a.name,
      artist: a.artists?.[0]?.name ?? '',
      releaseDate: a.release_date ?? null,
      spotifyUrl: a.external_urls?.spotify ?? null,
  imageUrl: a.images?.[0]?.url ?? null,
  albumType: (a.album_type ?? null) as any,
  albumId: a.id ?? null,
  artistId: a.artists?.[0]?.id ?? null,
    });
  }
  for (const ar of data.artists?.items ?? []) {
    out.push({
      id: ar.id, providerId: ar.id, provider: 'spotify',
      type: 'artist', title: ar.name,
      spotifyUrl: ar.external_urls?.spotify ?? null,
  artistId: ar.id ?? null,
    });
  }
  return out;
}
