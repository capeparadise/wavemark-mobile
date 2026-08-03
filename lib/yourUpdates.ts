import type { ArtistAlbum } from './spotifyArtist';
import {
  discoverReleaseDateTimestamp,
  isDiscoverReleaseDateEligible,
} from './discoverFreshness';

export type UpdateArtist = { id: string; name: string };

export type YourUpdatesRelease = {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  releaseDate?: string | null;
  spotifyUrl?: string | null;
  imageUrl?: string | null;
  type?: 'album' | 'single' | 'ep';
  creditedArtists?: UpdateArtist[];
  responsibleArtistIds?: string[];
  followedBecauseArtists?: UpdateArtist[];
};

export type FollowedCatalog = {
  followedArtist: UpdateArtist;
  releases: ArtistAlbum[];
};

const validSpotifyId = (value?: string | null) => (
  typeof value === 'string' && /^[A-Za-z0-9]{22}$/.test(value)
);

export function canonicalSpotifyReleaseId(id?: string | null, spotifyUrl?: string | null): string | null {
  const urlMatch = spotifyUrl?.match(/open\.spotify\.com\/album\/([A-Za-z0-9]{22})/i);
  if (urlMatch?.[1]) return urlMatch[1];
  return validSpotifyId(id) ? id! : null;
}

function uniqueArtists(artists: UpdateArtist[]): UpdateArtist[] {
  const seen = new Set<string>();
  return artists.filter((artist) => {
    if (!artist.id || !artist.name || seen.has(artist.id)) return false;
    seen.add(artist.id);
    return true;
  });
}

function creditsForAlbum(album: ArtistAlbum): UpdateArtist[] {
  const ids = Array.isArray(album.artistIds) ? album.artistIds : [];
  const names = Array.isArray(album.artistNames) ? album.artistNames : [];
  return uniqueArtists(ids.map((id, index) => ({ id, name: names[index] || '' })));
}

function isAllowedCatalogRelease(album: ArtistAlbum, responsibleArtistId: string, cutoffTs: number): boolean {
  const canonicalId = canonicalSpotifyReleaseId(album.id, album.spotifyUrl ?? null);
  if (!canonicalId || !isDiscoverReleaseDateEligible(album.releaseDate ?? null, {
    cutoffTs,
    precision: album.releaseDatePrecision ?? null,
  })) return false;

  const albumType = String(album.albumType || '').toLowerCase();
  const albumGroup = String(album.albumGroup || '').toLowerCase();
  if (albumType === 'compilation' || albumGroup === 'compilation' || albumGroup === 'appears_on') return false;
  if (album.spotifyUrl && !/open\.spotify\.com\/album\//i.test(album.spotifyUrl)) return false;
  return (album.artistIds || []).includes(responsibleArtistId);
}

function releaseType(album: ArtistAlbum): 'album' | 'single' | 'ep' {
  if (album.type === 'ep') return 'ep';
  if (album.type === 'single' || String(album.albumType).toLowerCase() === 'single') return 'single';
  return 'album';
}

export function finalizeYourUpdates(
  releases: YourUpdatesRelease[],
  followedArtists: UpdateArtist[],
  cutoffTs: number
): YourUpdatesRelease[] {
  const followedNameById = new Map(followedArtists.map((artist) => [artist.id, artist.name]));
  const followedIds = new Set(followedNameById.keys());
  const byRelease = new Map<string, YourUpdatesRelease>();

  releases.forEach((release) => {
    const id = canonicalSpotifyReleaseId(release.id, release.spotifyUrl ?? null);
    if (!id || !isDiscoverReleaseDateEligible(release.releaseDate ?? null, { cutoffTs })) return;

    const responsibleArtistIds = Array.from(new Set(
      (release.responsibleArtistIds || []).filter((artistId) => followedIds.has(artistId))
    ));
    if (!responsibleArtistIds.length) return;

    const existing = byRelease.get(id);
    if (existing) {
      existing.responsibleArtistIds = Array.from(new Set([
        ...(existing.responsibleArtistIds || []),
        ...responsibleArtistIds,
      ]));
      existing.creditedArtists = uniqueArtists([
        ...(existing.creditedArtists || []),
        ...(release.creditedArtists || []),
      ]);
      return;
    }

    byRelease.set(id, {
      ...release,
      id,
      creditedArtists: uniqueArtists(release.creditedArtists || []),
      responsibleArtistIds,
      followedBecauseArtists: [],
    });
  });

  return Array.from(byRelease.values())
    .map((release) => {
      const primary = release.creditedArtists?.[0] ?? null;
      const primaryIsFollowed = !!primary?.id && followedIds.has(primary.id);
      const collaboratorIds = new Set((release.responsibleArtistIds || []).filter((id) => id !== primary?.id));
      const followedBecauseArtists = primaryIsFollowed
        ? []
        : uniqueArtists((release.creditedArtists || []).filter((artist) => collaboratorIds.has(artist.id)))
          .map((artist) => ({ ...artist, name: artist.name || followedNameById.get(artist.id) || '' }))
          .filter((artist) => !!artist.name);

      return {
        ...release,
        artist: primary?.name || release.artist,
        artistId: primary?.id || release.artistId || null,
        followedBecauseArtists,
      };
    })
    .sort((a, b) => (
      discoverReleaseDateTimestamp(b.releaseDate ?? null) -
      discoverReleaseDateTimestamp(a.releaseDate ?? null)
    ));
}

export function buildYourUpdatesFromCatalogs(
  catalogs: FollowedCatalog[],
  followedArtists: UpdateArtist[],
  cutoffTs: number
): YourUpdatesRelease[] {
  const candidates: YourUpdatesRelease[] = [];

  catalogs.forEach(({ followedArtist, releases }) => {
    releases.forEach((album) => {
      if (!isAllowedCatalogRelease(album, followedArtist.id, cutoffTs)) return;
      const id = canonicalSpotifyReleaseId(album.id, album.spotifyUrl ?? null);
      if (!id) return;
      const creditedArtists = creditsForAlbum(album);
      const primary = creditedArtists[0] ?? followedArtist;
      candidates.push({
        id,
        title: album.title,
        artist: primary.name || album.artist || followedArtist.name,
        artistId: primary.id || null,
        releaseDate: album.releaseDate ?? null,
        spotifyUrl: album.spotifyUrl ?? null,
        imageUrl: album.imageUrl ?? null,
        type: releaseType(album),
        creditedArtists,
        responsibleArtistIds: [followedArtist.id],
        followedBecauseArtists: [],
      });
    });
  });

  return finalizeYourUpdates(candidates, followedArtists, cutoffTs);
}

export function isReleaseStillFollowed(release: YourUpdatesRelease, followedIds: Set<string>): boolean {
  return (release.responsibleArtistIds || []).some((artistId) => followedIds.has(artistId));
}
