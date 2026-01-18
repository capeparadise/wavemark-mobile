import AsyncStorage from '@react-native-async-storage/async-storage';
import { FN_BASE as FN } from './fnBase';
import { getMarket } from './spotify';

export type SimpleAlbum = {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  releaseDate?: string | null;
  spotifyUrl?: string | null;
  imageUrl?: string | null;
  type?: 'album' | 'single' | 'ep';
};

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
      primary = await fetch(`${FN}/spotify-search/new-releases-wide?` + new URLSearchParams({ market, days: String(days), target: '250' }));
    } catch {}

    // 2) Fallback to curated browse if wide failed
    const r = primary && primary.ok ? primary : await fetch(`${FN}/spotify-search/new-releases?` + new URLSearchParams({ market }));
    if (r && r.ok) {
      const data: any = await r.json();
      const items = data.albums?.items ?? [];
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
            releaseDate: a.release_date ?? null,
            spotifyUrl: a.external_urls?.spotify ?? null,
            imageUrl: a.images?.[0]?.url ?? null,
            type,
          };
        });
      // Build list with progressive top-ups to avoid tiny buckets
      const MIN = 16;       // minimum items to feel substantial
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

      let out = mapped.filter((m: SimpleAlbum) => isRecent(m.releaseDate, days));

      // If too small, widen to ~90 days and top-up
      if (out.length < MIN) {
        const relaxedWindow = Math.max(days, 90);
        const relaxed = mapped.filter((m: SimpleAlbum) => isRecent(m.releaseDate, relaxedWindow));
        out = dedupe(sortNewest([...out, ...relaxed]));
      }

      // If still small, blend in Apple fallback (newest-first)
      if (out.length < MIN) {
        const apple = await getAppleNewReleases(Math.max(days, 45), market);
        if (apple.length > 0) {
          out = dedupe(sortNewest([...out, ...apple]));
        }
      }

      // Last resort: if still empty, return most recent Spotify items regardless of window
      if (out.length === 0 && mapped.length > 0) {
        out = sortNewest(mapped).slice(0, 20);
      }

      // Cap for UI
  const fresh = out.slice(0, TARGET);
      // Persist for offline/rate-limit fallback (avoid clobbering cache with empty on flaky responses)
      try {
        if (fresh.length > 0) {
          await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: fresh }));
        }
      } catch {}
      return fresh;
    }
  } catch {}
  // Network/API error or non-OK: try Apple fallback next
  try {
    const apple = await getAppleNewReleases(Math.max(days, 45), market);
    if (apple.length > 0) return apple;
  } catch {}
  // Then return last cached if any
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Array.isArray(cached.items)) return cached.items as SimpleAlbum[];
    }
  } catch {}
  return [];
}

// Curated browse-only list (for small carousel)
export async function getNewReleasesBrowse(days = 28, marketIn?: string): Promise<SimpleAlbum[]> {
  const market = (marketIn ?? getMarket()).toUpperCase();
  try {
    const r = await fetch(`${FN}/spotify-search/new-releases?` + new URLSearchParams({ market }));
    if (!r.ok) return [];
    const data: any = await r.json();
    const items = data.albums?.items ?? [];
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
          releaseDate: a.release_date ?? null,
          spotifyUrl: a.external_urls?.spotify ?? null,
          imageUrl: a.images?.[0]?.url ?? null,
          type,
        };
      });
    return mapped.filter((m) => isRecent(m.releaseDate, days));
  } catch {
    return [];
  }
}

// Wide collector list (for See All)
export async function getNewReleasesWide(days = 28, target = 250, marketIn?: string): Promise<SimpleAlbum[]> {
  const market = (marketIn ?? getMarket()).toUpperCase();
  const params = new URLSearchParams({ market, days: String(days), target: String(Math.max(10, Math.min(500, target))) });
  try {
    const r = await fetch(`${FN}/spotify-search/new-releases-wide?` + params);
    if (!r.ok) throw new Error('wide failed');
    const data: any = await r.json();
    const items = data.albums?.items ?? [];
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
    // Fallback: use curated if wide fails
    return getNewReleasesBrowse(days, market);
  }
}

export async function getNewReleasesByGenre(opts?: { genres?: string[]; days?: number; market?: string; strict?: boolean; mode?: 'light' | 'full' }): Promise<Record<string, SimpleAlbum[]>> {
  const allKeys = ['rap','rnb','pop','rock','latin','edm','country','kpop','afrobeats','jazz','dancehall','reggae','indie','metal','punk','folk','blues','classical','soundtrack','ambient','jpop','desi'];
  const genres = ((opts?.genres && opts.genres.length > 0) ? opts.genres : allKeys.slice(0,10)).join(',');
  const days = String(opts?.days ?? 28);
  const market = (opts?.market ?? getMarket()).toUpperCase();
  const strict = (opts?.strict ?? true) ? '1' : '0';
  const mode = opts?.mode ?? 'full';
  const url = `${FN}/spotify-search/new-releases-genre?` + new URLSearchParams({ genres, days, market, strict, mode });
  const r = await fetch(url).catch(() => null as any);
  let data: any = null;
  if (r && r.ok) {
    try { data = await r.json(); } catch {}
  }
  if (data && data.buckets && typeof data.buckets === 'object') {
    const buckets = data.buckets as Record<string, SimpleAlbum[]>;
    const keys = (opts?.genres && opts.genres.length > 0) ? opts.genres : (Object.keys(buckets ?? {}));
    const MIN_LANE = 20;
    // If sparse, top-up with client builders
    const sparseKeys = keys.filter((k) => !Array.isArray(buckets[k]) || (buckets[k]?.length ?? 0) < MIN_LANE);
    if (sparseKeys.length) {
      try {
        // Build from top artists for only sparse keys
        const built = await buildBucketsFromTopArtists(sparseKeys, Number(days), market);
        for (const k of sparseKeys) {
          const base = Array.isArray(buckets[k]) ? buckets[k] : [];
          const extra = Array.isArray(built[k]) ? built[k] : [];
          if (extra.length) {
            // Merge, dedupe by id, sort newest first
            const all = [...base, ...extra];
            const seen = new Set<string>();
            const merged: SimpleAlbum[] = [];
            for (const a of all) {
              const id = (a.id || '').toString();
              if (id && seen.has(id)) continue;
              if (id) seen.add(id);
              merged.push(a);
            }
            // Preserve incoming order which is already popularity-first with a recency lift
            buckets[k] = merged.slice(0, 100);
          }
        }
      } catch {}
    }
    // If still extremely sparse (all lanes < MIN_LANE), try Apple for all requested keys
    const stillSparse = keys.every((k) => (buckets[k]?.length ?? 0) < MIN_LANE);
    if (stillSparse) {
      try {
        const apple = await buildBucketsFromApple(keys, Number(days), market);
        for (const k of keys) {
          if ((buckets[k]?.length ?? 0) >= MIN_LANE) continue;
          const base = Array.isArray(buckets[k]) ? buckets[k] : [];
          const extra = Array.isArray(apple[k]) ? apple[k] : [];
          if (extra.length) {
            const seen = new Set(base.map((a) => a.id));
            const merged = base.concat(extra.filter((a) => !seen.has(a.id)));
            merged.sort((a, b) => (Date.parse(String(b.releaseDate || '1970-01-01')) - Date.parse(String(a.releaseDate || '1970-01-01'))));
            buckets[k] = merged.slice(0, 100);
          }
        }
      } catch {}
    }
    return buckets as any;
  }
  // Fallback: server returned unexpected shape (e.g., default search route). Fan out flat new releases.
  try {
    const flat = await getNewReleases(Number(days), market);
    const keys = (opts?.genres && opts.genres.length > 0) ? opts.genres : allKeys.slice(0,10);
    if (flat.length > 0) {
      const filled = Object.fromEntries(keys.map(k => [k, flat.slice(0, 15)]));
      return filled as any;
    }
    // Deep fallback: build per-genre buckets from top artists to avoid total empties
    const built = await buildBucketsFromTopArtists(keys, Number(days), market);
  const anyBuilt = Object.values(built).some((arr) => Array.isArray(arr) && arr.length > 0);
  if (anyBuilt) return built;
  // Last resort: Apple iTunes-based fallback (best-effort)
  const apple = await buildBucketsFromApple(keys, Number(days), market);
  return apple;
  } catch {
    return Object.fromEntries(allKeys.map(k => [k, []])) as any;
  }
}

async function buildBucketsFromTopArtists(keys: string[], days: number, market: string): Promise<Record<string, SimpleAlbum[]>> {
  const cacheKey = `nrgfa:${market}:${days}:${keys.join(',')}`;
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && typeof cached.ts === 'number' && (Date.now() - cached.ts) < 60_000) {
        return cached.buckets as Record<string, SimpleAlbum[]>;
      }
    }
  } catch {}

  const queryMap: Record<string, string> = {
    rap: 'rap OR "hip hop" OR drill OR grime',
    rnb: 'r&b OR soul',
    pop: 'pop OR electropop',
    rock: 'rock OR "alternative rock" OR emo OR shoegaze',
    latin: 'reggaeton OR "regional mexican" OR latin',
    edm: 'electronic OR edm OR house OR techno OR trance OR dnb OR dubstep',
    country: 'country',
    kpop: 'k-pop OR kpop',
    afrobeats: 'afrobeats OR afrobeat OR amapiano',
    jazz: 'jazz',
    dancehall: 'dancehall',
    reggae: 'reggae',
    indie: 'indie OR "indie pop" OR "indie rock" OR bedroom',
    metal: 'metal OR metalcore',
    punk: 'punk OR "pop punk" OR hardcore',
    folk: 'folk OR "singer-songwriter"',
    blues: 'blues',
    classical: 'classical OR orchestral',
    soundtrack: 'soundtrack OR score OR ost',
    ambient: 'ambient OR lofi OR chillout',
    jpop: 'j-pop OR jpop',
    desi: 'bollywood OR punjabi OR desi',
  };

  const out: Record<string, SimpleAlbum[]> = Object.fromEntries(keys.map(k => [k, []])) as any;
  const seenAlbum = new Set<string>();
  for (const key of keys) {
    const q = queryMap[key];
    if (!q) continue;
    try {
      const arRes = await fetch(`${FN}/spotify-search/artist-search?` + new URLSearchParams({ q, market, mode: 'loose' }));
      if (!arRes.ok) continue;
      const arData: any = await arRes.json();
      // Prefer popular artists first
      const artists = ((arData.artists?.items ?? []) as any[])
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, 64);
  const bucket: Array<SimpleAlbum & { __score?: number; __pop?: number } > = [];
  const olderPopular: Array<SimpleAlbum & { __score?: number; __pop?: number; __diff?: number } > = [];
      for (const a of artists) {
        if (!a?.id) continue;
        const alRes = await fetch(`${FN}/spotify-search/artist-albums?` + new URLSearchParams({ artistId: a.id, market }));
        if (!alRes.ok) continue;
        const alData: any = await alRes.json();
        for (const it of (alData.items ?? [])) {
          const rd = it.release_date ?? null;
          if (!rd) continue;
          if ((it.album_type ?? '').toLowerCase() === 'compilation') continue;
          const s = String(rd);
          const norm = /^\d{4}$/.test(s) ? `${s}-07-01` : (/^\d{4}-\d{2}$/.test(s) ? `${s}-15` : s);
          const t = Date.parse(norm);
          if (Number.isNaN(t)) continue;
          const diff = (Date.now() - t) / (24*60*60*1000);
          const withinPrimary = diff <= days;
          const withinOlder = diff <= Math.max(days, 90);
          if (!withinOlder) continue;
          if (seenAlbum.has(it.id)) continue;
          seenAlbum.add(it.id);
          const totalTracks = typeof it?.total_tracks === 'number' ? it.total_tracks : (Array.isArray(it?.tracks?.items) ? it.tracks.items.length : 0);
          let type: 'album' | 'single' | 'ep';
          if ((it?.album_type ?? '').toLowerCase() === 'single') type = 'single';
          else if (totalTracks > 2 && totalTracks <= 6) type = 'ep';
          else type = 'album';
          // Popularity-first with recency lift
          const pop = Math.min(100, Math.max(0, a?.popularity ?? 0));
          const k = Math.LN2 / 7; // half-life ~7 days
          const rec = Math.exp(-k * diff) * 100;
          const score = 0.7 * pop + 0.3 * rec;
          const recObj = {
            id: it.id,
            title: it.name,
            artist: (it.artists?.[0]?.name ?? ''),
            releaseDate: rd,
            spotifyUrl: it.external_urls?.spotify ?? null,
            imageUrl: it.images?.[0]?.url ?? null,
            type,
            __score: score,
            __pop: pop,
            __diff: diff,
          } as any;
          if (withinPrimary) bucket.push(recObj); else if (pop >= 70) olderPopular.push(recObj);
          if (bucket.length >= 30) break;
        }
        if (bucket.length >= 30) break;
      }
  // No per-artist consolidation; keep multiple singles/EPs if recent and popular
  const consolidated: any[] = [...bucket];
      // If sparse, top up with older but popular releases (<=90d, pop>=70)
  const MIN_LEN = 60;
  const LANE_TARGET = 100;
      if (consolidated.length < MIN_LEN && olderPopular.length) {
        olderPopular.sort((a: any, b: any) => (b.__score ?? 0) - (a.__score ?? 0));
        const seen = new Set(consolidated.map((x: any) => x.id));
        for (const c of olderPopular) {
          if (seen.has(c.id)) continue;
          consolidated.push(c);
          seen.add(c.id);
          if (consolidated.length >= MIN_LEN) break;
        }
      }
      // Final sort by score, then release date desc
  consolidated.sort((a: any, b: any) => {
        const s = (b.__score ?? 0) - (a.__score ?? 0);
        if (s) return s;
        const da = Date.parse(a.releaseDate || '');
        const db = Date.parse(b.releaseDate || '');
        return db - da;
      });
      // Strip meta and cap
      out[key] = consolidated.map(({ __score, __pop, __diff, ...rest }: any) => rest).slice(0, LANE_TARGET);
    } catch {}
  }
  try { await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), buckets: out })); } catch {}
  return out;
}

// Build a flat Apple fallback list when Spotify is stale/empty
async function getAppleNewReleases(days: number, market: string): Promise<SimpleAlbum[]> {
  const keys = ['pop','rap','rock','edm','afrobeats','kpop','latin','rnb','country','indie'];
  try {
    const buckets = await buildBucketsFromApple(keys, days, market);
    const all = keys.flatMap((k) => buckets[k] || []);
    // Deduplicate by title+artist then id
    const seen = new Set<string>();
    const uniq = [] as SimpleAlbum[];
    for (const a of all) {
      const key = `${(a.title || '').toLowerCase()}::${(a.artist || '').toLowerCase()}`;
      const idKey = a.id;
      if (seen.has(key) || seen.has(idKey)) continue;
      seen.add(key); seen.add(idKey);
      uniq.push(a);
    }
    // Sort newest first
    uniq.sort((a, b) => {
      const norm = (s?: string | null) => {
        if (!s) return '1970-01-01';
        let x = String(s);
        if (/^\d{4}$/.test(x)) x = `${x}-07-01`;
        else if (/^\d{4}-\d{2}$/.test(x)) x = `${x}-15`;
        return x;
      };
      return Date.parse(norm(b.releaseDate)) - Date.parse(norm(a.releaseDate));
    });
    return uniq.slice(0, 40);
  } catch {
    return [];
  }
}

async function buildBucketsFromApple(keys: string[], days: number, market: string): Promise<Record<string, SimpleAlbum[]>> {
  const country = market.toUpperCase();
  const cacheKey = `nrgap:${country}:${days}:${keys.join(',')}`;
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && typeof cached.ts === 'number' && (Date.now() - cached.ts) < 60_000) {
        return cached.buckets as Record<string, SimpleAlbum[]>;
      }
    }
  } catch {}

  const queryMap: Record<string, string> = {
    rap: 'hip hop',
    rnb: 'r&b',
    pop: 'pop',
    rock: 'rock',
    latin: 'latin',
    edm: 'electronic',
    country: 'country',
    kpop: 'k-pop',
    afrobeats: 'afrobeats',
    jazz: 'jazz',
    dancehall: 'dancehall',
    reggae: 'reggae',
    indie: 'indie',
    metal: 'metal',
    punk: 'punk',
    folk: 'folk',
    blues: 'blues',
    classical: 'classical',
    soundtrack: 'soundtrack',
    ambient: 'ambient',
    jpop: 'j-pop',
    desi: 'bollywood',
  };

  function normalizeArt(url?: string | null): string | null {
    if (!url) return null;
    return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/200x200bb.$1');
  }
  function withinDays(date?: string | null): boolean {
    if (!date) return false;
    const s = String(date);
    const norm = /^\d{4}$/.test(s) ? `${s}-07-01` : (/^\d{4}-\d{2}$/.test(s) ? `${s}-15` : s);
    const t = Date.parse(norm);
    if (Number.isNaN(t)) return false;
    const diff = (Date.now() - t) / (24*60*60*1000);
    return diff <= days;
  }

  const out: Record<string, SimpleAlbum[]> = Object.fromEntries(keys.map(k => [k, []])) as any;
  for (const key of keys) {
    const term = queryMap[key] ?? key;
    try {
      const url = `https://itunes.apple.com/search?` + new URLSearchParams({
        term,
        entity: 'album',
        media: 'music',
        limit: '50',
        country,
      });
      const res = await fetch(url);
      if (!res.ok) continue;
      const j: any = await res.json();
      const items = (j.results ?? []).filter((r: any) => r.wrapperType === 'collection');
      const mapped: SimpleAlbum[] = items
        .map((r: any) => ({
          id: String(r.collectionId),
          title: r.collectionName,
          artist: r.artistName,
          releaseDate: r.releaseDate ?? null,
          spotifyUrl: null,
          imageUrl: normalizeArt(r.artworkUrl100),
          type: /(^|\s)EP(\s|$)/i.test(r.collectionName) ? 'ep' : 'album',
        }))
        .filter((a: SimpleAlbum) => withinDays(a.releaseDate))
        .filter((a: SimpleAlbum) => (a.artist || '').toLowerCase() !== 'various artists');
      out[key] = mapped.slice(0, 20);
    } catch {}
  }
  try { await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), buckets: out })); } catch {}
  return out;
}

export async function getRelatedArtists(artistId: string): Promise<{ id: string; name: string; url?: string }[]> {
  const r = await fetch(`${FN}/spotify-search/related?artistId=${encodeURIComponent(artistId)}`);
  if (!r.ok) return [];
  const data: any = await r.json();
  return (data.artists ?? []).map((ar: any) => ({
    id: ar.id,
    name: ar.name,
    url: ar.external_urls?.spotify ?? undefined,
  }));
}
