import * as Localization from 'expo-localization';
import { FN_BASE, fetchFn } from './fnBase';
import { getMarketOverride } from './market';
import { type ReleaseTrack } from './releaseModel';

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
  artistIds?: string[];
  artistNames?: string[];
  isrc?: string | null;
  upc?: string | null;
  popularity?: number;
  followers?: number | null;
  totalTracks?: number | null;
  tracks?: ReleaseTrack[];
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

function mapSpotifyAlbumTracks(data: any): ReleaseTrack[] {
  const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
  return items
    .filter((track: any) => !!track?.name)
    .map((track: any) => ({
      id: track.id ?? null,
      provider: 'spotify' as const,
      providerId: track.id ?? null,
      title: track.name,
      artist: track.artists?.[0]?.name ?? null,
      trackNumber: typeof track.track_number === 'number' ? track.track_number : null,
      durationMs: typeof track.duration_ms === 'number' ? track.duration_ms : null,
      spotifyUrl: track.external_urls?.spotify ?? (track.id ? `https://open.spotify.com/track/${track.id}` : null),
      appleUrl: null,
    }));
}

function spotifyIdFromUri(uri?: string | null): string | null {
  if (!uri) return null;
  const match = String(uri).match(/^spotify:[^:]+:([A-Za-z0-9]+)$/);
  return match?.[1] ?? null;
}

function firstSpotifyArtistName(artists: any): string | null {
  const items = Array.isArray(artists?.items) ? artists.items : Array.isArray(artists) ? artists : [];
  const first = items[0];
  return first?.profile?.name ?? first?.name ?? null;
}

function firstSpotifyArtistId(artists: any): string | null {
  const items = Array.isArray(artists?.items) ? artists.items : Array.isArray(artists) ? artists : [];
  const first = items[0];
  return first?.id ?? spotifyIdFromUri(first?.uri) ?? null;
}

function spotifyArtistIds(artists: any): string[] {
  const items = Array.isArray(artists?.items) ? artists.items : Array.isArray(artists) ? artists : [];
  return items.map((artist: any) => artist?.id ?? spotifyIdFromUri(artist?.uri)).filter(Boolean).map(String);
}

function spotifyArtistNames(artists: any): string[] {
  const items = Array.isArray(artists?.items) ? artists.items : Array.isArray(artists) ? artists : [];
  return items.map((artist: any) => artist?.profile?.name ?? artist?.name).filter(Boolean).map(String);
}

function decodeBase64Utf8(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/[\r\n\s]/g, '');
  let binary = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '=') break;
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      binary += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  try {
    const chunks: string[] = [];
    for (let i = 0; i < binary.length; i += 2048) {
      const slice = binary.slice(i, i + 2048);
      let encoded = '';
      for (let j = 0; j < slice.length; j += 1) {
        encoded += `%${slice.charCodeAt(j).toString(16).padStart(2, '0')}`;
      }
      chunks.push(decodeURIComponent(encoded));
    }
    return chunks.join('');
  } catch {
    return binary;
  }
}

function mapSpotifyWebAlbum(data: any, albumId: string, fallback?: Partial<SpotifyResult>): SpotifyResult | null {
  const items = data?.entities?.items ?? {};
  const albumKey = `spotify:album:${albumId}`;
  const album = items[albumKey] ?? Object.values(items).find((item: any) => {
    return item?.id === albumId || item?.uri === albumKey;
  });
  if (!album) return null;

  const trackItems = Array.isArray(album?.tracksV2?.items) ? album.tracksV2.items : [];
  const tracks = trackItems
    .map((item: any): ReleaseTrack | null => {
      const track = item?.track ?? item;
      const trackId = track?.id ?? spotifyIdFromUri(track?.uri);
      const title = track?.name;
      if (!trackId || !title) return null;
      return {
        id: trackId,
        provider: 'spotify',
        providerId: trackId,
        title,
        artist: firstSpotifyArtistName(track?.artists) ?? fallback?.artist ?? null,
        trackNumber: typeof track?.trackNumber === 'number' ? track.trackNumber : null,
        durationMs: typeof track?.duration?.totalMilliseconds === 'number' ? track.duration.totalMilliseconds : null,
        spotifyUrl: `https://open.spotify.com/track/${trackId}`,
        appleUrl: null,
      };
    })
    .filter((track: ReleaseTrack | null): track is ReleaseTrack => track != null);

  const totalTracks =
    typeof album?.tracksV2?.totalCount === 'number'
      ? album.tracksV2.totalCount
      : (tracks.length || fallback?.totalTracks || null);
  const imageSources = Array.isArray(album?.coverArt?.sources) ? album.coverArt.sources : [];
  const largestImage = imageSources
    .slice()
    .sort((a: any, b: any) => (b?.width ?? 0) - (a?.width ?? 0))[0]?.url;
  const releaseDate =
    album?.date?.isoString?.slice?.(0, 10)
    ?? album?.releaseDate?.isoString?.slice?.(0, 10)
    ?? fallback?.releaseDate
    ?? null;

  return {
    id: album?.id ?? albumId,
    providerId: album?.id ?? albumId,
    provider: 'spotify',
    type: 'album',
    title: album?.name ?? fallback?.title ?? 'Untitled',
    artist: firstSpotifyArtistName(album?.artists) ?? fallback?.artist ?? '',
    releaseDate,
    spotifyUrl: `https://open.spotify.com/album/${album?.id ?? albumId}`,
    imageUrl: largestImage ?? fallback?.imageUrl ?? null,
    albumType: (album?.type ?? fallback?.albumType ?? null) as any,
    albumId: album?.id ?? albumId,
    artistId: firstSpotifyArtistId(album?.artists) ?? fallback?.artistId ?? null,
    artistIds: spotifyArtistIds(album?.artists),
    artistNames: spotifyArtistNames(album?.artists),
    isrc: null,
    upc: fallback?.upc ?? null,
    totalTracks,
    tracks,
  };
}

async function spotifyWebAlbumLookup(albumId: string, fallback?: Partial<SpotifyResult>): Promise<SpotifyResult | null> {
  const res = await fetch(`https://open.spotify.com/album/${encodeURIComponent(albumId)}`, {
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/<script[^>]+id=["']initialState["'][^>]*>([^<]+)/);
  if (!match?.[1]) return null;
  const state = JSON.parse(decodeBase64Utf8(match[1]));
  return mapSpotifyWebAlbum(state, albumId, fallback);
}

export async function spotifyLookup(id: string, lookupType: 'album' | 'track'): Promise<SpotifyResult[]> {
  const market = getMarket();
  const res = await fetchFn(`${FN}/spotify-search/lookup?` + new URLSearchParams({ id, lookupType, market }));
  if (!res.ok) throw new Error('Spotify lookup failed');
  const data: any = await res.json();
  if (lookupType === 'album') {
    const tracks = mapSpotifyAlbumTracks(data);
    const totalTracks = typeof data.total_tracks === 'number' ? data.total_tracks : (tracks.length || null);
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
  artistIds: spotifyArtistIds(data.artists),
  artistNames: spotifyArtistNames(data.artists),
  isrc: null,
  upc: data.external_ids?.upc ?? null,
  totalTracks,
  tracks,
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
  isrc: data.external_ids?.isrc ?? null,
  upc: data.album?.external_ids?.upc ?? null,
  totalTracks: 1,
    }];
  }
}

export async function spotifyResolveRelease(
  type: 'album' | 'track',
  title: string,
  artist?: string | null
): Promise<SpotifyResult | null> {
  const res = await fetchFn(`${FN}/spotify-resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, title, artist: artist || undefined }),
  });
  if (!res.ok) throw new Error('Spotify resolve failed');
  const data: any = await res.json();
  const detail = data?.detail ?? null;
  const source = detail || data;
  if (!source?.id && !data?.id) return null;

  if (type === 'album') {
    const albumData = detail || source;
    const tracks = mapSpotifyAlbumTracks(albumData);
    const totalTracks = typeof albumData?.total_tracks === 'number' ? albumData.total_tracks : (tracks.length || null);
    const albumResult: SpotifyResult = {
      id: albumData.id ?? data.id,
      providerId: albumData.id ?? data.id,
      provider: 'spotify',
      type: 'album',
      title: albumData.name ?? title,
      artist: albumData.artists?.[0]?.name ?? artist ?? '',
      releaseDate: albumData.release_date ?? null,
      spotifyUrl: albumData.external_urls?.spotify ?? data.url ?? null,
      imageUrl: albumData.images?.[0]?.url ?? null,
      albumType: (albumData.album_type ?? null) as any,
      albumId: albumData.id ?? data.id ?? null,
      artistId: albumData.artists?.[0]?.id ?? null,
      isrc: null,
      upc: albumData.external_ids?.upc ?? null,
      totalTracks,
      tracks,
    };
    if (tracks.length < 2) {
      const webResult = await spotifyWebAlbumLookup(albumResult.id, albumResult).catch(() => null);
      if (webResult?.tracks?.length) return webResult;
    }
    return albumResult;
  }

  const trackData = detail || source;
  return {
    id: trackData.id ?? data.id,
    providerId: trackData.id ?? data.id,
    provider: 'spotify',
    type: 'track',
    title: trackData.name ?? title,
    artist: trackData.artists?.[0]?.name ?? artist ?? '',
    releaseDate: trackData.album?.release_date ?? null,
    spotifyUrl: trackData.external_urls?.spotify ?? data.url ?? null,
    imageUrl: trackData.album?.images?.[0]?.url ?? null,
    albumId: trackData.album?.id ?? null,
    artistId: trackData.artists?.[0]?.id ?? null,
    isrc: trackData.external_ids?.isrc ?? null,
    upc: trackData.album?.external_ids?.upc ?? null,
    totalTracks: 1,
  };
}

export async function spotifySearch(q: string, types: string = 'album,track,artist'): Promise<SpotifyResult[]> {
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
  const params = new URLSearchParams({ q, type: types, market });
  // eslint-disable-next-line no-console
  console.log('[spotifySearch:req]', { q, types, url: `${FN}/spotify-search?${params.toString()}` });
  const res = await fetchFn(`${FN}/spotify-search?` + params);
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    // eslint-disable-next-line no-console
    console.warn('[spotifySearch]', res.status, t.slice(0, 200));
    throw new Error('Spotify search failed');
  }
  const data: any = await res.json();
  // eslint-disable-next-line no-console
  console.log('[spotifySearch:resp]', {
    keys: Object.keys(data || {}),
    artists: data?.artists?.items?.length ?? 0,
    tracks: data?.tracks?.items?.length ?? 0,
    albums: data?.albums?.items?.length ?? 0,
  });

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
      isrc: t.external_ids?.isrc ?? null,
      popularity: t.popularity ?? 0,
      totalTracks: 1,
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
      isrc: null,
      upc: a.external_ids?.upc ?? null,
      popularity: a.popularity ?? 0,
      totalTracks: typeof a.total_tracks === 'number' ? a.total_tracks : null,
    });
  }
  for (const ar of data.artists?.items ?? []) {
    out.push({
      id: ar.id, providerId: ar.id, provider: 'spotify',
      type: 'artist', title: ar.name,
      imageUrl: ar.images?.[0]?.url ?? null,
      spotifyUrl: ar.external_urls?.spotify ?? null,
      artistId: ar.id ?? null,
      popularity: ar.popularity ?? 0,
      followers: typeof ar.followers?.total === 'number' ? ar.followers.total : null,
    });
  }
  return out;
}
