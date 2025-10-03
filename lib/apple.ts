// app/lib/apple.ts
// Tiny wrapper around the iTunes Search/Lookup API for our needs.

const ITUNES = "https://itunes.apple.com";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

/** Basic artist shape we use in the app */
export type AppleArtist = {
  artistId: number;
  name: string;
  primaryGenreName?: string;
  amgArtistId?: number;
  thumbUrl?: string | null; // we fill via getArtistThumb
};

// Legacy alias used by some app files
export type ArtistResult = AppleArtist;

/** Track (song) */
export type AppleTrack = {
  trackId: number;
  trackName: string;
  artistName: string;
  artistId: number;
  collectionName?: string | null;
  releaseDate?: string;
  artworkUrl: string; // normalized to 100px URL
  previewUrl?: string | null;
};

// Some callers expect releaseDate and releaseType
export type AppleTrackLegacy = AppleTrack & { releaseDate?: string; releaseType?: string };

/** Album / collection */
export type AppleAlbum = {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artistId: number;
  releaseDate?: string;
  artworkUrl: string; // normalized to 100px URL
};

// Provide releaseType for compatibility (album vs ep)
export type AppleAlbumLegacy = AppleAlbum & { releaseType?: 'album' | 'ep' };

function normalizeArt(url?: string | null): string {
  // Apple returns artworkUrl100 / 60 / etc. Normalize to 100px if present.
  if (!url) return "";
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/100x100bb.$1");
}

/**
 * Search artists by name.
 */
export async function searchArtists(term: string): Promise<AppleArtist[]> {
  const url = `${ITUNES}/search?media=music&entity=musicArtist&limit=25&term=${encodeURIComponent(
    term
  )}`;
  const data = await fetchJSON<{ results: any[] }>(url);
  const artists: AppleArtist[] = (data.results ?? [])
    .filter((r) => r.wrapperType === "artist")
    .map((r) => ({
      artistId: r.artistId,
      name: r.artistName,
      primaryGenreName: r.primaryGenreName,
      amgArtistId: r.amgArtistId,
      thumbUrl: null,
    }));
  return artists;
}

/**
 * Quick “thumbnail": take the first album’s artwork for an artist.
 */
export async function getArtistThumb(artistId: number): Promise<string | null> {
  const url = `${ITUNES}/lookup?id=${artistId}&entity=album&limit=1`;
  const data = await fetchJSON<{ results: any[] }>(url);
  const album = (data.results ?? []).find((r) => r.wrapperType === "collection");
  return album ? normalizeArt(album.artworkUrl100) : null;
}

/**
 * Fetch a single artist’s basic info by artistId (lookup).
 */
export async function fetchArtistById(artistId: number): Promise<AppleArtist | null> {
  const url = `${ITUNES}/lookup?id=${artistId}`;
  const data = await fetchJSON<{ results: any[] }>(url);
  const r = (data.results ?? []).find((x) => x.wrapperType === "artist");
  if (!r) return null;
  return {
    artistId: r.artistId,
    name: r.artistName,
    primaryGenreName: r.primaryGenreName,
    amgArtistId: r.amgArtistId,
    thumbUrl: await getArtistThumb(artistId),
  };
}

/**
 * Top tracks for an artist (best-effort: first N songs from lookup).
 */
export async function fetchTopTracks(
  artistId: number,
  limit = 25
): Promise<AppleTrack[]> {
  const url = `${ITUNES}/lookup?id=${artistId}&entity=song&limit=${limit}`;
  const data = await fetchJSON<{ results: any[] }>(url);
  return (data.results ?? [])
    .filter((r) => r.wrapperType === "track")
    .map((r) => ({
      trackId: r.trackId,
      trackName: r.trackName,
      artistName: r.artistName,
      artistId: r.artistId,
      collectionName: r.collectionName ?? null,
      releaseDate: r.releaseDate,
      artworkUrl: normalizeArt(r.artworkUrl100),
      previewUrl: r.previewUrl ?? null,
    }));
}

// Compatibility helpers expected by app/artist code
export async function getArtistTracks(artistId: number): Promise<AppleTrack[]> {
  return await fetchTopTracks(artistId, 50);
}

export async function getArtistAlbums(artistId: number): Promise<AppleAlbum[]> {
  return await fetchAllAlbums(artistId);
}

/**
 * Albums / EPs by type. Apple doesn’t give a perfect flag for EPs,
 * so we approximate: if collectionName contains “EP” → EP.
 * For “album” we exclude names that end with “- Single” or contain “EP”.
 */
export async function fetchAlbumsByType(
  artistId: number,
  type: "album" | "ep"
): Promise<AppleAlbum[]> {
  const url = `${ITUNES}/lookup?id=${artistId}&entity=album&limit=200`;
  const data = await fetchJSON<{ results: any[] }>(url);
  let albums = (data.results ?? [])
    .filter((r) => r.wrapperType === "collection")
    .map((r) => ({
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      artistName: r.artistName,
      artistId: r.artistId,
      releaseDate: r.releaseDate,
      artworkUrl: normalizeArt(r.artworkUrl100),
    })) as AppleAlbum[];

  if (type === "ep") {
    albums = albums.filter((a) => /(^|\s)EP(\s|$)/i.test(a.collectionName));
  } else {
    // "album" → filter out EPs and singles
    albums = albums.filter(
      (a) => !/(^|\s)EP(\s|$)/i.test(a.collectionName) && !/ - Single$/i.test(a.collectionName)
    );
  }
  return albums;
}

/** Albums (no filtering), if you need everything later */
export async function fetchAllAlbums(artistId: number): Promise<AppleAlbum[]> {
  const url = `${ITUNES}/lookup?id=${artistId}&entity=album&limit=200`;
  const data = await fetchJSON<{ results: any[] }>(url);
  return (data.results ?? [])
    .filter((r) => r.wrapperType === "collection")
    .map((r) => ({
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      artistName: r.artistName,
      artistId: r.artistId,
      releaseDate: r.releaseDate,
      artworkUrl: normalizeArt(r.artworkUrl100),
    }));
}
