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
  releaseDate?: string | null; spotifyUrl?: string | null; imageUrl?: string | null; type: 'album' | 'single' | 'ep';
  albumGroup?: 'album' | 'single' | 'appears_on' | 'compilation' | string;
};

export async function artistAlbums(artistId: string, market = 'GB'): Promise<ArtistAlbum[]> {
  const r = await fetch(`${FN_BASE}/spotify-search/artist-albums?` + new URLSearchParams({ artistId, market }));
  if (!r.ok) return [];
  const data: any = await r.json();
  const items = data.items ?? [];
  return items.map((a: any) => {
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
      spotifyUrl: a.external_urls?.spotify ?? null,
      imageUrl: a.images?.[0]?.url ?? null,
      type,
      albumGroup: group as any,
    };
  });
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
