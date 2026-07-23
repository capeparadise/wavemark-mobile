import AsyncStorage from '@react-native-async-storage/async-storage';
import { FN_BASE as FN, fetchFn } from './fnBase';
import { getMarket } from './spotify';
import { getArtistGenresCached } from './styleFilters';
import {
  filterDiscoverEligibleReleases,
} from './discoverFreshness';

export type SimpleAlbum = {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  artistPopularity?: number | null;
  artistFollowers?: number | null;
  releaseDate?: string | null;
  spotifyUrl?: string | null;
  imageUrl?: string | null;
  type?: 'album' | 'single' | 'ep' | 'track' | 'project';
  totalTracks?: number | null;
};

const GENRE_BUCKETS: Record<string, string[]> = {
  rap: ['hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'grime', 'uk drill', 'uk rap', 'boom bap', 'pop rap'],
  rnb: ['r&b', 'rnb', 'soul', 'neo-soul', 'contemporary r&b'],
  pop: ['pop', 'dance pop', 'electropop', 'hyperpop', 'teen pop', 'uk pop', 'pop rap', 'pop rock', 'indie pop', 'synthpop'],
  rock: ['rock', 'alt rock', 'alternative rock', 'classic rock', 'punk', 'emo', 'hardcore', 'shoegaze'],
  latin: ['latin', 'reggaeton', 'regional mexican', 'corrido', 'corridos', 'urbano latino', 'bachata', 'salsa'],
  edm: ['edm', 'electronic', 'house', 'techno', 'trance', 'drum and bass', 'dnb', 'dubstep', 'downtempo', 'synthwave', 'electronica'],
  country: ['country', 'alt-country', 'americana', 'country pop'],
  kpop: ['k-pop', 'kpop', 'korean pop'],
  afrobeats: ['afrobeats', 'afrobeat', 'afro-fusion', 'afrofusion', 'amapiano'],
  jazz: ['jazz', 'bebop', 'latin jazz', 'smooth jazz'],
  dancehall: ['dancehall'],
  reggae: ['reggae', 'reggae fusion'],
  indie: ['indie', 'indie pop', 'indie rock', 'bedroom pop', 'indie folk'],
  metal: ['metal', 'death metal', 'black metal', 'metalcore'],
  punk: ['punk', 'pop punk', 'hardcore punk'],
  folk: ['folk', 'singer-songwriter'],
  blues: ['blues'],
  classical: ['classical', 'orchestra', 'orchestral', 'baroque', 'opera'],
  soundtrack: ['soundtrack', 'score', 'ost'],
  ambient: ['ambient', 'chillout', 'lo-fi', 'lofi'],
  jpop: ['j-pop', 'jpop', 'japanese pop'],
  desi: ['desi', 'bollywood', 'punjabi', 'hindi pop', 'indian pop'],
};

const GENRE_BUCKET_ORDER = Object.keys(GENRE_BUCKETS);

let lastGenreBuckets: Record<string, SimpleAlbum[]> | null = null;

function cloneBucketMap(map: Record<string, SimpleAlbum[]>): Record<string, SimpleAlbum[]> {
  const out: Record<string, SimpleAlbum[]> = {};
  for (const [k, v] of Object.entries(map || {})) {
    out[k] = Array.isArray(v) ? [...v] : [];
  }
  return out;
}

export function mapArtistGenresToKeys(artistGenres: string[], limit = 3): string[] {
  const scores: Record<string, number> = {};
  const lower = (artistGenres || []).map((g) => g.toLowerCase());
  for (const g of lower) {
    for (const key of GENRE_BUCKET_ORDER) {
      const keywords = GENRE_BUCKETS[key];
      if (keywords.some((kw) => g.includes(kw))) {
        scores[key] = (scores[key] ?? 0) + 1;
      }
    }
  }
  return GENRE_BUCKET_ORDER
    .filter((k) => scores[k])
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
    .slice(0, Math.max(1, Math.min(3, limit)));
}

function isRecent(date?: string | null, days = 21) {
  if (!date) return false;
  // Normalize precision: YYYY -> YYYY-07-01, YYYY-MM -> YYYY-MM-15
  let s = String(date);
  if (/^\d{4}$/.test(s)) s = `${s}-07-01`;
  else if (/^\d{4}-\d{2}$/.test(s)) s = `${s}-15`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  const diffDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
  return diffDays <= days;
}

export async function getNewReleases(days = 21, marketIn?: string): Promise<SimpleAlbum[]> {
  const market = (marketIn ?? getMarket()).toUpperCase();
  const cacheKey = `nr:${market}:${days}`;
  try {
    // 1) Try wide collector first (paged search)
    let primary: Response | null = null;
    try {
      primary = await fetchFn(`${FN}/spotify-search/new-releases-wide?` + new URLSearchParams({ market, days: String(days), target: '250' }));
    } catch {}

    // 2) Fallback to curated browse if wide failed
    const r = primary && primary.ok ? primary : await fetchFn(`${FN}/spotify-search/new-releases?` + new URLSearchParams({ market }));
    if (r && r.ok) {
      const data: any = await r.json();
      const items = data.albums?.items ?? [];
      const normalizeItem = (a: any): SimpleAlbum => {
        const title = a?.title ?? a?.name ?? '';
        const artist = a?.artist ?? a?.artists?.[0]?.name ?? '';
        const artistId = a?.artistId ?? a?.artists?.[0]?.id ?? null;
        const releaseDate = a?.releaseDate ?? a?.release_date ?? null;
        const spotifyUrl = a?.spotifyUrl ?? a?.external_urls?.spotify ?? null;
        const imageUrl = a?.imageUrl ?? a?.images?.[0]?.url ?? null;
        const artistPopularity = typeof a?.artistPopularity === 'number'
          ? a.artistPopularity
          : (typeof a?.artist_popularity === 'number' ? a.artist_popularity : null);
        const artistFollowers = typeof a?.artistFollowers === 'number'
          ? a.artistFollowers
          : (typeof a?.artist_followers === 'number' ? a.artist_followers : null);
        let type: 'album' | 'single' | 'ep' | undefined = a?.type;
        if (!type) {
          const totalTracks = typeof a?.total_tracks === 'number'
            ? a.total_tracks
            : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
          if ((a?.album_type ?? '').toLowerCase() === 'single') type = 'single';
          else if (totalTracks > 2 && totalTracks <= 6) type = 'ep';
          else type = 'album';
        }
        return {
          id: a.id,
          title,
          artist,
          artistId,
          artistPopularity,
          artistFollowers,
          releaseDate,
          spotifyUrl,
          imageUrl,
          type,
        };
      };
      const mapped: SimpleAlbum[] = items
        .filter((a: any) => (a?.album_type ?? '').toLowerCase() !== 'compilation')
        .map(normalizeItem);
      const TARGET = 40;    // cap for UI

      const sortNewest = (arr: SimpleAlbum[]) =>
        [...arr].sort((a, b) => {
          const norm = (s?: string | null) => {
            if (!s) return '1970-01-01';
            let x = String(s);
            if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
            else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
            return x;
          };
          return Date.parse(norm(b.releaseDate)) - Date.parse(norm(a.releaseDate));
        });
      const dedupe = (arr: SimpleAlbum[]) => {
        const seen = new Set<string>();
        const out: SimpleAlbum[] = [];
        for (const a of arr) {
          const k1 = (a.id || '').toString();
          const k2 = `${(a.title || '').toLowerCase()}::${(a.artist || '').toLowerCase()}`;
          if (k1 && seen.has(k1)) continue;
          if (seen.has(k2)) continue;
          if (k1) seen.add(k1);
          seen.add(k2);
          out.push(a);
        }
        return out;
      };

      const fresh = dedupe(sortNewest(mapped.filter((m: SimpleAlbum) => isRecent(m.releaseDate, days)))).slice(0, TARGET);
      // Persist for offline/rate-limit fallback (avoid clobbering cache with empty on flaky responses)
      try {
        if (fresh.length > 0) {
          await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: fresh }));
        }
      } catch {}
      return fresh;
    }
  } catch {}
  // Return last eligible cache if the provider request failed.
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Array.isArray(cached.items)) return filterDiscoverEligibleReleases(cached.items, { days }) as SimpleAlbum[];
    }
  } catch {}
  return [];
}

// Curated browse-only list (for small carousel)
export async function getNewReleasesBrowse(days = 28, marketIn?: string): Promise<SimpleAlbum[]> {
  const market = (marketIn ?? getMarket()).toUpperCase();
  try {
    const r = await fetchFn(`${FN}/spotify-search/new-releases?` + new URLSearchParams({ market }));
    if (!r.ok) return [];
    const data: any = await r.json();
    const items = data.albums?.items ?? [];
    const normalizeItem = (a: any): SimpleAlbum => {
      const title = a?.title ?? a?.name ?? '';
      const artist = a?.artist ?? a?.artists?.[0]?.name ?? '';
      const artistId = a?.artistId ?? a?.artists?.[0]?.id ?? null;
      const releaseDate = a?.releaseDate ?? a?.release_date ?? null;
      const spotifyUrl = a?.spotifyUrl ?? a?.external_urls?.spotify ?? null;
      const imageUrl = a?.imageUrl ?? a?.images?.[0]?.url ?? null;
      const artistPopularity = typeof a?.artistPopularity === 'number'
        ? a.artistPopularity
        : (typeof a?.artist_popularity === 'number' ? a.artist_popularity : null);
      const artistFollowers = typeof a?.artistFollowers === 'number'
        ? a.artistFollowers
        : (typeof a?.artist_followers === 'number' ? a.artist_followers : null);
      let type: 'album' | 'single' | 'ep' | undefined = a?.type;
      if (!type) {
        const totalTracks = typeof a?.total_tracks === 'number'
          ? a.total_tracks
          : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
        if ((a?.album_type ?? '').toLowerCase() === 'single') type = 'single';
        else if (totalTracks > 2 && totalTracks <= 6) type = 'ep';
        else type = 'album';
      }
      return {
        id: a.id,
        title,
        artist,
        artistId,
        artistPopularity,
        artistFollowers,
        releaseDate,
        spotifyUrl,
        imageUrl,
        type,
      };
    };
    const mapped: SimpleAlbum[] = items
      .filter((a: any) => (a?.album_type ?? '').toLowerCase() !== 'compilation')
      .map(normalizeItem);
    return mapped.filter((m) => isRecent(m.releaseDate, days));
  } catch {
    return [];
  }
}

export async function getWesternNewReleases(days = 42, target = 200, marketsIn?: string[]): Promise<SimpleAlbum[]> {
  const markets = (marketsIn && marketsIn.length ? marketsIn : ['US', 'GB']).map((m) => m.toUpperCase());
  const scoped = await Promise.all(markets.map(async (market) => {
    try {
      const items = await getNewReleasesWide(days, Math.max(50, Math.min(400, target)), market);
      return { market, items };
    } catch {
      return { market, items: [] as SimpleAlbum[] };
    }
  }));

  const scored: Array<{ item: SimpleAlbum; score: number }> = [];
  const scoreFor = (idx: number, len: number, bias: number) => {
    const rank = len > 0 ? (1 - (idx / len)) : 0;
    return bias + rank;
  };
  scoped.forEach(({ market, items }) => {
    const bias = market === 'US' ? 1.0 : market === 'GB' ? 0.9 : 0.7;
    items.forEach((item, idx) => {
      scored.push({ item, score: scoreFor(idx, items.length, bias) });
    });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return releaseDateSort(a.item, b.item);
  });

  const MIN_POP = 35;
  const MIN_FOLLOWERS = 50_000;
  const isPopular = (it: SimpleAlbum) => {
    const pop = typeof it.artistPopularity === 'number' ? it.artistPopularity : 0;
    const followers = typeof it.artistFollowers === 'number' ? it.artistFollowers : 0;
    return pop >= MIN_POP || followers >= MIN_FOLLOWERS;
  };

  const buildList = (pool: Array<{ item: SimpleAlbum; score: number }>) => {
    const seen = new Set<string>();
    const out: SimpleAlbum[] = [];
    for (const s of pool) {
      const id = String(s.item.id || '');
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(s.item);
      if (out.length >= target) break;
    }
    return out;
  };

  let out = buildList(scored.filter((s) => isPopular(s.item)));
  if (out.length < Math.max(30, Math.floor(target * 0.4))) {
    // Relax filter if too sparse
    out = buildList(scored.filter((s) => {
      const pop = typeof s.item.artistPopularity === 'number' ? s.item.artistPopularity : 0;
      const followers = typeof s.item.artistFollowers === 'number' ? s.item.artistFollowers : 0;
      return pop >= 25 || followers >= 20_000;
    }));
  }
  if (out.length < Math.max(20, Math.floor(target * 0.25))) {
    out = buildList(scored);
  }

  if (!out.length) {
    return await getNewReleases(days, markets[0]);
  }
  return out;
}

export async function getTopPicks(days = 30): Promise<SimpleAlbum[]> {
  const mapTopPicks = (items: any[]) => {
    const mapped: SimpleAlbum[] = (items || []).map((a: any) => ({
      id: a?.id ?? '',
      title: a?.title ?? a?.name ?? '',
      artist: a?.artist ?? a?.artists?.[0]?.name ?? '',
      artistId: a?.artistId ?? a?.artists?.[0]?.id ?? null,
      artistPopularity: typeof a?.artistPopularity === 'number' ? a.artistPopularity : null,
      artistFollowers: typeof a?.artistFollowers === 'number' ? a.artistFollowers : null,
      releaseDate: a?.releaseDate ?? a?.release_date ?? null,
      spotifyUrl: a?.spotifyUrl ?? a?.external_urls?.spotify ?? null,
      imageUrl: a?.imageUrl ?? a?.images?.[0]?.url ?? null,
      type: a?.type === 'track' ? 'track' : (a?.type === 'album' ? 'album' : undefined),
    }));
    return filterDiscoverEligibleReleases(mapped).filter((x: SimpleAlbum) => !!x.id && !!x.spotifyUrl);
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (attempt > 0) params.set('refresh', '1');
      const r = await fetchFn(`${FN}/spotify-search/top-picks?` + params);
      if (!r.ok) continue;
      const data: any = await r.json();
      const items = Array.isArray(data?.items)
        ? data.items
        : (Array.isArray(data?.albums?.items) ? data.albums.items : []);
      const mapped = mapTopPicks(items);
      if (mapped.length > 0) return mapped;
    } catch {}
  }
  throw new Error('top-picks failed');
}

// Wide collector list (for See All)
export async function getNewReleasesWide(days = 28, target = 250, marketIn?: string): Promise<SimpleAlbum[]> {
  const market = (marketIn ?? getMarket()).toUpperCase();
  const devLog = (typeof __DEV__ !== 'undefined') && __DEV__;
  const params = new URLSearchParams({ market, days: String(days), target: String(Math.max(10, Math.min(500, target))) });
  try {
    const r = await fetchFn(`${FN}/spotify-search/new-releases-wide?` + params);
    if (devLog) {
      console.log('[new-releases-wide][status]', { ok: r.ok, status: r.status, url: r.url });
    }
    if (!r.ok) throw new Error('wide failed');
    const raw = await r.text();
    if (devLog) {
      console.log('[new-releases-wide][raw]', raw.slice(0, 300));
    }
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      if (devLog) console.log('[new-releases-wide][parse-error]', String((e as any)?.message ?? e));
      throw e;
    }
    if (devLog) {
      console.log('[new-releases-wide][parsed keys]', Object.keys(data ?? {}));
      console.log('[new-releases-wide][first item]', data?.albums?.items?.[0] ?? null);
    }
    const items = data.albums?.items ?? [];
    if (devLog) {
      const first = items?.[0] ?? null;
      const isMinimal = !!first && (first.title != null || first.artist != null || first.spotifyUrl != null || first.imageUrl != null || first.releaseDate != null || first.artistId != null);
      const isOld = !!first && (first.name != null || Array.isArray(first.artists) || first.album_type != null || first.external_urls != null);
      const pathLabel = !first
        ? 'parsed as empty items'
        : (isMinimal && !isOld)
          ? 'parsed as spotify minimal shape'
          : isOld
            ? 'parsed as old spotify shape'
            : 'parsed as unknown shape';
      console.log('[new-releases-wide][path]', pathLabel);
    }
    const mapped: SimpleAlbum[] = items
      .filter((a: any) => (a?.album_type ?? '').toLowerCase() !== 'compilation')
      .map((a: any) => {
        const totalTracks = typeof a?.total_tracks === 'number' ? a.total_tracks : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
        let type: 'album' | 'single' | 'ep';
        if ((a?.album_type ?? '').toLowerCase() === 'single') type = 'single';
        else if (totalTracks > 2 && totalTracks <= 6) type = 'ep';
        else type = 'album';
        return {
          id: a.id,
          title: a.name,
          artist: a.artists?.[0]?.name ?? '',
          artistId: a.artists?.[0]?.id ?? null,
          artistPopularity: typeof (a as any).artist_popularity === 'number' ? (a as any).artist_popularity : null,
          artistFollowers: typeof (a as any).artist_followers === 'number' ? (a as any).artist_followers : null,
          releaseDate: a.release_date ?? null,
          spotifyUrl: a.external_urls?.spotify ?? null,
          imageUrl: a.images?.[0]?.url ?? null,
          type,
        };
      });
    // Defensive: re-check recency, sort newest-first, dedupe
    const sortNewest = (arr: SimpleAlbum[]) => [...arr].sort((a, b) => {
      const norm = (s?: string | null) => {
        if (!s) return '1970-01-01';
        let x = String(s);
        if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
        else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
        return x;
      };
      return Date.parse(norm(b.releaseDate)) - Date.parse(norm(a.releaseDate));
    });
    const dedupe = (arr: SimpleAlbum[]) => {
      const seen = new Set<string>();
      const out: SimpleAlbum[] = [];
      for (const a of arr) {
        const k1 = (a.id || '').toString();
        const k2 = `${(a.title || '').toLowerCase()}::${(a.artist || '').toLowerCase()}`;
        if (k1 && seen.has(k1)) continue;
        if (seen.has(k2)) continue;
        if (k1) seen.add(k1);
        seen.add(k2);
        out.push(a);
      }
      return out;
    };
  const filtered = mapped.filter((m) => isRecent(m.releaseDate, days));
  // Preserve server ordering (already popularity-first with recency lift); only dedupe + cap
  return dedupe(filtered).slice(0, Math.max(10, Math.min(500, target)));
  } catch {
    if (devLog) console.log('[new-releases-wide][path]', 'fallback to browse');
    // Fallback: use curated if wide fails
    return getNewReleasesBrowse(days, market);
  }
}

export async function getNewReleasesByGenre(opts?: { genres?: string[]; days?: number; market?: string; strict?: boolean; mode?: 'light' | 'full' }): Promise<Record<string, SimpleAlbum[]>> {
  const allKeys = ['rap','rnb','pop','rock','latin','edm','country','kpop','afrobeats','jazz','dancehall','reggae','indie','metal','punk','folk','blues','classical','soundtrack','ambient','jpop','desi'];
  const normalizeGenreKey = (k: string) => {
    const raw = (k || '').toString();
    const lower = raw.toLowerCase();
    if (lower === 'hiphop' || lower === 'hip-hop' || lower === 'hip hop' || lower === 'hiphop') return 'rap';
    if (lower === 'r&b' || lower === 'rb') return 'rnb';
    if (lower === 'electronic') return 'edm';
    return lower;
  };
  const requestKeys = (opts?.genres && opts.genres.length > 0) ? opts.genres : allKeys.slice(0,10);
  const clientKeys = Array.from(new Set(requestKeys.map((k) => (k || '').toString())));
  const serverKeys = Array.from(new Set(clientKeys.map(normalizeGenreKey)));
  const genres = serverKeys.join(',');
  if (__DEV__) {
    try {
      console.log('NRG requested client keys:', clientKeys, 'server keys:', serverKeys);
    } catch {}
  }
  const days = String(opts?.days ?? 28);
  const market = (opts?.market ?? getMarket()).toUpperCase();
  const strict = (opts?.strict ?? true) ? '1' : '0';
  const mode = opts?.mode ?? 'full';
  const url = `${FN}/spotify-search/new-releases-genre?` + new URLSearchParams({ genres, days, market, strict, mode, refresh: '1' });
  const mapToClientBuckets = (source: Record<string, SimpleAlbum[]>) => {
    const out: Record<string, SimpleAlbum[]> = {};
    for (const clientKey of clientKeys) {
      const serverKey = normalizeGenreKey(clientKey);
      const items = [...(source?.[serverKey] ?? [])];
      out[clientKey] = items;
    }
    return out;
  };
  const logBuckets = (label: string, map: Record<string, SimpleAlbum[]>) => {
    if (!__DEV__) return;
    try {
      const counts = clientKeys.map((k) => `${k}=${(map[k]?.length ?? 0)}`).join(' ');
      console.log(`NRG ${label} counts:`, counts);
      for (const k of clientKeys) {
        const sample = (map[k] ?? []).slice(0, 3).map((it) => it?.id ?? it?.title ?? '');
        console.log(`NRG sample ${k}:`, sample);
      }
    } catch {}
  };
  const cachedBuckets = lastGenreBuckets ? mapToClientBuckets(lastGenreBuckets) : null;
  const hasCached = !!cachedBuckets && Object.values(cachedBuckets).some((arr) => Array.isArray(arr) && arr.length > 0);
  const r = await fetchFn(url).catch(() => null as any);
  let data: any = null;
  if (r && r.ok) {
    try { data = await r.json(); } catch {}
  }
  if (data && data.buckets && typeof data.buckets === 'object') {
    const buckets = data.buckets as Record<string, SimpleAlbum[]>;
    if (__DEV__) {
      try {
        console.log("NRG buckets keys:", Object.keys(data.buckets || {}), "counts:", Object.fromEntries(Object.entries(data.buckets || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])));
      } catch {}
    }
    const serverBuckets = cloneBucketMap(buckets);
    const clientBuckets = mapToClientBuckets(serverBuckets);
    logBuckets('final', clientBuckets);
    const anyFinal = clientKeys.some((k) => (clientBuckets[k]?.length ?? 0) > 0);
    if (anyFinal) {
      lastGenreBuckets = cloneBucketMap(serverBuckets);
      return clientBuckets as any;
    }
    if (hasCached) return cachedBuckets as any;
    return clientBuckets as any;
  }
  if (hasCached) return cachedBuckets as any;
  return Object.fromEntries(clientKeys.map(k => [k, []])) as any;
}

type MoreLikeThisResult = {
  items: SimpleAlbum[];
  label: 'More like this' | 'New releases' | 'Similar releases';
  source: 'genre' | 'new_releases';
  seedKeys: string[];
};

const normalizeDate = (input?: string | null) => {
  if (!input) return '1970-01-01';
  let s = String(input);
  if (/^\d{4}$/.test(s)) s = `${s}-07-01`;
  else if (/^\d{4}-\d{2}$/.test(s)) s = `${s}-15`;
  return s;
};

const releaseDateSort = (a: SimpleAlbum, b: SimpleAlbum) => {
  return Date.parse(normalizeDate(b.releaseDate)) - Date.parse(normalizeDate(a.releaseDate));
};

function excludeRelease(items: SimpleAlbum[], releaseId?: string | null) {
  if (!releaseId) return items;
  const rid = String(releaseId);
  return items.filter((it) => {
    if (!it) return false;
    if (String(it.id) === rid) return false;
    if (it.spotifyUrl && it.spotifyUrl.includes(`/${rid}`)) return false;
    return true;
  });
}

async function toneSort(items: SimpleAlbum[], seedKeys: string[]): Promise<SimpleAlbum[]> {
  if (!seedKeys.length) return items.sort(releaseDateSort);
  const scored = await Promise.all(items.map(async (item) => {
    if (!item.artistId) return { item, score: 0 };
    try {
      const artistGenres = await getArtistGenresCached(item.artistId);
      const candidateKeys = mapArtistGenresToKeys(artistGenres, 6);
      const overlap = candidateKeys.filter((k) => seedKeys.includes(k)).length;
      return { item, score: overlap };
    } catch {
      return { item, score: 0 };
    }
  }));
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => releaseDateSort(a.item, b.item))
    .map((s) => s.item);
}

async function fetchBucketsForKeys(keys: string[], days: number, market: string, strict: boolean) {
  if (!keys.length) return [];
  const buckets = await getNewReleasesByGenre({ genres: keys, days, market, strict, mode: 'full' });
  const merged: SimpleAlbum[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    for (const item of (buckets[k] || [])) {
      const id = String(item.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

async function fetchBucketsForKeysStrict(keys: string[], days: number, market: string, strict: boolean) {
  if (!keys.length) return [];
  const params = new URLSearchParams({
    genres: keys.join(','),
    days: String(days),
    market,
    strict: strict ? '1' : '0',
    mode: 'full',
  });
  const r = await fetchFn(`${FN}/spotify-search/new-releases-genre?` + params).catch(() => null as any);
  if (!r || !r.ok) return [];
  let data: any = null;
  try { data = await r.json(); } catch {}
  if (!data || !data.buckets || typeof data.buckets !== 'object') return [];
  const buckets = data.buckets as Record<string, SimpleAlbum[]>;
  const merged: SimpleAlbum[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    for (const item of (buckets[k] || [])) {
      const id = String(item.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

export async function getMoreLikeThisForRelease(opts: {
  artistId?: string | null;
  releaseId?: string | null;
  days?: number;
  market?: string;
  strict?: boolean;
  limit?: number;
  mode?: 'release_similar_strict';
}): Promise<MoreLikeThisResult> {
  const market = (opts.market ?? getMarket()).toUpperCase();
  const days = Math.max(7, Number(opts.days ?? 180));
  const strict = opts.strict ?? false;
  const limit = Math.max(8, Math.min(80, Number(opts.limit ?? 24)));
  const debugReleaseId = String(opts.releaseId ?? '');
  const strictMode = opts.mode === 'release_similar_strict';

  const artistGenres = await getArtistGenresCached(opts.artistId);
  const seedKeys = mapArtistGenresToKeys(artistGenres, 3);
  if (__DEV__ && debugReleaseId === '4jl9SU1GmpIVhHMuY7uvX7') {
    // J. Cole release debug
    console.log('[more-like-this][seed]', {
      artistId: opts.artistId ?? null,
      artistGenres,
      seedKeys,
    });
  }
  if (!seedKeys.length) {
    return {
      items: [],
      label: 'Similar releases',
      source: 'genre',
      seedKeys,
    };
  }

  const attemptKeys = async (keys: string[], dayWindow: number) => {
    const items = strictMode
      ? await fetchBucketsForKeysStrict(keys, dayWindow, market, strict)
      : await fetchBucketsForKeys(keys, dayWindow, market, strict);
    const filtered = excludeRelease(items, opts.releaseId);
    if (__DEV__ && debugReleaseId === '4jl9SU1GmpIVhHMuY7uvX7') {
      console.log('[more-like-this][bucket-call]', {
        genresParam: keys,
        strict,
        days: dayWindow,
        count: filtered.length,
      });
    }
    return filtered;
  };

  const MIN = 14;
  let keys = seedKeys.slice(0, 1);
  let items: SimpleAlbum[] = keys.length ? await attemptKeys(keys, days) : [];

  if (items.length < MIN && seedKeys.length >= 2) {
    keys = seedKeys.slice(0, 2);
    items = await attemptKeys(keys, days);
  }
  if (items.length < MIN && seedKeys.length >= 3) {
    keys = seedKeys.slice(0, 3);
    items = await attemptKeys(keys, days);
  }
  if (items.length < MIN) {
    items = await attemptKeys(keys, Math.max(days, 365));
  }

  if (items.length) {
    const sorted = await toneSort(items, keys);
    if (sorted.length) {
      return {
        items: sorted.slice(0, limit),
        label: strictMode ? 'Similar releases' : 'More like this',
        source: 'genre',
        seedKeys: keys,
      };
    }
    if (strictMode) {
      return {
        items: [],
        label: 'Similar releases',
        source: 'genre',
        seedKeys: keys,
      };
    }
  }

  if (strictMode) {
    return {
      items: [],
      label: 'Similar releases',
      source: 'genre',
      seedKeys,
    };
  }

  const fallback = excludeRelease(await getNewReleases(28, market), opts.releaseId);
  return {
    items: fallback.sort(releaseDateSort).slice(0, limit),
    label: 'New releases',
    source: 'new_releases',
    seedKeys,
  };
}

export async function getRelatedArtists(artistId: string): Promise<{ id: string; name: string; url?: string }[]> {
  const r = await fetchFn(`${FN}/spotify-search/related?artistId=${encodeURIComponent(artistId)}`);
  if (!r.ok) return [];
  const data: any = await r.json();
  return (data.artists ?? []).map((ar: any) => ({
    id: ar.id,
    name: ar.name,
    url: ar.external_urls?.spotify ?? undefined,
  }));
}
