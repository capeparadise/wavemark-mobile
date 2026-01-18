import { FN_BASE } from './fnBase';

export type ArtistMini = {
  id: string;
  name: string;
  url?: string | null;
  imageUrl?: string | null;
};

export async function artistSearch(q: string, market = 'GB', mode: 'loose'|'precise' = 'loose'): Promise<ArtistMini[]> {
  const r = await fetch(`${FN_BASE}/spotify-search/artist-search?` + new URLSearchParams({ q, market, mode }));
  if (!r.ok) return [];
  const data: any = await r.json();
  return (data.artists?.items ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    url: a.external_urls?.spotify ?? null,
    imageUrl: a.images?.[0]?.url ?? null,
  }));
}

export type ArtistAlbum = {
  id: string; title: string; artist: string;
  releaseDate?: string | null; releaseDatePrecision?: 'day' | 'month' | 'year' | string | null;
  spotifyUrl?: string | null; imageUrl?: string | null; type: 'album' | 'single' | 'ep';
  albumGroup?: 'album' | 'single' | 'appears_on' | 'compilation' | string;
};

const FN_ENV = process.env.EXPO_PUBLIC_FN_BASE ?? '';
const FN = FN_ENV || FN_BASE;

let tokenLogged = false;

async function spotifyFetch(url: string, init?: RequestInit) {
  const token = process.env.EXPO_PUBLIC_SPOTIFY_TOKEN || '';
  const hdrs = {
    ...(init?.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  } as Record<string, string>;
  if (__DEV__ && !tokenLogged) {
    // eslint-disable-next-line no-console
    console.log('[spotifyFetch] token attached:', !!token);
    tokenLogged = true;
  }
  const res = await fetch(url, { ...init, headers: hdrs });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const ctype = res.headers.get('content-type') || '';
    // eslint-disable-next-line no-console
    console.warn('[spotifyFetch] request failed', {
      url,
      status: res.status,
      hasToken: !!token,
      tokenPrefix: token ? token.slice(0, 12) : null,
      contentType: ctype,
      head: raw.slice(0, 120),
    });
    if (res.status === 429) {
      throw new Error('Spotify rate limited (429)');
    }
    if (res.status === 401) {
      throw new Error('Spotify unauthorized (401)');
    }
    if (ctype.includes('application/json')) {
      try { return new Response(raw, { status: res.status, headers: res.headers }); } catch {}
    }
    throw new Error(`Spotify request failed (${res.status})`);
  }
  return res;
}

export async function spotifyMe(): Promise<any | null> {
  try {
    const res = await spotifyFetch('https://api.spotify.com/v1/me');
    return await res.json();
  } catch {
    return null;
  }
}

export async function artistAlbums(artistId: string, market = 'GB'): Promise<ArtistAlbum[]> {
  const hasToken = !!process.env.EXPO_PUBLIC_SPOTIFY_TOKEN;
  const fetchWithInspect = async (url: string, allowRetry = true): Promise<{ items: any[]; total?: number | null }> => {
    const res = await fetch(url, {
      headers: process.env.EXPO_PUBLIC_SPOTIFY_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_PUBLIC_SPOTIFY_TOKEN}` }
        : undefined,
    });
    const raw = await res.text().catch(() => '');
    const ctype = res.headers.get('content-type') || '';
    // Always log the raw head for visibility
    // eslint-disable-next-line no-console
    console.warn('[artistAlbums] raw', { url, status: res.status, contentType: ctype, head: raw.slice(0, 140) });
    const isRateLimited = raw.trim().toLowerCase().startsWith('too many requests') || res.status === 429;
    if (!res.ok) {
      if (res.status === 401 && allowRetry) {
        // No refresh hook available here; bubble up after a single retry attempt.
        return fetchWithInspect(url, false);
      }
      if (res.status === 429) {
        throw new Error('Spotify rate limited (429)');
      }
      throw new Error(`Spotify artist albums failed (${res.status})`);
    }
    if (isRateLimited) {
      throw new Error('Spotify rate limited');
    }
    if (!ctype.includes('application/json')) {
      throw new Error(`Spotify artist albums invalid content (${ctype})`);
    }
    try {
      const parsed = JSON.parse(raw);
      const items = parsed?.items ?? parsed?.data?.items ?? parsed?.albums?.items ?? [];
      const total = parsed?.total ?? parsed?.data?.total ?? parsed?.albums?.total ?? null;
      return { items, total };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[artistAlbums] JSON parse error', { message: String(err), head: raw.slice(0, 120) });
      throw err;
    }
  };

  const mapItems = (items: any[]) => items.map((a: any) => {
    const totalTracks = typeof a?.total_tracks === 'number' ? a.total_tracks : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
    let type: 'album' | 'single' | 'ep';
    if ((a?.album_type ?? '').toLowerCase() === 'single') type = 'single';
    else if (totalTracks > 2 && totalTracks <= 6) type = 'ep';
    else type = 'album';
    const group = String(a?.album_group || '').toLowerCase();
    return {
      id: a.id,
      title: a.name,
      artist: a.artists?.[0]?.name ?? '',
      releaseDate: a.release_date ?? null,
      releaseDatePrecision: a.release_date_precision ?? null,
      spotifyUrl: a.external_urls?.spotify ?? null,
      imageUrl: a.images?.[0]?.url ?? null,
      type,
      albumGroup: group as any,
    };
  });

  const effectiveMarket = market === 'from_token' ? (hasToken ? 'from_token' : 'GB') : (market || 'GB');

  // Try direct Spotify API if a token is available, otherwise fall back to Supabase function
  const params = new URLSearchParams({
    include_groups: 'album,single,appears_on',
    market: effectiveMarket,
    limit: '50',
  });
  const directUrl = `https://api.spotify.com/v1/artists/${artistId}/albums?${params.toString()}`;

  if (hasToken) {
    try {
      const { items, total } = await fetchWithInspect(directUrl);
      const mapped = mapItems(items);
      (mapped as any)._total = total;
      return mapped;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[artistAlbums] direct Spotify fetch failed, falling back', { artistId, market, message: String(err) });
    }
  }

  try {
    const fnUrl = `${FN}/spotify-search/artist-albums?` + new URLSearchParams({ artistId, market: effectiveMarket }).toString();
    const r = await fetch(fnUrl);
    const raw = await r.text().catch(() => '');
    const ctype = r.headers.get('content-type') || '';
    // Always log the head for visibility
    // eslint-disable-next-line no-console
    console.warn('[artistAlbums:fn] raw', { url: fnUrl, status: r.status, contentType: ctype, head: raw.slice(0, 140) });
    const isRateLimited = raw.trim().toLowerCase().startsWith('too many requests') || r.status === 429;
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn('[artistAlbums] fn fetch failed', { artistId, market, status: r.status, contentType: ctype, head: raw.slice(0, 120) });
      throw new Error(`fn artist-albums failed (${r.status})`);
    }
    if (isRateLimited) {
      throw new Error('Spotify rate limited');
    }
    if (!ctype.includes('application/json')) {
      // eslint-disable-next-line no-console
      console.warn('[artistAlbums] fn non-JSON response', { artistId, market, status: r.status, contentType: ctype, head: raw.slice(0, 120) });
      throw new Error('fn artist-albums invalid content');
    }
    const data: any = JSON.parse(raw);
    const items = data?.items ?? data?.data?.items ?? data?.albums?.items ?? [];
    const total = data?.total ?? data?.data?.total ?? data?.albums?.total ?? null;
    const mapped = mapItems(items);
    (mapped as any)._total = total;
    if (__DEV__ && !items.length) {
      // eslint-disable-next-line no-console
      console.warn('[artistAlbums:fn] zero items parsed', { artistId, market: effectiveMarket, total });
    }
    return mapped;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[artistAlbums] unexpected error', { artistId, market, message: String(err) });
    throw err;
  }
}

export async function artistTopTracks(artistId: string, market = 'GB'): Promise<{
  id: string; title: string; artist: string; releaseDate?: string | null; spotifyUrl?: string | null;
}[]> {
  const r = await fetch(`${FN_BASE}/spotify-search/artist-top-tracks?` + new URLSearchParams({ artistId, market }));
  if (!r.ok) return [];
  const data: any = await r.json();
  return (data.tracks ?? []).map((t: any) => ({
    id: t.id,
    title: t.name,
    artist: t.artists?.[0]?.name ?? '',
    releaseDate: t.album?.release_date ?? null,
    spotifyUrl: t.external_urls?.spotify ?? null,
  }));
}

export async function relatedArtists(artistId: string): Promise<ArtistMini[]> {
  const r = await fetch(`${FN_BASE}/spotify-search/related?` + new URLSearchParams({ artistId }));
  if (!r.ok) return [];
  const data: any = await r.json();
  const items = data.artists ?? [];
  return items.map((a: any) => ({ id: a.id, name: a.name, url: a.external_urls?.spotify ?? null, imageUrl: a.images?.[0]?.url ?? null }));
}

export async function fetchArtistDetails(artistId: string): Promise<{ id: string; name: string; imageUrl?: string | null; followers?: number; genres?: string[] } | null> {
  const r = await fetch(`${FN_BASE}/spotify-search/artist?` + new URLSearchParams({ artistId }));
  if (!r.ok) return null;
  const a: any = await r.json();
  if (!a?.id) return null;
  return {
    id: a.id,
    name: a.name,
    imageUrl: a.images?.[0]?.url ?? null,
    followers: a.followers?.total ?? undefined,
    genres: Array.isArray(a.genres) ? a.genres : [],
  };
}
