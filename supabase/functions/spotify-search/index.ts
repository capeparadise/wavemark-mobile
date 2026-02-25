// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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
      // Include appears_on to surface features
      const r = await fetchWithTimeout(
        `https://api.spotify.com/v1/artists/${artistId}/albums?` +
          new URLSearchParams({ include_groups: "album,single,appears_on", market, limit: "50" }),
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
      const candidates14 = candidatesAll.filter((a: any) => daysAgoFrom(a?.release_date) <= baseDays);
      const candidates21 = candidatesAll.filter((a: any) => daysAgoFrom(a?.release_date) <= 21);
      const MIN_AFTER_DAYS = 12;
      let candidatesWindow = candidates14;
      let daysWindowUsed: any = baseDays;
      if (candidates14.length < MIN_AFTER_DAYS) {
        candidatesWindow = candidatesAll;
        daysWindowUsed = "browse_fallback";
      }
      if (debugWide) {
        debugWide.days_window_used = daysWindowUsed;
        debugWide.after_days_filter_count = candidates14.length;
      }

      if (!candidates14.length && !candidates21.length) {
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
            return { ...a, __score: score, __pop: pop };
          });
          scored.sort((a: any, b: any) => {
            if ((b.__score ?? 0) !== (a.__score ?? 0)) return (b.__score ?? 0) - (a.__score ?? 0);
            const na = normalizeDate(a?.release_date) ?? '1970-01-01';
            const nb = normalizeDate(b?.release_date) ?? '1970-01-01';
            const dt = Date.parse(nb) - Date.parse(na);
            if (dt) return dt;
            return (b.__pop ?? 0) - (a.__pop ?? 0);
          });
          return scored;
        };

        const scored14 = scoreList(candidatesWindow);
        const top14 = scored14.filter((a: any) => (a.__pop ?? 0) >= 50);
        let finalPool = top14;
        let daysUsed = baseDays;
        if (top14.length < 8) {
          const scored21 = scoreList(candidates21);
          finalPool = scored21.filter((a: any) => (a.__pop ?? 0) >= 50);
          daysUsed = 21;
          if (debugWide) debugWide.threshold_relaxed.top_picks = true;
        }
        if (debugWide && debugWide.days_window_used !== "browse_fallback") debugWide.days_window_used = daysUsed;
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

      const raw = rawParam.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      if (!raw.length) {
        const errPayload: any = { error: "genres required" };
        if (debug) errPayload.build = BUILD_ID;
        return new Response(JSON.stringify(errPayload), {
          status: 400,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }

      const bucketKeys = [
        "rap", "rnb", "pop", "rock", "latin", "edm", "country", "kpop", "afrobeats",
        "jazz", "dancehall", "reggae", "indie", "metal", "punk", "folk", "blues", "classical",
        "soundtrack", "ambient", "jpop", "desi",
      ];
      const want = new Set(raw);
      const requestedBuckets = bucketKeys.filter((k) => want.has(k));
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
      const cutoffMs = nowMs - daysUsed * 24 * 60 * 60 * 1000;
      const cutoffIso = new Date(cutoffMs).toISOString();
      const currentYear = new Date(nowMs).getUTCFullYear();

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

      const debugByBucket: Record<string, any> = Object.fromEntries(
        bucketKeys.map((k) => [k, {
          search_raw_count: 0,
          date_pass_count: 0,
          popularity_pass_count: 0,
          returned_count: 0,
          cutoff_iso: cutoffIso,
          pages_scanned: 0,
          market: marketFixed,
          popularity_floor: popularityFloor,
        }])
      );

      const artistPopularityById = new Map<string, number | null>();
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
      const classifyType = (albumType?: string | null, totalTracks?: number | null): "single" | "ep" | "album" => {
        const at = String(albumType ?? "").toLowerCase();
        const tt = typeof totalTracks === "number" ? totalTracks : 0;
        if (at === "single" || tt <= 2) return "single";
        if (tt > 2 && tt <= 6) return "ep";
        return "album";
      };
      const normalizeSearchItem = (item: any, sourceType: "album" | "track") => {
        const album = sourceType === "album" ? item : (item?.album ?? {});
        const releaseDate = album?.release_date ?? item?.release_date ?? null;
        const releaseDatePrecision = album?.release_date_precision ?? item?.release_date_precision ?? null;
        const releaseDateNormalized = normalizeReleaseDate(releaseDate, releaseDatePrecision);
        const releaseTs = toReleaseTs(releaseDate, releaseDatePrecision);
        const artists = toArtistLite(sourceType === "track" ? item?.artists : album?.artists);
        const spotifyUrl = item?.external_urls?.spotify ?? album?.external_urls?.spotify ?? null;
        const imageUrl = album?.images?.[0]?.url ?? item?.images?.[0]?.url ?? null;
        const totalTracks = typeof album?.total_tracks === "number" ? album.total_tracks : null;
        return {
          sourceType,
          id: item?.id ?? null,
          name: item?.name ?? null,
          type: item?.type ?? sourceType,
          releaseDateRaw: releaseDate,
          releaseDatePrecision: releaseDatePrecision,
          releaseDateNormalized,
          releaseTs,
          artists,
          images: Array.isArray(album?.images) ? album.images : [],
          spotifyUrl,
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
            for (const id of ids) artistPopularityById.set(id, null);
            continue;
          }
          const aj: any = await ar.json();
          const seenIds = new Set<string>();
          for (const art of aj?.artists ?? []) {
            if (!art?.id) continue;
            seenIds.add(art.id);
            artistPopularityById.set(art.id, typeof art?.popularity === "number" ? art.popularity : null);
          }
          for (const id of ids) {
            if (!seenIds.has(id)) artistPopularityById.set(id, null);
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

          const datePassed = candidates.filter((item) => item?.releaseTs != null && item.releaseTs >= cutoffMs);
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
          if (popularityPassCount >= MAX_RETURN) break;
        }

        const finalDatePassed = candidates.filter((item) => item?.releaseTs != null && item.releaseTs >= cutoffMs);
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
        popularityPassCount = finalPopPassed.length;

        finalPopPassed.sort((a: any, b: any) => {
          const popDiff = (b?.artistPopularity ?? 0) - (a?.artistPopularity ?? 0);
          if (popDiff) return popDiff;
          const dateDiff = (b?.releaseTs ?? 0) - (a?.releaseTs ?? 0);
          if (dateDiff) return dateDiff;
          return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
        });

        const finalItems = finalPopPassed.slice(0, MAX_RETURN).map((item: any) => {
          const primaryArtist = item?.artists?.[0] ?? { id: null, name: "" };
          return {
            id: item?.id,
            title: item?.name ?? "",
            artist: primaryArtist?.name ?? "",
            artistId: primaryArtist?.id ?? null,
            artistPopularity: item?.artistPopularity ?? null,
            releaseDate: item?.releaseDateNormalized ?? null,
            spotifyUrl: item?.spotifyUrl ?? null,
            imageUrl: item?.imageUrl ?? null,
            type: classifyType(item?.albumType ?? null, item?.totalTracks ?? null),
          };
        });

        buckets[bucketKey] = finalItems;
        debugByBucket[bucketKey] = {
          search_raw_count: searchRawCount,
          date_pass_count: datePassCount,
          popularity_pass_count: popularityPassCount,
          returned_count: finalItems.length,
          cutoff_iso: cutoffIso,
          pages_scanned: pagesScanned,
          market: marketFixed,
          popularity_floor: popularityFloor,
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

      const body = JSON.stringify(payload);
      const duration = Date.now() - startTime;
      console.log("NRG_SUCCESS_DURATION_MS", duration);
      const headers: Record<string, string> = addBuildHeader({ "Content-Type": "application/json", "X-Route": "NRG", "X-Path": pathname });
      return new Response(body, { headers });
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
