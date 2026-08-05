// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const BUILD_ID = "2026-02-16-1";
const addBuildHeader = (headers: Record<string, string> = {}) => {
  const expose = headers["Access-Control-Expose-Headers"];
  const exposeExtra = "X-Spotify-Search-Build, X-Spotify-Browse-Status";
  const exposeValue = expose
    ? (expose.includes(exposeExtra) ? expose : `${expose}, ${exposeExtra}`)
    : exposeExtra;
  return {
    ...headers,
    "X-Spotify-Search-Build": BUILD_ID,
    "Access-Control-Expose-Headers": exposeValue,
  };
};
const fetchWithTimeout = async (input: string, init: RequestInit, timeoutMs: number, stage: string) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    const err: any = new Error(`fetch failed/timeout at ${stage}`);
    err.stage = stage;
    err.causeName = (e as any)?.name;
    err.causeMessage = (e as any)?.message;
    throw err;
  } finally {
    clearTimeout(t);
  }
};

const VARIANT_KEYWORDS = [
  "official music video",
  "music video",
  "official video",
  "video",
  "extended version",
  "part 1",
  "part 2",
  "remix",
  "acoustic",
  "extended",
  "edit",
  "radio edit",
  "live",
  "sped up",
  "slowed",
  "instrumental",
  "karaoke",
  "demo",
  "clean",
  "explicit",
  "version",
  "mix",
  "rework",
  "alt",
  "deluxe",
];
const UNICODE_DASH_RE = /[\u2012\u2013\u2014\u2015\u2212]/g;
const BRACKET_CONTENT_RE = /\([^)]*\)|\[[^\]]*\]/g;
const VARIANT_PART_RE = /\b(part\s*[0-9]+|pt\.?\s*[0-9]+)\b/;
const hasVariantKeyword = (input?: string | null): boolean => {
  const s = String(input ?? "").toLowerCase();
  if (!s) return false;
  const normalized = s.replace(UNICODE_DASH_RE, "-");
  if (VARIANT_PART_RE.test(normalized)) return true;
  return VARIANT_KEYWORDS.some((k) => normalized.includes(k));
};
const hasBracketContent = (input?: string | null): boolean => {
  const s = String(input ?? "");
  return /[\(\[].*?[\)\]]/.test(s);
};
const canonicalTitle = (title?: string | null): string => {
  const raw = String(title ?? "").toLowerCase().replace(UNICODE_DASH_RE, "-");
  if (!raw) return "";
  let normalized = raw;
  normalized = normalized.replace(BRACKET_CONTENT_RE, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();

  const dashParts = normalized.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length > 1) {
    const suffix = dashParts.slice(1).join(" ");
    if (hasVariantKeyword(suffix)) {
      normalized = dashParts[0];
    }
  }

  if (hasVariantKeyword(normalized)) {
    normalized = normalized
      .replace(
        /\b(official music video|music video|official video|video|extended version|part\s*[0-9]+|pt\.?\s*[0-9]+|version|edit|remix|acoustic|live|sped up|slowed|instrumental|karaoke|demo|clean|explicit|mix|rework)\b/g,
        " ",
      );
  }

  normalized = normalized.replace(/[.,/#!$%^&*;:{}=_`~"'|?<>+]/g, " ");
  normalized = normalized.replace(/\s*-\s*/g, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
};
const isTrackItem = (item: any): boolean => (
  item?.normalizedType === "track" || item?.sourceType === "track" || item?.type === "track"
);
const isAlbumItem = (item: any): boolean => (
  item?.normalizedType === "album" || item?.sourceType === "album" || item?.type === "album"
);
const pickBestTrack = (items: any[]): any => {
  if (!Array.isArray(items) || !items.length) return null;
  const compareTrackPriority = (a: any, b: any) => {
    const aTitleRaw = String(a?.title ?? a?.name ?? "");
    const bTitleRaw = String(b?.title ?? b?.name ?? "");
    const aHasVariant = hasVariantKeyword(aTitleRaw);
    const bHasVariant = hasVariantKeyword(bTitleRaw);
    if (aHasVariant !== bHasVariant) return aHasVariant ? 1 : -1;

    const aHasBracket = hasBracketContent(aTitleRaw);
    const bHasBracket = hasBracketContent(bTitleRaw);
    if (aHasBracket !== bHasBracket) return aHasBracket ? 1 : -1;

    const aLen = aTitleRaw.trim().length;
    const bLen = bTitleRaw.trim().length;
    if (aLen !== bLen) return aLen - bLen;

    const aIsTrack = isTrackItem(a);
    const bIsTrack = isTrackItem(b);
    if (aIsTrack !== bIsTrack) return aIsTrack ? -1 : 1;

    const popDiff = Number(b?.artistPopularity ?? 0) - Number(a?.artistPopularity ?? 0);
    if (popDiff) return popDiff;

    const dateDiff = Number(b?.releaseTs ?? 0) - Number(a?.releaseTs ?? 0);
    if (dateDiff) return dateDiff;

    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  };
  const sorted = [...items].sort(compareTrackPriority);
  return sorted[0];
};
const pickBestTrackWithVariantMeta = (items: any[]): { best: any; bracketDrops: number; dropped: number } => {
  const best = pickBestTrack(items);
  if (!best) return { best: null, bracketDrops: 0, dropped: 0 };
  const losers = items.filter((it) => it !== best);
  const bracketDrops = losers.reduce((acc: number, it: any) => {
    const title = String(it?.title ?? it?.name ?? "");
    return acc + (hasBracketContent(title) ? 1 : 0);
  }, 0);
  return { best, bracketDrops, dropped: losers.length };
};
const pickBestAlbum = (items: any[]): any => {
  if (!Array.isArray(items) || !items.length) return null;
  const sorted = [...items].sort((a: any, b: any) => {
    const popDiff = Number(b?.artistPopularity ?? 0) - Number(a?.artistPopularity ?? 0);
    if (popDiff) return popDiff;
    const dateDiff = Number(b?.releaseTs ?? 0) - Number(a?.releaseTs ?? 0);
    if (dateDiff) return dateDiff;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
  return sorted[0];
};
async function dedupeDiscoveryItems(
  items: any[],
  opts: {
    hdrs: Record<string, string>;
    market: string;
    stagePrefix: string;
    maxAlbumFetchIds?: number;
    setStage: (next: string) => void;
    ensureArtistPopularity: (artistIds: string[], stagePrefix: string) => Promise<void>;
    getArtistPopularity: (artists: Array<{ id: string | null; name: string | null }>) => number | null;
    normalizeReleaseDate: (releaseDate?: string | null, precision?: string | null) => string | null;
    toReleaseTs: (releaseDate?: string | null, precision?: string | null) => number | null;
  },
) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const maxAlbumFetchIds = Math.max(1, Math.min(20, Number.isFinite(opts?.maxAlbumFetchIds) ? Number(opts.maxAlbumFetchIds) : 20));
  const grouped = new Map<string, { albumId: string | null; items: any[] }>();
  safeItems.forEach((item: any, index: number) => {
    const normalizedType = isTrackItem(item) ? "track" : "album";
    const albumIdRaw = normalizedType === "album" ? item?.id : item?.albumId;
    const albumId = albumIdRaw ? String(albumIdRaw) : null;
    const fallbackId = String(item?.id ?? `${normalizedType}-${index}`);
    const key = albumId ? `album:${albumId}` : `item:${normalizedType}:${fallbackId}`;
    if (!grouped.has(key)) grouped.set(key, { albumId, items: [] });
    grouped.get(key)!.items.push(item);
  });

  const trackOnlyGroups = Array.from(grouped.values())
    .map((group) => {
      const trackItems = group.items.filter(isTrackItem);
      const albumItems = group.items.filter(isAlbumItem);
      const groupMaxPopularity = trackItems.reduce((max: number, t: any) => {
        const p = Number(t?.artistPopularity ?? -1);
        return p > max ? p : max;
      }, -1);
      return {
        group,
        trackItems,
        albumItems,
        albumId: group.albumId,
        trackCount: trackItems.length,
        groupMaxPopularity,
      };
    })
    .filter((entry) => !entry.albumItems.length && !!entry.albumId && entry.trackCount >= 2)
    .sort((a, b) => {
      if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount;
      if (b.groupMaxPopularity !== a.groupMaxPopularity) return b.groupMaxPopularity - a.groupMaxPopularity;
      return String(a.albumId ?? "").localeCompare(String(b.albumId ?? ""));
    });

  const albumIdsToFetch = trackOnlyGroups.slice(0, maxAlbumFetchIds).map((entry) => String(entry.albumId));
  const albumById = new Map<string, any>();
  for (let i = 0; i < albumIdsToFetch.length; i += 20) {
    const ids = albumIdsToFetch.slice(i, i + 20);
    if (!ids.length) continue;
    opts.setStage(`${opts.stagePrefix}_albums_${Math.floor(i / 20)}`);
    const ar = await fetchWithTimeout(
      `${API}/albums?` + new URLSearchParams({ ids: ids.join(","), market: opts.market }),
      { headers: opts.hdrs },
      8000,
      `${opts.stagePrefix}_albums_${Math.floor(i / 20)}`,
    );
    if (!ar.ok) continue;
    const aj: any = await ar.json();
    for (const album of aj?.albums ?? []) {
      const aid = album?.id;
      if (!aid) continue;
      albumById.set(String(aid), album);
    }
  }

  const fetchedArtistIds = Array.from(new Set(
    Array.from(albumById.values()).flatMap((album: any) => (
      Array.isArray(album?.artists) ? album.artists.map((a: any) => a?.id).filter(Boolean) : []
    )),
  ));
  if (fetchedArtistIds.length) {
    await opts.ensureArtistPopularity(fetchedArtistIds, `${opts.stagePrefix}_album_artists`);
  }

  const toAlbumNormalized = (album: any) => {
    const artists = Array.isArray(album?.artists)
      ? album.artists.map((a: any) => ({ id: a?.id ?? null, name: a?.name ?? null }))
      : [];
    const releaseDateRaw = album?.release_date ?? null;
    const releaseDatePrecision = album?.release_date_precision ?? null;
    const releaseDateNormalized = opts.normalizeReleaseDate(releaseDateRaw, releaseDatePrecision);
    const releaseTs = opts.toReleaseTs(releaseDateRaw, releaseDatePrecision);
    const albumItem: any = {
      sourceType: "album",
      normalizedType: "album",
      type: "album",
      id: album?.id ?? null,
      albumId: album?.id ?? null,
      title: album?.name ?? "",
      name: album?.name ?? "",
      artists,
      releaseDateRaw,
      releaseDatePrecision,
      releaseDateNormalized,
      releaseTs,
      spotifyUrl: album?.external_urls?.spotify ?? null,
      imageUrl: album?.images?.[0]?.url ?? null,
      images: Array.isArray(album?.images) ? album.images : [],
      albumType: album?.album_type ?? null,
      totalTracks: typeof album?.total_tracks === "number" ? album.total_tracks : null,
    };
    albumItem.artistPopularity = opts.getArtistPopularity(artists);
    return albumItem;
  };

  const stageAItems: any[] = [];
  let droppedTracksDueToAlbumPreference = 0;
  let albumsFetchedForSubstitution = 0;

  for (const groupedEntry of grouped.values()) {
    const albumItems = groupedEntry.items.filter(isAlbumItem);
    const trackItems = groupedEntry.items.filter(isTrackItem);
    if (albumItems.length) {
      const albumPick = pickBestAlbum(albumItems);
      if (albumPick) stageAItems.push(albumPick);
      droppedTracksDueToAlbumPreference += trackItems.length;
      continue;
    }

    if (groupedEntry.albumId && trackItems.length >= 2) {
      const fetchedAlbum = albumById.get(String(groupedEntry.albumId));
      if (fetchedAlbum) {
        const albumNormalized = toAlbumNormalized(fetchedAlbum);
        if (typeof albumNormalized?.artistPopularity !== "number") {
          const groupMax = trackItems.reduce((max: number, t: any) => {
            const p = Number(t?.artistPopularity ?? -1);
            return p > max ? p : max;
          }, -1);
          albumNormalized.artistPopularity = groupMax >= 0 ? groupMax : null;
        }
        stageAItems.push(albumNormalized);
        droppedTracksDueToAlbumPreference += trackItems.length;
        albumsFetchedForSubstitution += 1;
        continue;
      }
      const bestTrack = pickBestTrack(trackItems);
      if (bestTrack) stageAItems.push(bestTrack);
      droppedTracksDueToAlbumPreference += Math.max(0, trackItems.length - 1);
      continue;
    }

    stageAItems.push(...groupedEntry.items);
  }

  const variantGroups = new Map<string, any[]>();
  let droppedVariantsCount = 0;
  let droppedVariantsBracketCount = 0;

  for (const item of stageAItems) {
    const primaryArtistId = String(item?.artists?.[0]?.id ?? item?.artistId ?? "unknown");
    const rawTitle = String(item?.title ?? item?.name ?? "");
    const canonical = canonicalTitle(rawTitle) || rawTitle.toLowerCase().trim();
    const variantKey = `${primaryArtistId}::${canonical}`;
    const prev = variantGroups.get(variantKey) ?? [];
    prev.push(item);
    variantGroups.set(variantKey, prev);
  }

  const variantCollapsedItems: any[] = [];
  for (const groupedTracks of variantGroups.values()) {
    if (groupedTracks.length <= 1) {
      variantCollapsedItems.push(groupedTracks[0]);
      continue;
    }
    const pick = pickBestTrackWithVariantMeta(groupedTracks);
    if (pick.best) variantCollapsedItems.push(pick.best);
    droppedVariantsCount += pick.dropped;
    droppedVariantsBracketCount += pick.bracketDrops;
  }

  const nonTracks: any[] = [];
  const coverGroups = new Map<string, any[]>();
  const tracksNoCoverKey: any[] = [];
  for (const track of variantCollapsedItems) {
    if (!isTrackItem(track)) {
      nonTracks.push(track);
      continue;
    }
    const artistId = String(track?.artists?.[0]?.id ?? track?.artistId ?? "");
    const imageUrl = String(track?.imageUrl ?? "");
    if (!artistId || !imageUrl) {
      tracksNoCoverKey.push(track);
      continue;
    }
    const coverKey = `${artistId}::${imageUrl}`;
    const prev = coverGroups.get(coverKey) ?? [];
    prev.push(track);
    coverGroups.set(coverKey, prev);
  }

  let droppedSameCoverCount = 0;
  const coverCollapsedTracks: any[] = [...tracksNoCoverKey];
  for (const groupedTracks of coverGroups.values()) {
    if (groupedTracks.length <= 1) {
      coverCollapsedTracks.push(groupedTracks[0]);
      continue;
    }
    const best = pickBestTrack(groupedTracks);
    if (best) coverCollapsedTracks.push(best);
    droppedSameCoverCount += groupedTracks.length - 1;
  }

  const deduped = nonTracks.concat(coverCollapsedTracks);
  return {
    items: deduped,
    stats: {
      dedupe_input_count: safeItems.length,
      dedupe_output_count: deduped.length,
      dropped_tracks_due_to_album_preference: droppedTracksDueToAlbumPreference,
      albums_fetched_for_substitution: albumsFetchedForSubstitution,
      dropped_variants_count: droppedVariantsCount,
      dropped_variants_bracket_count: droppedVariantsBracketCount,
      dropped_same_cover_count: droppedSameCoverCount,
    },
  };
}

const capPerArtist = (items: any[], maxPerArtist = 2): { items: any[]; dropped_due_to_artist_cap: number } => {
  const capped: any[] = [];
  const counts = new Map<string, number>();
  let dropped = 0;
  const safeMax = Math.max(1, Math.min(5, Number.isFinite(maxPerArtist) ? Number(maxPerArtist) : 2));
  for (const item of Array.isArray(items) ? items : []) {
    const primaryArtistId = String(item?.artists?.[0]?.id ?? item?.artistId ?? "");
    const primaryArtistName = String(item?.artists?.[0]?.name ?? item?.artist ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const key = primaryArtistId || (primaryArtistName ? `name:${primaryArtistName}` : `unknown:${String(item?.id ?? capped.length)}`);
    const current = counts.get(key) ?? 0;
    if (current >= safeMax) {
      dropped += 1;
      continue;
    }
    counts.set(key, current + 1);
    capped.push(item);
  }
  return { items: capped, dropped_due_to_artist_cap: dropped };
};

const DISCOVER_BUCKET_KEYS = [
  "rap", "rnb", "pop", "rock", "latin", "edm", "country", "kpop", "afrobeats",
  "jazz", "dancehall", "reggae", "indie", "metal", "punk", "folk", "blues", "classical",
  "soundtrack", "ambient", "jpop", "desi",
];

// Matches the existing server key normalization used by the app request layer.
const normalizeDiscoverGenreKey = (value?: string | null): string => {
  const lower = String(value ?? "").trim().toLowerCase();
  if (lower === "hiphop" || lower === "hip-hop" || lower === "hip hop") return "rap";
  if (lower === "r&b" || lower === "rb") return "rnb";
  if (lower === "electronic") return "edm";
  return lower;
};

const parseDiscoverGenreKeys = (rawValue?: string | null): string[] => {
  const requested = String(rawValue ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => normalizeDiscoverGenreKey(s))
    .filter(Boolean);
  const want = new Set(requested);
  return DISCOVER_BUCKET_KEYS.filter((key) => want.has(key));
};

const createGenreDebugByBucket = (
  bucketKeys: string[],
  opts: { maxPerArtist: number; cutoffIso: string; market: string; popularityFloor: number },
) => Object.fromEntries(
  bucketKeys.map((k) => [k, {
    search_raw_count: 0,
    date_pass_count: 0,
    popularity_pass_count: 0,
    dedupe_input_count: 0,
    dedupe_output_count: 0,
    dropped_tracks_due_to_album_preference: 0,
    albums_fetched_for_substitution: 0,
    dropped_variants_count: 0,
    dropped_variants_bracket_count: 0,
    dropped_same_cover_count: 0,
    max_per_artist: opts.maxPerArtist,
    dropped_due_to_artist_cap: 0,
    returned_count: 0,
    cutoff_iso: opts.cutoffIso,
    pages_scanned: 0,
    market: opts.market,
    popularity_floor: opts.popularityFloor,
  }]),
);

const topPicksItemsFromPayload = (payload: any): any[] => {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.albums?.items)) return payload.albums.items;
  return [];
};

const isTopPicksPayload = (payload: any) => (
  !!payload && (Array.isArray(payload?.items) || Array.isArray(payload?.albums?.items))
);

const isGenreBucketCachePayload = (payload: any) => (
  !!payload && Array.isArray(payload?.items)
);

const DISCOVER_SERVER_CACHE_TTL_MS = 30 * 60 * 1000;
const DISCOVER_RELEASE_WINDOW_DAYS = 14;
const AFROBEATS_SEARCH_TERMS = [
  "afrobeats",
  "afrobeat",
  "afropop",
  "amapiano",
  "afroswing",
  "nigerian pop",
  "ghanaian pop",
];
const AFROBEATS_MARKETS = ["GB", "US"];
const AFROBEATS_SEARCH_REQUEST_CAP = 14;
const AFROBEATS_ARTIST_ENRICHMENT_CAP = 100;
const AFROBEATS_VERIFIED_CANDIDATE_TARGET = 12;
const AFROBEATS_ARTIST_GENRE_ALIASES = [
  "afrobeats",
  "afrobeat",
  "afropop",
  "amapiano",
  "afroswing",
  "nigerian pop",
  "ghanaian pop",
  "afro r&b",
  "afro soul",
  "azonto",
];

const normalizeGenreLabel = (value?: string | null) => (
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
);

const normalizeServerReleaseDate = (releaseDate?: string | null, precision?: string | null): string | null => {
  if (!releaseDate) return null;
  const s = String(releaseDate);
  const p = String(precision ?? "").toLowerCase();
  if (p === "day" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (p === "month" && /^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (p === "year" && /^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return null;
};

const toServerReleaseTs = (releaseDate?: string | null, precision?: string | null): number | null => {
  const normalized = normalizeServerReleaseDate(releaseDate, precision);
  if (!normalized) return null;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : t;
};

const discoverCalendarWindow = (days: number, nowMs = Date.now()) => {
  const cutoff = new Date(nowMs);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, days - 1));
  const end = new Date(nowMs);
  end.setUTCHours(23, 59, 59, 999);
  return { cutoffMs: cutoff.getTime(), endMs: end.getTime(), cutoffIso: cutoff.toISOString() };
};

const discoverServerDateKey = (nowMs = Date.now()) => {
  const date = new Date(nowMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const discoverServerFreshnessBand = (releaseTs?: number | null, nowMs = Date.now()) => {
  if (releaseTs == null) return Number.POSITIVE_INFINITY;
  const release = new Date(releaseTs);
  release.setUTCHours(0, 0, 0, 0);
  const today = new Date(nowMs);
  today.setUTCHours(0, 0, 0, 0);
  const ageDays = Math.floor((today.getTime() - release.getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays < 0 || ageDays >= DISCOVER_RELEASE_WINDOW_DAYS) return Number.POSITIVE_INFINITY;
  if (ageDays === 0) return 0;
  if (ageDays <= 3) return 1;
  if (ageDays <= 7) return 2;
  return 3;
};

const compareServerDiscoverFreshness = (a: any, b: any, nowMs = Date.now()) => {
  const bandDiff = discoverServerFreshnessBand(a?.releaseTs, nowMs) - discoverServerFreshnessBand(b?.releaseTs, nowMs);
  if (bandDiff) return bandDiff;
  const popDiff = (b?.artistPopularity ?? b?.artist_popularity ?? 0) - (a?.artistPopularity ?? a?.artist_popularity ?? 0);
  if (popDiff) return popDiff;
  const dateDiff = (b?.releaseTs ?? 0) - (a?.releaseTs ?? 0);
  if (dateDiff) return dateDiff;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
};

const filterEligibleCachedDiscoverItems = (items: any[], days: number) => {
  const { cutoffMs, endMs } = discoverCalendarWindow(days);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const ts = toServerReleaseTs(item?.releaseDate ?? item?.release_date ?? null, item?.releaseDatePrecision ?? item?.release_date_precision ?? null);
    return ts != null && ts >= cutoffMs && ts <= endMs;
  });
};

const withServerReleaseTs = (item: any) => ({
  ...item,
  releaseTs: toServerReleaseTs(item?.releaseDate ?? item?.release_date ?? null, item?.releaseDatePrecision ?? item?.release_date_precision ?? null),
});

const sanitizeTopPicksCachePayload = (payload: any, days: number, nowMs = Date.now()) => {
  if (!payload) return null;
  const items = filterEligibleCachedDiscoverItems(topPicksItemsFromPayload(payload), days)
    .sort((a: any, b: any) => compareServerDiscoverFreshness(withServerReleaseTs(a), withServerReleaseTs(b), nowMs));
  if (!items.length) return null;
  return {
    ...payload,
    items,
    albums: { ...(payload?.albums ?? {}), items },
    days,
    cacheDate: typeof payload?.cacheDate === "string" ? payload.cacheDate : discoverServerDateKey(nowMs),
    ts: typeof payload?.ts === "number" ? payload.ts : Date.now(),
  };
};

const isFreshDiscoverCachePayload = (payload: any, expectedDays?: number) => (
  isGenreBucketCachePayload(payload) &&
  typeof payload?.ts === "number" &&
  Date.now() - payload.ts <= DISCOVER_SERVER_CACHE_TTL_MS &&
  payload?.cacheDate === discoverServerDateKey() &&
  (expectedDays == null || Number(payload?.days) === expectedDays)
);

const isFreshTopPicksCachePayload = (payload: any, expectedDays?: number) => (
  isTopPicksPayload(payload) &&
  typeof payload?.ts === "number" &&
  Date.now() - payload.ts <= DISCOVER_SERVER_CACHE_TTL_MS &&
  payload?.cacheDate === discoverServerDateKey() &&
  (expectedDays == null || Number(payload?.days) === expectedDays)
);

let discoverCacheClient: any = null;
let discoverCacheClientInitAttempted = false;

const getDiscoverCacheClient = () => {
  if (discoverCacheClientInitAttempted) return discoverCacheClient;
  discoverCacheClientInitAttempted = true;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[discover-cache] client-unavailable missing-supabase-env");
    discoverCacheClient = null;
    return discoverCacheClient;
  }
  discoverCacheClient = createClient(supabaseUrl, serviceRoleKey);
  return discoverCacheClient;
};

const readDiscoverCache = async (key: string) => {
  const supabase = getDiscoverCacheClient();
  if (!supabase) return { payload: null, error: new Error("discover cache client unavailable") };
  try {
    const { data, error } = await supabase
      .from("discover_cache")
      .select("payload")
      .eq("key", key)
      .maybeSingle();
    if (error) return { payload: null, error };
    return { payload: data?.payload ?? null, error: null };
  } catch (error) {
    return { payload: null, error };
  }
};

const writeDiscoverCache = async (key: string, payload: any) => {
  const supabase = getDiscoverCacheClient();
  if (!supabase) return { error: new Error("discover cache client unavailable") };
  try {
    const { error } = await supabase
      .from("discover_cache")
      .upsert({ key, payload }, { onConflict: "key" });
    return { error: error ?? null };
  } catch (error) {
    return { error };
  }
};

// Tiny in-memory cache (best-effort, per-warm instance)
type CacheEntry = { ts: number; body: string };
const CACHE_TTL_MS = 60 * 1000; // 60s
const cache = new Map<string, CacheEntry>();
const now = () => Date.now();

async function getAppToken(clientId: string, clientSecret: string) {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }, 8000, "token");
  if (!res.ok) throw new Error("spotify token failed");
  const json = await res.json();
  return json.access_token as string;
}

serve(async (req) => {
  const startTime = Date.now();
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const trace = url.searchParams.get("trace") === "1";
  const traceStage = url.searchParams.get("traceStage") ?? "start";
  if (trace && traceStage === "entry" && url.pathname.replace(/\/$/, "").endsWith("/new-releases-genre")) {
    return new Response(JSON.stringify({
      ok: true,
      build: BUILD_ID,
      stage: "trace_entry",
      pathname: url.pathname,
      ts: new Date().toISOString(),
    }), {
      status: 200,
      headers: addBuildHeader({ "Content-Type": "application/json" }),
    });
  }
  let stage = "serve_start";
  try {
    if (url.searchParams.get("ping") === "1") {
      return new Response(JSON.stringify({
        ok: true,
        build: BUILD_ID,
        pathname: url.pathname,
        ts: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "X-Spotify-Search-Build, X-Spotify-Browse-Status",
          "X-Spotify-Search-Build": BUILD_ID,
        },
      });
    }
    const rawUrl = req.url;
      const pathname = url.pathname.replace(/\/$/, "");
    const q = url.searchParams.get("q") ?? "";
      const type = url.searchParams.get("type") ?? "album,track,artist";
    let market = (url.searchParams.get("market") ?? "GB").toUpperCase(); // fallback GB
    // Normalize common aliases to valid Spotify market codes
    if (market === 'UK') market = 'GB';
    const artistId = url.searchParams.get("artistId") ?? "";
      const lookupType = url.searchParams.get("lookupType") ?? "";
      const id = url.searchParams.get("id") ?? "";
    const modeParam = (url.searchParams.get("mode") ?? "full").toLowerCase();
    const light = modeParam === 'light';
    const refresh = url.searchParams.get("refresh") === "1";

      const cid = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
      const sec = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
      const debugInfo: any = debug ? {
        token: { ok: false, hasClientId: !!cid, hasClientSecret: !!sec },
        spotifyStatus: { search: { ok: 0, error: 0 }, artists: { ok: 0, error: 0 } },
        spotifyError: null,
        appleUsed: false,
        sourceBreakdown: { spotify: 0, apple: 0 },
      } : null;

    let token: string | null = null;
    let tokenError: any = null;
    if (cid && sec) {
      try {
        token = await getAppToken(cid, sec);
        if (debugInfo) debugInfo.token.ok = true;
      } catch (e) {
        tokenError = e;
        if (debugInfo) debugInfo.token.error = String((e as any)?.message ?? e);
      }
    } else {
      tokenError = new Error("missing spotify client id/secret");
      if (debugInfo) debugInfo.token.error = "missing spotify client id/secret";
    }

    if (!token) {
      if (pathname.endsWith("/new-releases-wide")) {
        if (debugInfo) {
          debugInfo.spotifyError = { stage: "token", status: null, message: debugInfo.token.error ?? "spotify token failed" };
          debugInfo.sourceBreakdown.spotify = 0;
          debugInfo.sourceBreakdown.apple = 0;
          debugInfo.appleUsed = false;
        }
        const payload: any = { albums: { items: [] } };
        if (debugInfo) payload.debug = debugInfo;
        return new Response(JSON.stringify(payload), {
          headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "WIDE", "X-Path": pathname, "X-Count": "0" }),
        });
      }
      throw tokenError ?? new Error("spotify token failed");
    }

    const hdrs = { Authorization: `Bearer ${token}` };

    const buildTopPicksResponse = (payload: any) => new Response(JSON.stringify(payload), {
      headers: addBuildHeader({
        "Content-Type": "application/json",
        "X-Route": "TOP-PICKS",
        "X-Path": pathname,
        "X-Count": String(Array.isArray(payload?.items) ? payload.items.length : 0),
      }),
    });

    const buildGenreResponse = (payload: any) => {
      const body = JSON.stringify(payload);
      const duration = Date.now() - startTime;
      console.log("NRG_SUCCESS_DURATION_MS", duration);
      const headers: Record<string, string> = addBuildHeader({ "Content-Type": "application/json", "X-Route": "NRG", "X-Path": pathname });
      return new Response(body, { headers });
    };

    const topPicksNowMs = Date.now();
    const topPicksDaysParam = Number(url.searchParams.get("days") ?? "30");
    const topPicksDaysUsed = Math.max(1, Math.min(365, Number.isFinite(topPicksDaysParam) ? topPicksDaysParam : 30));

    const computeTopPicksPayload = async () => {
      const marketFixed = "US";
      const nowMs = topPicksNowMs;
      const currentYear = new Date(nowMs).getUTCFullYear();
      const daysUsed = topPicksDaysUsed;
      const popularityFloorParam = Number(
        url.searchParams.get("popularity_floor")
        ?? url.searchParams.get("popularityFloor")
        ?? url.searchParams.get("min_popularity")
        ?? "50"
      );
      const popularityFloor = Math.max(0, Math.min(100, Number.isFinite(popularityFloorParam) ? popularityFloorParam : 50));
      const maxPerArtistParam = Number(url.searchParams.get("max_per_artist") ?? "2");
      const maxPerArtist = Math.max(1, Math.min(5, Number.isFinite(maxPerArtistParam) ? maxPerArtistParam : 2));
      const pagesPerQueryParam = Number(url.searchParams.get("pages") ?? "2");
      const pagesPerQuery = Math.max(1, Math.min(4, Number.isFinite(pagesPerQueryParam) ? pagesPerQueryParam : 2));
      const pageLimit = 50;
      const returnLimit = 30;
      const { cutoffMs, endMs, cutoffIso } = discoverCalendarWindow(daysUsed, nowMs);
      const queriesUsed = [
        `year:${currentYear}`,
        `year:${currentYear} genre:"pop"`,
        `year:${currentYear} genre:"hiphop"`,
        `year:${currentYear} genre:"latin"`,
        `year:${currentYear} genre:"dance"`,
      ];

      const normalizeReleaseDate = (releaseDate?: string | null, precision?: string | null): string | null => {
        if (!releaseDate) return null;
        const s = String(releaseDate);
        const p = String(precision ?? "").toLowerCase();
        if (p === "day" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (p === "month" && /^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
        if (p === "year" && /^\d{4}$/.test(s)) return `${s}-01-01`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
        if (/^\d{4}$/.test(s)) return `${s}-01-01`;
        return null;
      };
      const toReleaseTs = (releaseDate?: string | null, precision?: string | null): number | null => {
        const normalized = normalizeReleaseDate(releaseDate, precision);
        if (!normalized) return null;
        const t = Date.parse(normalized);
        return Number.isNaN(t) ? null : t;
      };
      const normalizeItem = (item: any, sourceType: "album" | "track") => {
        const album = sourceType === "album" ? item : (item?.album ?? {});
        const releaseDateRaw = album?.release_date ?? item?.release_date ?? null;
        const releaseDatePrecision = album?.release_date_precision ?? item?.release_date_precision ?? null;
        const releaseDate = normalizeReleaseDate(releaseDateRaw, releaseDatePrecision);
        const releaseTs = toReleaseTs(releaseDateRaw, releaseDatePrecision);
        const artistsRaw = sourceType === "track" ? item?.artists : album?.artists;
        const artists = Array.isArray(artistsRaw)
          ? artistsRaw.map((a: any) => ({ id: a?.id ?? null, name: a?.name ?? null }))
          : [];
        const spotifyUrl = item?.external_urls?.spotify ?? album?.external_urls?.spotify ?? null;
        const imageUrl = sourceType === "album"
          ? (item?.images?.[0]?.url ?? null)
          : (item?.album?.images?.[0]?.url ?? null);
        return {
          sourceType,
          normalizedType: sourceType,
          id: item?.id ?? null,
          albumId: sourceType === "album" ? (item?.id ?? null) : (item?.album?.id ?? null),
          title: item?.name ?? "",
          name: item?.name ?? "",
          artists,
          releaseDateRaw,
          releaseDatePrecision,
          releaseDateNormalized: releaseDate,
          releaseDate,
          releaseTs,
          spotifyUrl,
          imageUrl,
          type: sourceType,
          artistPopularity: null as number | null,
        };
      };

      const dedupedById = new Map<string, any>();
      let rawCountTotal = 0;
      let pagesScannedTotal = 0;

      for (const query of queriesUsed) {
        for (let page = 0; page < pagesPerQuery; page++) {
          pagesScannedTotal += 1;
          const offset = page * pageLimit;
          stage = `top_picks_search_${page}`;
          const searchUrl = `${API}/search?` + new URLSearchParams({
            q: query,
            type: "album,track",
            market: marketFixed,
            limit: String(pageLimit),
            offset: String(offset),
          });
          const res = await fetchWithTimeout(searchUrl, { headers: hdrs }, 8000, stage);
          if (!res.ok) {
            if (debugInfo && !debugInfo.spotifyError) {
              debugInfo.spotifyError = { stage, status: res.status, message: res.statusText };
            }
            break;
          }
          const j: any = await res.json();
          const albumItems = Array.isArray(j?.albums?.items) ? j.albums.items : [];
          const trackItems = Array.isArray(j?.tracks?.items) ? j.tracks.items : [];
          const pageRaw = albumItems.length + trackItems.length;
          rawCountTotal += pageRaw;
          if (!pageRaw) break;

          for (const a of albumItems) {
            const normalized = normalizeItem(a, "album");
            const key = String(normalized?.id ?? "");
            if (!key) continue;
            if (!dedupedById.has(key)) dedupedById.set(key, normalized);
          }
          for (const t of trackItems) {
            const normalized = normalizeItem(t, "track");
            const key = String(normalized?.id ?? "");
            if (!key) continue;
            if (!dedupedById.has(key)) dedupedById.set(key, normalized);
          }
        }
      }

      const deduped = Array.from(dedupedById.values());
      const datePassed = deduped.filter((item: any) => item?.releaseTs != null && item.releaseTs >= cutoffMs && item.releaseTs <= endMs);
      const artistPopularityMap = new Map<string, number | null>();
      const ensureArtistPopularity = async (artistIds: string[], stagePrefix: string) => {
        const missing = artistIds.filter((id) => id && !artistPopularityMap.has(id));
        for (let i = 0; i < missing.length; i += 50) {
          const ids = missing.slice(i, i + 50);
          if (!ids.length) continue;
          stage = `${stagePrefix}_${Math.floor(i / 50)}`;
          const ar = await fetchWithTimeout(`${API}/artists?ids=${ids.join(",")}`, { headers: hdrs }, 8000, stage);
          if (!ar.ok) {
            for (const id of ids) artistPopularityMap.set(id, null);
            continue;
          }
          const aj: any = await ar.json();
          const seen = new Set<string>();
          for (const art of aj?.artists ?? []) {
            if (!art?.id) continue;
            seen.add(art.id);
            artistPopularityMap.set(art.id, typeof art?.popularity === "number" ? art.popularity : null);
          }
          for (const id of ids) {
            if (!seen.has(id)) artistPopularityMap.set(id, null);
          }
        }
      };
      const maxArtistPopularityFor = (artists: Array<{ id: string | null; name: string | null }>): number | null => {
        const pops: number[] = [];
        for (const a of artists ?? []) {
          const aid = a?.id;
          if (!aid) continue;
          const p = artistPopularityMap.get(aid);
          if (typeof p === "number") pops.push(p);
        }
        return pops.length ? Math.max(...pops) : null;
      };
      const artistIds = Array.from(new Set(
        datePassed.flatMap((item: any) => (item?.artists ?? []).map((a: any) => a?.id).filter(Boolean))
      ));
      await ensureArtistPopularity(artistIds as string[], "top_picks_artists");
      const popularityPassed = datePassed.filter((item: any) => {
        const maxPop = maxArtistPopularityFor(item?.artists ?? []);
        item.artistPopularity = maxPop;
        return typeof maxPop === "number" && maxPop >= popularityFloor;
      });
      const popularityFallbackUsed = popularityPassed.length === 0 && datePassed.length > 0;
      const qualityInput = popularityFallbackUsed ? datePassed : popularityPassed;
      const dedupeResult = await dedupeDiscoveryItems(qualityInput, {
        hdrs,
        market: marketFixed,
        stagePrefix: "top_picks_dedupe",
        maxAlbumFetchIds: 20,
        setStage: (next) => { stage = next; },
        ensureArtistPopularity,
        getArtistPopularity: maxArtistPopularityFor,
        normalizeReleaseDate,
        toReleaseTs,
      });
      const qualityDeduped = dedupeResult.items;
      qualityDeduped.sort((a: any, b: any) => compareServerDiscoverFreshness(a, b, nowMs));
      const artistCappedResult = capPerArtist(qualityDeduped, maxPerArtist);
      const items = artistCappedResult.items.slice(0, returnLimit).map((item: any) => ({
        id: item?.id,
        title: item?.title ?? item?.name ?? "",
        artist: item?.artists?.[0]?.name ?? "",
        artistId: item?.artists?.[0]?.id ?? null,
        artistPopularity: item?.artistPopularity ?? null,
        releaseDate: item?.releaseDateNormalized ?? item?.releaseDate ?? null,
        spotifyUrl: item?.spotifyUrl ?? null,
        imageUrl: item?.imageUrl ?? null,
        type: isTrackItem(item) ? "track" : "album",
      }));

      const payload: any = { items, albums: { items }, ts: Date.now(), cacheDate: discoverServerDateKey(nowMs), days: daysUsed };
      if (debug) {
        payload.build = BUILD_ID;
        payload.debug = {
          queries_used: queriesUsed,
          raw_count_total: rawCountTotal,
          deduped_count: deduped.length,
          date_pass_count: datePassed.length,
          popularity_pass_count: popularityPassed.length,
          popularity_fallback_used: popularityFallbackUsed,
          dedupe_input_count: dedupeResult.stats.dedupe_input_count,
          dedupe_output_count: dedupeResult.stats.dedupe_output_count,
          dropped_tracks_due_to_album_preference: dedupeResult.stats.dropped_tracks_due_to_album_preference,
          albums_fetched_for_substitution: dedupeResult.stats.albums_fetched_for_substitution,
          dropped_variants_count: dedupeResult.stats.dropped_variants_count,
          dropped_variants_bracket_count: dedupeResult.stats.dropped_variants_bracket_count,
          dropped_same_cover_count: dedupeResult.stats.dropped_same_cover_count,
          max_per_artist: maxPerArtist,
          dropped_due_to_artist_cap: artistCappedResult.dropped_due_to_artist_cap,
          returned_count: items.length,
          cutoff_iso: cutoffIso,
          pages_scanned_total: pagesScannedTotal,
          market: marketFixed,
          popularity_floor: popularityFloor,
        };
      }
      return payload;
    };

    const loadTopPicksPayload = async (opts?: { forceRefresh?: boolean }) => {
      const cacheKey = "top_picks";
      const forceRefresh = !!opts?.forceRefresh;
      let existingEligiblePayload: any = null;
      if (!debug) {
        try {
          const { payload: cachedPayload, error: cacheReadError } = await readDiscoverCache(cacheKey);
          if (cacheReadError) {
            console.error(`[discover-cache] read-failed key=${cacheKey}`, cacheReadError);
          } else {
            existingEligiblePayload = sanitizeTopPicksCachePayload(cachedPayload, topPicksDaysUsed, topPicksNowMs);
            if (forceRefresh) {
              console.log(`[discover-cache] refresh key=${cacheKey}`);
            } else if (existingEligiblePayload && isFreshTopPicksCachePayload(existingEligiblePayload, topPicksDaysUsed)) {
              console.log(`[discover-cache] hit key=${cacheKey}`);
              return existingEligiblePayload;
            } else {
              console.log(`[discover-cache] miss key=${cacheKey}`);
            }
          }
        } catch (cacheError) {
          console.error(`[discover-cache] read-failed key=${cacheKey}`, cacheError);
        }
      }

      const payload = await computeTopPicksPayload();
      const eligiblePayload = sanitizeTopPicksCachePayload(payload, topPicksDaysUsed, topPicksNowMs);
      if (!eligiblePayload && existingEligiblePayload) return existingEligiblePayload;
      if (!debug && eligiblePayload) {
        const { error: cacheWriteError } = await writeDiscoverCache(cacheKey, eligiblePayload);
        if (cacheWriteError) {
          console.error(`[discover-cache] write-failed key=${cacheKey}`, cacheWriteError);
        } else {
          console.log(`[discover-cache] write key=${cacheKey}`);
        }
      }
      return eligiblePayload ?? payload;
    };

    const computeGenrePayload = async (requestedBuckets: string[]) => {
      const bucketKeys = DISCOVER_BUCKET_KEYS;
      const buckets: Record<string, any[]> = Object.fromEntries(bucketKeys.map((k) => [k, [] as any[]]));
      const marketFixed = "US";
      const nowMs = Date.now();
      const daysParam = Number(url.searchParams.get("days") ?? "30");
      const daysUsed = Math.max(1, Math.min(365, Number.isFinite(daysParam) ? daysParam : 30));
      const popularityFloorParam = Number(
        url.searchParams.get("popularity_floor")
        ?? url.searchParams.get("popularityFloor")
        ?? url.searchParams.get("min_popularity")
        ?? "50"
      );
      const popularityFloor = Math.max(0, Math.min(100, Number.isFinite(popularityFloorParam) ? popularityFloorParam : 50));
      const maxPerArtistParam = Number(url.searchParams.get("max_per_artist") ?? "2");
      const maxPerArtist = Math.max(1, Math.min(5, Number.isFinite(maxPerArtistParam) ? maxPerArtistParam : 2));
      const { cutoffMs, endMs, cutoffIso } = discoverCalendarWindow(daysUsed, nowMs);
      const currentYear = new Date(nowMs).getUTCFullYear();
      const emptyDebugByBucket = () => createGenreDebugByBucket(bucketKeys, {
        maxPerArtist,
        cutoffIso,
        market: marketFixed,
        popularityFloor,
      });

      const SEARCH_GENRE_MAP: Record<string, string> = {
        rap: "hiphop",
        rnb: "r&b",
        pop: "pop",
        rock: "rock",
        latin: "latin",
        edm: "electronic",
        country: "country",
        kpop: "k-pop",
        afrobeats: "afrobeats",
        jazz: "jazz",
        dancehall: "dancehall",
        reggae: "reggae",
        indie: "indie",
        metal: "metal",
        punk: "punk",
        folk: "folk",
        blues: "blues",
        classical: "classical",
        soundtrack: "soundtrack",
        ambient: "ambient",
        jpop: "j-pop",
        desi: "bollywood",
      };

      const MAX_PAGES = 5;
      const PAGE_LIMIT = 50;
      const MAX_RETURN = 30;
      const RAW_CEILING = 250;
      const debugByBucket: Record<string, any> = emptyDebugByBucket();
      const artistPopularityById = new Map<string, number | null>();
      const artistGenresById = new Map<string, string[]>();
      const toArtistLite = (artists: any[] | undefined): Array<{ id: string | null; name: string | null }> => (
        Array.isArray(artists)
          ? artists.map((a: any) => ({ id: a?.id ?? null, name: a?.name ?? null }))
          : []
      );
      const normalizeReleaseDate = (releaseDate?: string | null, precision?: string | null): string | null => {
        if (!releaseDate) return null;
        const s = String(releaseDate);
        const p = String(precision ?? "").toLowerCase();
        if (p === "day" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (p === "month" && /^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
        if (p === "year" && /^\d{4}$/.test(s)) return `${s}-01-01`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
        if (/^\d{4}$/.test(s)) return `${s}-01-01`;
        return null;
      };
      const toReleaseTs = (releaseDate?: string | null, precision?: string | null): number | null => {
        const normalized = normalizeReleaseDate(releaseDate, precision);
        if (!normalized) return null;
        const t = Date.parse(normalized);
        return Number.isNaN(t) ? null : t;
      };
      const normalizeSearchItem = (item: any, sourceType: "album" | "track") => {
        const album = sourceType === "album" ? item : (item?.album ?? {});
        const releaseDate = album?.release_date ?? item?.release_date ?? null;
        const releaseDatePrecision = album?.release_date_precision ?? item?.release_date_precision ?? null;
        const releaseDateNormalized = normalizeReleaseDate(releaseDate, releaseDatePrecision);
        const releaseTs = toReleaseTs(releaseDate, releaseDatePrecision);
        const artists = toArtistLite(sourceType === "track" ? item?.artists : album?.artists);
        const spotifyUrl = item?.external_urls?.spotify ?? album?.external_urls?.spotify ?? null;
        const imageUrl = sourceType === "album"
          ? (item?.images?.[0]?.url ?? null)
          : (item?.album?.images?.[0]?.url ?? null);
        const totalTracks = typeof album?.total_tracks === "number" ? album.total_tracks : null;
        return {
          sourceType,
          id: item?.id ?? null,
          albumId: sourceType === "album" ? (item?.id ?? null) : (item?.album?.id ?? null),
          title: item?.name ?? null,
          name: item?.name ?? null,
          type: item?.type ?? sourceType,
          releaseDateRaw: releaseDate,
          releaseDatePrecision: releaseDatePrecision,
          releaseDateNormalized,
          releaseTs,
          artists,
          images: Array.isArray(album?.images) ? album.images : [],
          spotifyUrl,
          imageUrl,
          normalizedType: sourceType,
          albumType: album?.album_type ?? null,
          totalTracks,
        };
      };

      const ensureArtistPopularity = async (artistIds: string[], stagePrefix: string) => {
        const missing = artistIds.filter((id) => id && !artistPopularityById.has(id));
        for (let i = 0; i < missing.length; i += 50) {
          const ids = missing.slice(i, i + 50);
          if (!ids.length) continue;
          stage = `${stagePrefix}_${Math.floor(i / 50)}`;
          const ar = await fetchWithTimeout(`${API}/artists?ids=${ids.join(",")}`, { headers: hdrs }, 8000, stage);
          if (!ar.ok) {
            for (const id of ids) {
              artistPopularityById.set(id, null);
              artistGenresById.set(id, []);
            }
            continue;
          }
          const aj: any = await ar.json();
          const seenIds = new Set<string>();
          for (const art of aj?.artists ?? []) {
            if (!art?.id) continue;
            seenIds.add(art.id);
            artistPopularityById.set(art.id, typeof art?.popularity === "number" ? art.popularity : null);
            artistGenresById.set(art.id, Array.isArray(art?.genres) ? art.genres.map((g: any) => String(g)) : []);
          }
          for (const id of ids) {
            if (!seenIds.has(id)) {
              artistPopularityById.set(id, null);
              artistGenresById.set(id, []);
            }
          }
        }
      };

      const maxArtistPopularityFor = (artists: Array<{ id: string | null; name: string | null }>): number | null => {
        const vals: number[] = [];
        for (const artist of artists) {
          const id = artist?.id;
          if (!id) continue;
          const p = artistPopularityById.get(id);
          if (typeof p === "number") vals.push(p);
        }
        if (!vals.length) return null;
        return Math.max(...vals);
      };

      const afrobeatsGenreAliases = new Set(AFROBEATS_ARTIST_GENRE_ALIASES.map(normalizeGenreLabel));
      const afrobeatsArtistGenreEvidenceFor = (artists: Array<{ id: string | null; name: string | null }>) => {
        for (const artist of artists ?? []) {
          const id = artist?.id;
          if (!id) continue;
          const genres = artistGenresById.get(id) ?? [];
          for (const genre of genres) {
            const normalized = normalizeGenreLabel(genre);
            if (afrobeatsGenreAliases.has(normalized)) {
              return { artistId: id, artistName: artist?.name ?? null, genre };
            }
          }
        }
        return null;
      };

      const isWithinGenreWindow = (item: any) => (
        item?.releaseTs != null && item.releaseTs >= cutoffMs && item.releaseTs <= endMs
      );

      for (const bucketKey of requestedBuckets) {
        stage = `genre_search_start_${bucketKey}`;
        const queryGenre = SEARCH_GENRE_MAP[bucketKey] ?? bucketKey;
        const seen = new Set<string>();
        const candidates: any[] = [];
        let pagesScanned = 0;
        let searchRawCount = 0;
        let datePassCount = 0;
        let popularityPassCount = 0;

        for (let page = 0; page < MAX_PAGES; page++) {
          if (searchRawCount >= RAW_CEILING) break;
          pagesScanned += 1;
          const offset = page * PAGE_LIMIT;
          const q2 = `genre:"${queryGenre}" year:${currentYear}`;
          const searchUrl = `${API}/search?` + new URLSearchParams({
            q: q2,
            type: "album,track",
            market: marketFixed,
            limit: String(PAGE_LIMIT),
            offset: String(offset),
          });
          stage = `genre_search_${bucketKey}_${page}`;
          const res = await fetchWithTimeout(searchUrl, { headers: hdrs }, 8000, stage);
          if (!res.ok) {
            if (debugInfo && !debugInfo.spotifyError) {
              debugInfo.spotifyError = { stage, status: res.status, message: res.statusText };
            }
            break;
          }
          const j: any = await res.json();
          const albumItems = Array.isArray(j?.albums?.items) ? j.albums.items : [];
          const trackItems = Array.isArray(j?.tracks?.items) ? j.tracks.items : [];
          const rawCount = albumItems.length + trackItems.length;
          searchRawCount += rawCount;
          if (rawCount === 0) break;

          for (const a of albumItems) {
            const n = normalizeSearchItem(a, "album");
            const key = n?.id ? `album:${n.id}` : "";
            if (!key || seen.has(key)) continue;
            seen.add(key);
            candidates.push(n);
          }
          for (const t of trackItems) {
            const n = normalizeSearchItem(t, "track");
            const key = n?.id ? `track:${n.id}` : "";
            if (!key || seen.has(key)) continue;
            seen.add(key);
            candidates.push(n);
          }

          const datePassed = candidates.filter(isWithinGenreWindow);
          datePassCount = datePassed.length;
          const artistIds = Array.from(new Set(
            datePassed.flatMap((item: any) => (item?.artists ?? []).map((a: any) => a?.id).filter(Boolean))
          ));
          await ensureArtistPopularity(artistIds as string[], `genre_artists_${bucketKey}`);
          const popPassed = datePassed.filter((item) => {
            const maxPop = maxArtistPopularityFor(item?.artists ?? []);
            item.artistPopularity = maxPop;
            return typeof maxPop === "number" && maxPop >= popularityFloor;
          });
          popularityPassCount = popPassed.length;
        }

        const afrobeatsExpansion = {
          enabled: bucketKey === "afrobeats",
          search_request_cap: AFROBEATS_SEARCH_REQUEST_CAP,
          search_requests: 0,
          artist_enrichment_cap: AFROBEATS_ARTIST_ENRICHMENT_CAP,
          artists_enriched: 0,
          raw_count: 0,
          with_artist_ids_count: 0,
          date_pass_count: 0,
          with_artist_genre_metadata_count: 0,
          artist_genre_pass_count: 0,
          returned_to_pipeline_count: 0,
          markets_used: [] as string[],
          terms_used: [] as string[],
        };

        if (bucketKey === "afrobeats" && candidates.filter(isWithinGenreWindow).length < AFROBEATS_VERIFIED_CANDIDATE_TARGET) {
          const expansionArtistIds = new Set<string>();
          const addExpansionUse = (market: string, term: string) => {
            if (!afrobeatsExpansion.markets_used.includes(market)) afrobeatsExpansion.markets_used.push(market);
            if (!afrobeatsExpansion.terms_used.includes(term)) afrobeatsExpansion.terms_used.push(term);
          };

          for (const market of AFROBEATS_MARKETS) {
            if (afrobeatsExpansion.search_requests >= AFROBEATS_SEARCH_REQUEST_CAP) break;
            if (afrobeatsExpansion.returned_to_pipeline_count >= AFROBEATS_VERIFIED_CANDIDATE_TARGET) break;
            for (const term of AFROBEATS_SEARCH_TERMS) {
              if (afrobeatsExpansion.search_requests >= AFROBEATS_SEARCH_REQUEST_CAP) break;
              if (afrobeatsExpansion.returned_to_pipeline_count >= AFROBEATS_VERIFIED_CANDIDATE_TARGET) break;
              addExpansionUse(market, term);
              const searchUrl = `${API}/search?` + new URLSearchParams({
                q: `${term} year:${currentYear}`,
                type: "album,track",
                market,
                limit: String(PAGE_LIMIT),
                offset: "0",
              });
              stage = `genre_afrobeats_expand_${market}_${term.replace(/\W+/g, "_")}`;
              afrobeatsExpansion.search_requests += 1;
              const res = await fetchWithTimeout(searchUrl, { headers: hdrs }, 8000, stage);
              if (!res.ok) {
                if (debugInfo && !debugInfo.spotifyError) {
                  debugInfo.spotifyError = { stage, status: res.status, message: res.statusText };
                }
                continue;
              }

              const j: any = await res.json();
              const albumItems = Array.isArray(j?.albums?.items) ? j.albums.items : [];
              const trackItems = Array.isArray(j?.tracks?.items) ? j.tracks.items : [];
              const normalizedItems = [
                ...albumItems.map((item: any) => normalizeSearchItem(item, "album")),
                ...trackItems.map((item: any) => normalizeSearchItem(item, "track")),
              ];
              afrobeatsExpansion.raw_count += normalizedItems.length;

              const freshItems = normalizedItems.filter((item) => {
                if (!isWithinGenreWindow(item)) return false;
                afrobeatsExpansion.date_pass_count += 1;
                const artistIds = (item?.artists ?? []).map((a: any) => a?.id).filter(Boolean);
                if (artistIds.length) afrobeatsExpansion.with_artist_ids_count += 1;
                return artistIds.length > 0;
              });
              const idsToEnrich: string[] = [];
              for (const item of freshItems) {
                for (const artist of item?.artists ?? []) {
                  const id = artist?.id;
                  if (!id || expansionArtistIds.has(id)) continue;
                  if (expansionArtistIds.size >= AFROBEATS_ARTIST_ENRICHMENT_CAP) continue;
                  expansionArtistIds.add(id);
                  idsToEnrich.push(id);
                }
              }
              afrobeatsExpansion.artists_enriched = expansionArtistIds.size;
              await ensureArtistPopularity(idsToEnrich, `genre_afrobeats_expand_artists_${market}`);

              for (const item of freshItems) {
                const key = item?.id ? `${item.sourceType}:${item.id}` : "";
                if (!key || seen.has(key)) continue;
                const hasAnyGenreMetadata = (item?.artists ?? []).some((artist: any) => {
                  const genres = artist?.id ? artistGenresById.get(artist.id) : [];
                  return Array.isArray(genres) && genres.length > 0;
                });
                if (hasAnyGenreMetadata) afrobeatsExpansion.with_artist_genre_metadata_count += 1;
                const evidence = afrobeatsArtistGenreEvidenceFor(item?.artists ?? []);
                if (!evidence) continue;
                item.afrobeatsGenreEvidence = evidence;
                seen.add(key);
                candidates.push(item);
                afrobeatsExpansion.artist_genre_pass_count += 1;
                afrobeatsExpansion.returned_to_pipeline_count += 1;
                if (afrobeatsExpansion.returned_to_pipeline_count >= AFROBEATS_VERIFIED_CANDIDATE_TARGET) break;
              }
            }
          }
        }

        const finalDatePassed = candidates.filter(isWithinGenreWindow);
        datePassCount = finalDatePassed.length;
        const finalArtistIds = Array.from(new Set(
          finalDatePassed.flatMap((item: any) => (item?.artists ?? []).map((a: any) => a?.id).filter(Boolean))
        ));
        await ensureArtistPopularity(finalArtistIds as string[], `genre_artists_final_${bucketKey}`);
        const finalPopPassed = finalDatePassed.filter((item) => {
          const maxPop = maxArtistPopularityFor(item?.artists ?? []);
          item.artistPopularity = maxPop;
          return typeof maxPop === "number" && maxPop >= popularityFloor;
        });
        const genreVerifiedDatePassed = bucketKey === "afrobeats"
          ? finalDatePassed.filter((item) => !!afrobeatsArtistGenreEvidenceFor(item?.artists ?? []))
          : finalDatePassed;
        const genreVerifiedPopPassed = bucketKey === "afrobeats"
          ? finalPopPassed.filter((item) => !!afrobeatsArtistGenreEvidenceFor(item?.artists ?? []))
          : finalPopPassed;
        popularityPassCount = genreVerifiedPopPassed.length;
        const afrobeatsUseAllGenreVerified = bucketKey === "afrobeats" && genreVerifiedDatePassed.length > 0;
        const popularityFallbackUsed = (
          (genreVerifiedPopPassed.length === 0 && genreVerifiedDatePassed.length > 0) ||
          afrobeatsUseAllGenreVerified
        );
        const qualityInput = popularityFallbackUsed ? genreVerifiedDatePassed : genreVerifiedPopPassed;

        const dedupeResult = await dedupeDiscoveryItems(qualityInput, {
          hdrs,
          market: marketFixed,
          stagePrefix: `genre_dedupe_${bucketKey}`,
          maxAlbumFetchIds: 20,
          setStage: (next) => { stage = next; },
          ensureArtistPopularity,
          getArtistPopularity: maxArtistPopularityFor,
          normalizeReleaseDate,
          toReleaseTs,
        });
        const qualityDeduped = dedupeResult.items;
        qualityDeduped.sort((a: any, b: any) => compareServerDiscoverFreshness(a, b, nowMs));
        const artistCappedResult = capPerArtist(qualityDeduped, maxPerArtist);

        const finalItems = artistCappedResult.items.slice(0, MAX_RETURN).map((item: any) => {
          const primaryArtist = item?.artists?.[0] ?? { id: null, name: "" };
          return {
            id: item?.id,
            title: item?.title ?? item?.name ?? "",
            artist: primaryArtist?.name ?? "",
            artistId: primaryArtist?.id ?? null,
            artistPopularity: item?.artistPopularity ?? null,
            releaseDate: item?.releaseDateNormalized ?? null,
            spotifyUrl: item?.spotifyUrl ?? null,
            imageUrl: item?.imageUrl ?? null,
            type: isTrackItem(item) ? "track" : "album",
          };
        });

        buckets[bucketKey] = finalItems;
        debugByBucket[bucketKey] = {
          search_raw_count: searchRawCount,
          date_pass_count: datePassCount,
          popularity_pass_count: popularityPassCount,
          popularity_fallback_used: popularityFallbackUsed,
          dedupe_input_count: dedupeResult.stats.dedupe_input_count,
          dedupe_output_count: dedupeResult.stats.dedupe_output_count,
          dropped_tracks_due_to_album_preference: dedupeResult.stats.dropped_tracks_due_to_album_preference,
          albums_fetched_for_substitution: dedupeResult.stats.albums_fetched_for_substitution,
          dropped_variants_count: dedupeResult.stats.dropped_variants_count,
          dropped_variants_bracket_count: dedupeResult.stats.dropped_variants_bracket_count,
          dropped_same_cover_count: dedupeResult.stats.dropped_same_cover_count,
          max_per_artist: maxPerArtist,
          dropped_due_to_artist_cap: artistCappedResult.dropped_due_to_artist_cap,
          returned_count: finalItems.length,
          cutoff_iso: cutoffIso,
          pages_scanned: pagesScanned,
          market: marketFixed,
          popularity_floor: popularityFloor,
          ...(bucketKey === "afrobeats" ? {
            artist_genre_verified_date_count: genreVerifiedDatePassed.length,
            artist_genre_verified_popularity_count: genreVerifiedPopPassed.length,
            afrobeats_expansion: afrobeatsExpansion,
          } : {}),
        };
      }

      const payload: any = {
        market: marketFixed,
        days: daysUsed,
        buckets,
        debug: {
          per_genre: debugByBucket,
          requested_genres: requestedBuckets,
          year: currentYear,
        },
      };
      if (debug) payload.build = BUILD_ID;
      if (debugInfo && debug) {
        payload.debug = {
          ...payload.debug,
          ...debugInfo,
        };
      }
      return { payload, debugByBucket, currentYear };
    };

    const loadGenrePayload = async (requestedBuckets: string[], opts?: { forceRefresh?: boolean }) => {
      const forceRefresh = !!opts?.forceRefresh;
      if (!debug) {
        if (forceRefresh) {
          for (const bucketKey of requestedBuckets) {
            console.log(`[discover-cache] refresh key=genre:${bucketKey}`);
          }
        } else if (requestedBuckets.length) {
          const cachedByBucket = new Map<string, any>();
          let canServeFromCache = true;
          for (const bucketKey of requestedBuckets) {
            const cacheKey = `genre:${bucketKey}`;
            const { payload: cachedPayload, error: cacheReadError } = await readDiscoverCache(cacheKey);
            if (cacheReadError) {
              console.error(`[discover-cache] read-failed key=${cacheKey}`, cacheReadError);
              canServeFromCache = false;
              break;
            }
            if (!isGenreBucketCachePayload(cachedPayload)) {
              console.log(`[discover-cache] miss key=${cacheKey}`);
              canServeFromCache = false;
              break;
            }
            const expectedDays = Math.max(1, Math.min(365, Number.isFinite(Number(url.searchParams.get("days") ?? "30")) ? Number(url.searchParams.get("days") ?? "30") : 30));
            if (!isFreshDiscoverCachePayload(cachedPayload, expectedDays)) {
              canServeFromCache = false;
              break;
            }
            console.log(`[discover-cache] hit key=${cacheKey}`);
            cachedByBucket.set(bucketKey, cachedPayload);
          }

          if (canServeFromCache) {
            const cachedBuckets: Record<string, any[]> = Object.fromEntries(DISCOVER_BUCKET_KEYS.map((k) => [k, [] as any[]]));
            const debugByBucket = createGenreDebugByBucket(DISCOVER_BUCKET_KEYS, {
              maxPerArtist: Math.max(1, Math.min(5, Number.isFinite(Number(url.searchParams.get("max_per_artist") ?? "2")) ? Number(url.searchParams.get("max_per_artist") ?? "2") : 2)),
              cutoffIso: new Date(Date.now() - Math.max(1, Math.min(365, Number.isFinite(Number(url.searchParams.get("days") ?? "30")) ? Number(url.searchParams.get("days") ?? "30") : 30)) * 24 * 60 * 60 * 1000).toISOString(),
              market: "US",
              popularityFloor: Math.max(0, Math.min(100, Number.isFinite(Number(url.searchParams.get("popularity_floor") ?? url.searchParams.get("popularityFloor") ?? url.searchParams.get("min_popularity") ?? "50")) ? Number(url.searchParams.get("popularity_floor") ?? url.searchParams.get("popularityFloor") ?? url.searchParams.get("min_popularity") ?? "50") : 50)),
            });
            let cachedYear = new Date().getUTCFullYear();
            for (const bucketKey of requestedBuckets) {
              const cachedPayload = cachedByBucket.get(bucketKey);
              cachedBuckets[bucketKey] = Array.isArray(cachedPayload?.items) ? cachedPayload.items : [];
              if (cachedPayload?.debug && typeof cachedPayload.debug === "object") {
                debugByBucket[bucketKey] = cachedPayload.debug;
              }
              if (Number.isFinite(Number(cachedPayload?.year))) {
                cachedYear = Number(cachedPayload.year);
              }
            }

            return {
              payload: {
                market: "US",
                days: Math.max(1, Math.min(365, Number.isFinite(Number(url.searchParams.get("days") ?? "30")) ? Number(url.searchParams.get("days") ?? "30") : 30)),
                buckets: cachedBuckets,
                debug: {
                  per_genre: debugByBucket,
                  requested_genres: requestedBuckets,
                  year: cachedYear,
                },
              },
            };
          }
        }
      }

      const computed = await computeGenrePayload(requestedBuckets);
      if (!debug) {
        for (const bucketKey of requestedBuckets) {
          const cacheKey = `genre:${bucketKey}`;
          const computedItems = Array.isArray(computed.payload.buckets[bucketKey])
            ? computed.payload.buckets[bucketKey]
            : [];
          if (computedItems.length === 0) {
            const { payload: existingPayload } = await readDiscoverCache(cacheKey);
            const eligibleExistingItems = filterEligibleCachedDiscoverItems(existingPayload?.items, computed.payload.days);
            if (eligibleExistingItems.length > 0) {
              continue;
            }
          }
          const cachePayload = {
            items: computedItems,
            debug: computed.debugByBucket[bucketKey],
            year: computed.currentYear,
            days: computed.payload.days,
            ts: Date.now(),
            cacheDate: discoverServerDateKey(),
          };
          if (!isGenreBucketCachePayload(cachePayload)) continue;
          const { error: cacheWriteError } = await writeDiscoverCache(cacheKey, cachePayload);
          if (cacheWriteError) {
            console.error(`[discover-cache] write-failed key=${cacheKey}`, cacheWriteError);
          } else {
            console.log(`[discover-cache] write key=${cacheKey}`);
          }
        }
      }
      return { payload: computed.payload };
    };

    if (pathname.endsWith("/discover-refresh")) {
      const refreshSecret = Deno.env.get("DISCOVER_REFRESH_SECRET") ?? "";
      if (!refreshSecret) {
        return new Response(JSON.stringify({ error: "discover refresh secret missing", build: BUILD_ID }), {
          status: 500,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }

      const authHeader = req.headers.get("authorization") ?? "";
      const expectedAuth = `Bearer ${refreshSecret}`;
      if (authHeader !== expectedAuth) {
        return new Response(JSON.stringify({ error: "unauthorized", build: BUILD_ID }), {
          status: 401,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }

      console.log("[discover-refresh] start");
      const refreshTopPicks = async () => {
        const startedAt = Date.now();
        try {
          console.log("[discover-refresh] start key=top_picks");
          const payload = await loadTopPicksPayload({ forceRefresh: true });
          if (!isTopPicksPayload(payload)) throw new Error("invalid top_picks payload");
          console.log("[discover-refresh] success key=top_picks");
          return { key: "top_picks", ok: true, status: 200, duration_ms: Date.now() - startedAt };
        } catch (error) {
          const message = String((error as any)?.message ?? error);
          console.error(`[discover-refresh] failed key=top_picks error=${message}`);
          return { key: "top_picks", ok: false, status: 500, error: message, duration_ms: Date.now() - startedAt };
        }
      };

      const refreshGenreBucket = async (genreKey: string) => {
        const startedAt = Date.now();
        const key = `genre:${genreKey}`;
        try {
          console.log(`[discover-refresh] start key=${key}`);
          const { payload } = await loadGenrePayload([genreKey], { forceRefresh: true });
          const bucketItems = payload?.buckets?.[genreKey];
          if (!Array.isArray(bucketItems)) throw new Error(`invalid ${key} payload`);
          console.log(`[discover-refresh] success key=${key}`);
          return { key, ok: true, status: 200, duration_ms: Date.now() - startedAt };
        } catch (error) {
          const message = String((error as any)?.message ?? error);
          console.error(`[discover-refresh] failed key=${key} error=${message}`);
          return { key, ok: false, status: 500, error: message, duration_ms: Date.now() - startedAt };
        }
      };

      const requestedRefreshGenres = parseDiscoverGenreKeys(url.searchParams.get("genres"));
      const genresToRefresh = requestedRefreshGenres.length ? requestedRefreshGenres : DISCOVER_BUCKET_KEYS;
      const results: Array<{ key: string; ok: boolean; status: number; error?: string; duration_ms: number }> = [];

      results.push(await refreshTopPicks());
      for (const genreKey of genresToRefresh) {
        results.push(await refreshGenreBucket(genreKey));
      }

      const success = results.filter((entry) => entry.ok);
      const failed = results.filter((entry) => !entry.ok);
      const durationMs = Date.now() - startTime;
      console.log(`[discover-refresh] done success=${success.length} failed=${failed.length}`);

      return new Response(JSON.stringify({
        ok: failed.length === 0,
        refreshed_keys: success.map((entry) => entry.key),
        failed_keys: failed.map((entry) => entry.key),
        results,
        success_count: success.length,
        failed_count: failed.length,
        duration_ms: durationMs,
        build: BUILD_ID,
      }), {
        status: failed.length ? 207 : 200,
        headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "DISCOVER-REFRESH", "X-Path": pathname }),
      });
    }

    // Generic search (albums, tracks, artists)
    if (pathname.endsWith("/spotify-search")) {
      if (!q) return new Response("q required", { status: 400, headers: addBuildHeader() });
      const typeParam = type || "album,track,artist";
      const r = await fetchWithTimeout(
        `${API}/search?` + new URLSearchParams({ q, type: typeParam, market, limit: "25" }),
        { headers: hdrs },
        8000,
        "search",
      );
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // Lookup by id (album/track)
    if (pathname.endsWith("/lookup")) {
      if (!id || !lookupType) return new Response("id and lookupType required", { status: 400, headers: addBuildHeader() });
      const kind = lookupType.toLowerCase();
      if (kind !== "album" && kind !== "track") return new Response("lookupType must be album or track", { status: 400, headers: addBuildHeader() });
      const url2 = kind === "album"
        ? `${API}/albums/${id}?` + new URLSearchParams({ market })
        : `${API}/tracks/${id}?` + new URLSearchParams({ market });
      const r = await fetchWithTimeout(url2, { headers: hdrs }, 8000, "lookup");
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // Artist details
    if (pathname.endsWith("/artist")) {
      if (!artistId) return new Response("artistId required", { status: 400, headers: addBuildHeader() });
      const r = await fetchWithTimeout(`${API}/artists/${artistId}`, { headers: hdrs }, 8000, "artist");
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // NEW: artist precise/loose search
    if (pathname.endsWith("/artist-search")) {
      if (!q) return new Response("q required", { status: 400, headers: addBuildHeader() });
      const mode = (url.searchParams.get("mode") ?? "loose").toLowerCase(); // "loose" | "precise"
      const qs = mode === "precise" ? `artist:"${q}"` : q; // loose allows partial text
      const r = await fetchWithTimeout(
        `https://api.spotify.com/v1/search?` +
          new URLSearchParams({ q: qs, type: "artist", market, limit: "15" }),
        { headers: hdrs },
        8000,
        "artist-search"
      );
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // NEW: artist albums (recent first)
    if (pathname.endsWith("/artist-albums")) {
      if (!artistId) return new Response("artistId required", { status: 400, headers: addBuildHeader() });
      const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
      const requestedOffset = Number(url.searchParams.get("offset") ?? "0");
      const artistAlbumsLimit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));
      const artistAlbumsOffset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
      const includeGroups = (url.searchParams.get("include_groups") ?? "album,single,appears_on")
        .split(",")
        .map((group) => group.trim())
        .filter((group) => ["album", "single", "appears_on"].includes(group))
        .join(",") || "album,single,appears_on";
      // Default includes appears_on for artist pages; Discover can request release-only groups.
      const r = await fetchWithTimeout(
        `https://api.spotify.com/v1/artists/${artistId}/albums?` +
          new URLSearchParams({ include_groups: includeGroups, market, limit: String(artistAlbumsLimit), offset: String(artistAlbumsOffset) }),
        { headers: hdrs },
        8000,
        "artist-albums"
      );
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // NEW: artist top tracks
    if (pathname.endsWith("/artist-top-tracks")) {
      if (!artistId) return new Response("artistId required", { status: 400, headers: addBuildHeader() });
      const r = await fetchWithTimeout(
        `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=${market}`,
        { headers: hdrs },
        8000,
        "artist-top-tracks"
      );
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // Related artists
    if (pathname.endsWith("/related")) {
      if (!artistId) return new Response("artistId required", { status: 400, headers: addBuildHeader() });
      const r = await fetchWithTimeout(`${API}/artists/${artistId}/related-artists`, { headers: hdrs }, 8000, "related-artists");
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // Top picks (search-based global trending)
    if (pathname.endsWith("/top-picks")) {
      const payload = await loadTopPicksPayload({ forceRefresh: refresh });
      return buildTopPicksResponse(payload);
    }

    // New releases (Browse) — market aware
    if (pathname.endsWith("/new-releases")) {
  const r = await fetchWithTimeout(`${API}/browse/new-releases?country=${market}&limit=50`, { headers: hdrs }, 8000, "browse:new-releases");
  return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "BROWSE", "X-Path": pathname }) });
    }

    // New releases (Wide) — market-first browse (GB/US) with popularity ranking
    if (pathname.endsWith("/new-releases-wide")) {
      const requestedDays = Number(url.searchParams.get("days") ?? "14");
      const baseDays = Math.max(1, Math.min(14, Number.isFinite(requestedDays) ? requestedDays : 14));
      const targetParam = Math.max(10, Math.min(500, Number(url.searchParams.get("target") ?? "200")));
      const marketsParam = (url.searchParams.get("markets") ?? "").trim();
      const markets = (marketsParam ? marketsParam.split(",") : [])
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean);
      const primaryMarket = (market || (markets[0] ?? 'GB')).toUpperCase();
      const BROWSE_LIMIT = 50;
      const debugWide: any = debug ? {
        gb_count: 0,
        us_count: 0,
        merged_unique_count: 0,
        after_days_filter_count: 0,
        days_window_used: baseDays,
        top_picks_popularity: null,
        threshold_relaxed: { top_picks: false, genres: false },
        per_bucket: {},
        sample_release_dates: [],
      } : null;

      function normalizeDate(s?: string | null): string | null {
        if (!s) return null;
        let x = String(s);
        if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
        else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
        return x;
      }
      function daysAgoFrom(s?: string | null): number {
        const n = normalizeDate(s);
        if (!n) return 9999;
        const t = Date.parse(n);
        if (Number.isNaN(t)) return 9999;
        return Math.max(0, (Date.now() - t) / (24*60*60*1000));
      }
      function recencyBoost(releaseDate?: string | null, halfLifeDays = 7): number {
        const n = normalizeDate(releaseDate);
        if (!n) return 0;
        const t = Date.parse(n);
        if (Number.isNaN(t)) return 0;
        const days = Math.max(0, (Date.now() - t) / (24*60*60*1000));
        const k = Math.LN2 / halfLifeDays;
        return Math.exp(-k * days) * 100;
      }
      function marketBoost(marketsPresent: string[], primary: string): number {
        const set = new Set((marketsPresent ?? []).map((m) => m.toUpperCase()));
        if (set.has('GB') && set.has('US')) return 100;
        if (primary && set.has(primary.toUpperCase())) return 60;
        return 0;
      }

      const browseStatus: Record<string, { status: number; ok: boolean }> = {};
      const byId = new Map<string, { album: any; markets: Set<string> }>();

      async function fetchBrowseMarket(mkt: string) {
        const url2 = `${API}/browse/new-releases?country=${mkt}&limit=${BROWSE_LIMIT}`;
        const r2 = await fetchWithTimeout(url2, { headers: hdrs }, 8000, `browse/new-releases:${mkt}`);
        browseStatus[mkt] = { status: r2.status, ok: r2.ok };
        if (debugInfo && !r2.ok && !debugInfo.spotifyError) {
          debugInfo.spotifyError = { stage: `browse/new-releases:${mkt}`, status: r2.status, message: r2.statusText };
        }
        if (!r2.ok) return [] as any[];
        const j2: any = await r2.json();
        const items = (j2.albums?.items ?? []) as any[];
        if (debugWide) {
          if (mkt === 'GB') debugWide.gb_count = items.length;
          if (mkt === 'US') debugWide.us_count = items.length;
        }
        return items;
      }

      const uniqueMarkets = Array.from(new Set(markets.length ? markets : ['GB', 'US']));
      for (const mkt of uniqueMarkets) {
        try {
          const items = await fetchBrowseMarket(mkt);
          for (const a of items) {
            if (!a?.id) continue;
            const entry = byId.get(a.id);
            if (entry) entry.markets.add(mkt);
            else byId.set(a.id, { album: a, markets: new Set([mkt]) });
          }
        } catch (_) {}
      }

      const merged = Array.from(byId.values()).map(({ album, markets }) => ({
        ...album,
        __markets: Array.from(markets),
      }));

      const candidatesAll = merged.filter((a: any) => (a?.album_type ?? '').toLowerCase() !== 'compilation');
      if (debugWide) debugWide.merged_unique_count = candidatesAll.length;
      if (debugWide) {
        debugWide.sample_release_dates = candidatesAll.slice(0, 5).map((a: any) => ({
          id: a?.id ?? null,
          title: a?.name ?? null,
          release_date: a?.release_date ?? null,
          days_ago: daysAgoFrom(a?.release_date),
        }));
      }
      const candidates14 = candidatesAll.filter((a: any) => daysAgoFrom(a?.release_date) < baseDays);
      const candidatesWindow = candidates14;
      const daysWindowUsed: any = baseDays;
      if (debugWide) {
        debugWide.days_window_used = daysWindowUsed;
        debugWide.after_days_filter_count = candidates14.length;
      }

      if (!candidates14.length) {
        if (debugInfo) {
          debugInfo.sourceBreakdown.spotify = 0;
          debugInfo.sourceBreakdown.apple = 0;
          debugInfo.appleUsed = false;
        }
        const payload: any = { albums: { items: [] } };
        if (debugInfo) payload.debug = { ...debugInfo, ...debugWide, browseStatus };
        return new Response(JSON.stringify(payload), {
          headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "WIDE", "X-Path": pathname, "X-Count": "0" }),
        });
      }

      // Enrich with primary artist popularity/followers and rank by popularity-first with recency + market boost
      try {
        const artistIds = Array.from(new Set(
          candidatesAll.map((a: any) => (a?.artists?.[0]?.id ?? '')).filter((s: string) => !!s)
        ));
        const artistMap = new Map<string, any>();
        for (let i = 0; i < artistIds.length; i += 50) {
          const ids = artistIds.slice(i, i + 50);
          if (!ids.length) continue;
          const ar = await fetchWithTimeout(`${API}/artists?ids=${ids.join(',')}`, { headers: hdrs }, 8000, "artists");
          if (!ar.ok) continue;
          const aj: any = await ar.json();
          for (const art of aj.artists ?? []) artistMap.set(art.id, art);
        }

        for (const a of candidatesAll) {
          const aid = a?.artists?.[0]?.id ?? '';
          const art = aid ? artistMap.get(aid) : null;
          a.artist_popularity = typeof art?.popularity === 'number' ? art.popularity : null;
          a.artist_followers = typeof art?.followers?.total === 'number' ? art.followers.total : null;
        }

        const scoreList = (list: any[]) => {
          const scored = list.map((a: any) => {
            const pop = typeof a?.artist_popularity === 'number' ? a.artist_popularity : 0;
            const rec = recencyBoost(a?.release_date, 7);
            const mb = marketBoost(a?.__markets ?? [], primaryMarket);
            const score = 0.70 * pop + 0.20 * rec + 0.10 * mb;
            const normalizedDate = normalizeDate(a?.release_date) ?? "1970-01-01";
            const releaseTs = Date.parse(normalizedDate);
            return { ...a, __score: score, __pop: pop, releaseTs: Number.isNaN(releaseTs) ? null : releaseTs };
          });
          scored.sort((a: any, b: any) => {
            const bandDiff = discoverServerFreshnessBand(a?.releaseTs, Date.now()) - discoverServerFreshnessBand(b?.releaseTs, Date.now());
            if (bandDiff) return bandDiff;
            if ((b.__score ?? 0) !== (a.__score ?? 0)) return (b.__score ?? 0) - (a.__score ?? 0);
            const dateDiff = (b?.releaseTs ?? 0) - (a?.releaseTs ?? 0);
            if (dateDiff) return dateDiff;
            return (b.__pop ?? 0) - (a.__pop ?? 0);
          });
          return scored;
        };

        const scored14 = scoreList(candidatesWindow);
        const top14 = scored14.filter((a: any) => (a.__pop ?? 0) >= 50);
        let finalPool = top14;
        let daysUsed = baseDays;
        if (top14.length < 8) {
          finalPool = scored14;
          if (debugWide) debugWide.threshold_relaxed.top_picks = true;
        }
        if (debugWide) debugWide.days_window_used = daysUsed;
        if (debugWide) {
          const popVals = finalPool.map((a: any) => (a.__pop ?? 0)).sort((a: number, b: number) => a - b);
          const mid = Math.floor(popVals.length / 2);
          const median = popVals.length ? (popVals.length % 2 ? popVals[mid] : (popVals[mid - 1] + popVals[mid]) / 2) : 0;
          debugWide.top_picks_popularity = { min: popVals[0] ?? 0, median, max: popVals[popVals.length - 1] ?? 0 };
        }

        const capped = finalPool.slice(0, targetParam);
        const items = capped.map((a: any) => {
          const totalTracks = typeof a?.total_tracks === 'number'
            ? a.total_tracks
            : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
          let type: 'album' | 'single' | 'ep' = 'album';
          if ((a?.album_type ?? '').toLowerCase() === 'single') type = 'single';
          else if (totalTracks > 2 && totalTracks <= 6) type = 'ep';
          return {
            id: a.id,
            title: a.name,
            artist: a.artists?.[0]?.name ?? '',
            artistId: a.artists?.[0]?.id ?? null,
            artistPopularity: typeof a?.artist_popularity === 'number' ? a.artist_popularity : null,
            artistFollowers: typeof a?.artist_followers === 'number' ? a.artist_followers : null,
            releaseDate: a.release_date ?? null,
            spotifyUrl: a.external_urls?.spotify ?? null,
            imageUrl: a.images?.[0]?.url ?? null,
            type,
          };
        });

        const payload: any = { albums: { items } };
        if (debug) payload.build = BUILD_ID;
        if (debugInfo) {
          debugInfo.sourceBreakdown.spotify = items.length;
          debugInfo.sourceBreakdown.apple = 0;
          debugInfo.appleUsed = false;
          payload.debug = { ...debugInfo, ...debugWide, browseStatus };
        }
        const body = JSON.stringify(payload);
        return new Response(body, { headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "WIDE", "X-Path": pathname, "X-Count": String(items.length) }) });
      } catch (_) {
        const payload: any = { albums: { items: [] } };
        if (debug) payload.build = BUILD_ID;
        if (debugInfo) payload.debug = { ...debugInfo, ...debugWide, browseStatus };
        return new Response(JSON.stringify(payload), {
          headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "WIDE", "X-Path": pathname, "X-Count": "0" }),
        });
      }
    }

    // New: New releases by genre buckets (robust matching even if subpaths are not forwarded)
    const isGenreRoute = pathname.endsWith("/new-releases-genre");
    try { console.log("PATH", pathname, "NRG?", isGenreRoute); } catch (_) {}
  const handleNewReleasesGenre = async () => {
      if (!token) {
        const errPayload: any = { error: "spotify token missing" };
        if (debug) errPayload.build = BUILD_ID;
        return new Response(JSON.stringify(errPayload), {
          status: 500,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }

      const rawParam = url.searchParams.get("genres");
      if (!rawParam || !rawParam.trim()) {
        const errPayload: any = { error: "genres required" };
        if (debug) errPayload.build = BUILD_ID;
        return new Response(JSON.stringify(errPayload), {
          status: 400,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }

      const requestedBuckets = parseDiscoverGenreKeys(rawParam);
      if (!requestedBuckets.length) {
        const errPayload: any = { error: "genres required" };
        if (debug) errPayload.build = BUILD_ID;
        return new Response(JSON.stringify(errPayload), {
          status: 400,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }
      const { payload } = await loadGenrePayload(requestedBuckets, { forceRefresh: refresh });
      return buildGenreResponse(payload);
  };
  if (isGenreRoute) {
    if (pathname.endsWith("/new-releases-genre") && !url.searchParams.has("genres")) {
      return new Response(JSON.stringify({ build: BUILD_ID, error: "genres required" }), {
        status: 400,
        headers: addBuildHeader({ "Content-Type": "application/json" }),
      });
    }
    try {
      stage = "before_handleNewReleasesGenre";
      return await handleNewReleasesGenre();
    } catch (e) {
      console.error("NRG_ERROR", e);
      const err: any = {
        build: BUILD_ID,
        error: "new-releases-genre failed",
        message: String((e as any)?.message ?? e),
        name: String((e as any)?.name ?? "Error"),
        stack: String((e as any)?.stack ?? ''),
        hint: "check Spotify response/status + params parsing",
      };
      if (typeof (e as any)?.status === "number") err.status = (e as any).status;
      if ((e as any)?.statusText) err.statusText = String((e as any).statusText);
      if ((e as any)?.bodySnippet) err.bodySnippet = String((e as any).bodySnippet);
      err.stage = String((e as any)?.stage ?? stage);
      return new Response(JSON.stringify(err), {
        status: 500,
        headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "NRG-ERROR", "X-Path": pathname }),
      });
    }
  }

    // Direct lookup by ID (handles pasted URLs/IDs for presaves not discoverable via search)
    if (pathname.endsWith("/lookup")) {
  if (!id || (lookupType !== "album" && lookupType !== "track")) {
        return new Response("id and lookupType=album|track required", { status: 400, headers: addBuildHeader() });
      }
      const r = await fetchWithTimeout(`${API}/${lookupType}s/${id}?market=${market}`, { headers: hdrs }, 8000, "lookup-direct");
      return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
    }

    // Default: full-text search (market aware)
    if (!q) {
      const payload: any = { albums:{}, tracks:{}, artists:{} };
      if (debug) {
        payload.debug = {
          rawUrl,
          pathname,
          search: url.search,
          queryKeys: Array.from(url.searchParams.keys()),
          hasGenres: url.searchParams.has("genres"),
          hasDays: url.searchParams.has("days"),
          hasStrict: url.searchParams.has("strict"),
          isGenreRoute,
        };
      }
      return new Response(JSON.stringify(payload), {
        headers: addBuildHeader({ "Content-Type": "application/json", "X-Route": "DEFAULT", "X-Path": pathname }),
      });
    }

    const searchUrl = `${API}/search?` + new URLSearchParams({
      q,
      type,
      market,
      include_external: "audio",
      limit: "20",
    });

    const r = await fetchWithTimeout(searchUrl, { headers: hdrs }, 8000, "search-default");
    return new Response(await r.text(), { headers: addBuildHeader({ "Content-Type": "application/json" }) });
  } catch (err) {
    console.error("TOP_LEVEL_ERROR", err);
    const duration = Date.now() - startTime;
    console.error("EXECUTION_DURATION_MS", duration);
    const payload = debug
      ? {
          build: BUILD_ID,
          error: "top-level failure",
          message: (err as any)?.message,
          name: (err as any)?.name,
          stack: (err as any)?.stack,
          stage: "serve",
          pathname: url.pathname,
        }
      : { error: "internal error", build: BUILD_ID };
    return new Response(JSON.stringify(payload), {
      status: 500,
      headers: addBuildHeader({ "Content-Type": "application/json" }),
    });
  }
});
