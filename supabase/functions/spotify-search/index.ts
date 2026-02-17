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

      const raw = rawParam
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!raw.length) {
        const errPayload: any = { error: "genres required" };
        if (debug) errPayload.build = BUILD_ID;
        return new Response(JSON.stringify(errPayload), {
          status: 400,
          headers: addBuildHeader({ "Content-Type": "application/json" }),
        });
      }

      const want = new Set(raw);
      const marketFixed = "US";
      const daysParam = url.searchParams.get("days");
      const parsedDays = daysParam == null ? 30 : Number(daysParam);
      const daysUsed = Math.max(1, Math.min(30, Number.isFinite(parsedDays) ? parsedDays : 30));

      const browseUrl = `${API}/browse/new-releases?country=${marketFixed}&limit=50`;
      const browseRes = await fetchWithTimeout(browseUrl, { headers: hdrs }, 8000, "browse/new-releases:US");
      if (!browseRes.ok) {
        const err: any = new Error("spotify browse new releases failed");
        err.stage = "browse/new-releases:US";
        err.status = browseRes.status;
        err.statusText = browseRes.statusText;
        throw err;
      }
      const browseJson: any = await browseRes.json();
      const itemsAll: any[] = browseJson?.albums?.items ?? [];

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
        return Math.max(0, (Date.now() - t) / (24 * 60 * 60 * 1000));
      }
      const browseSampleDates = itemsAll.slice(0, 10).map((a: any) => {
        const normalizedReleaseDate = normalizeDate(a?.release_date);
        const parsedNormalizedReleaseDate = normalizedReleaseDate ? Date.parse(normalizedReleaseDate) : Number.NaN;
        return {
          album: String(a?.name ?? ""),
          release_date: a?.release_date ?? null,
          release_date_precision: a?.release_date_precision ?? null,
          normalized_release_date: normalizedReleaseDate,
          parsed_normalized_release_date: Number.isNaN(parsedNormalizedReleaseDate) ? null : parsedNormalizedReleaseDate,
          days_ago_normalized_release_date: daysAgoFrom(normalizedReleaseDate),
        };
      });

      const recent = itemsAll.filter((a: any) => {
        if (!a) return false;
        const at = String(a?.album_type ?? "").toLowerCase();
        if (at === "compilation") return false;
        return daysAgoFrom(a?.release_date) <= daysUsed;
      });
      const datePassCount = recent.length;

      const artistIds = Array.from(new Set(
        recent.map((a: any) => (a?.artists?.[0]?.id ?? "")).filter((s: string) => !!s)
      ));

      const artistMap = new Map<string, any>();
      for (let i = 0; i < artistIds.length; i += 50) {
        const ids = artistIds.slice(i, i + 50);
        if (!ids.length) continue;
        const ar = await fetchWithTimeout(`${API}/artists?ids=${ids.join(",")}`, { headers: hdrs }, 8000, "artists");
        if (!ar.ok) {
          const err: any = new Error("spotify artists lookup failed");
          err.stage = "artists";
          err.status = ar.status;
          err.statusText = ar.statusText;
          throw err;
        }
        const aj: any = await ar.json();
        for (const art of aj.artists ?? []) artistMap.set(art.id, art);
      }

      const isElectronicish = (g: string[]) =>
        g.some((s) =>
          s.includes("edm") ||
          s.includes("electronic") ||
          s.includes("house") ||
          s.includes("techno") ||
          s.includes("trance") ||
          s.includes("dubstep") ||
          s.includes("drum and bass") ||
          s.includes("dnb") ||
          s.includes("future bass") ||
          s.includes("bass") ||
          s.includes("electronica")
        );

      const isHipHopish = (g: string[]) =>
        g.some((s) =>
          s.includes("hip hop") ||
          s.includes("hip-hop") ||
          s.includes("rap") ||
          s.includes("drill") ||
          s.includes("grime") ||
          s.includes("boom bap") ||
          s.includes("uk drill") ||
          s.includes("uk rap")
        );

      const bucketFor = (genres: string[]): string | null => {
        const g = (genres ?? []).map((s) => s.toLowerCase());
        if (g.some((s) => s.includes("k-pop") || s.includes("kpop") || s.includes("korean pop"))) return "kpop";
        if (g.some((s) => s.includes("j-pop") || s.includes("jpop") || s.includes("japanese pop"))) return "jpop";
        if (g.some((s) => s.includes("edm") || s.includes("electronic") || s.includes("electro house") || s.includes("house") || s.includes("techno") || s.includes("trance") || s.includes("drum and bass") || s.includes("dnb") || s.includes("dubstep") || s.includes("downtempo") || s.includes("synthwave") || s.includes("electronica"))) return "edm";
        if (isHipHopish(g)) return "rap";
        if (g.some((s) => s.includes("trap")) && !isElectronicish(g)) return "rap";
        if (g.some((s) => s.includes("r&b") || s.includes("rnb") || s.includes("soul") || s.includes("neo-soul") || s.includes("contemporary r&b"))) return "rnb";
        if (g.some((s) => s.includes("pop"))) return "pop";
        if (g.some((s) => s.includes("alt z") || s.includes("adult contemporary"))) return "pop";
        if (g.some((s) => s.includes("latin") || s.includes("reggaeton") || s.includes("regional mexican") || s.includes("corrido") || s.includes("corridos") || s.includes("urbano latino") || s.includes("bachata") || s.includes("salsa"))) return "latin";
        if (g.some((s) => s.includes("rock") || s.includes("alt rock") || s.includes("alternative rock") || s.includes("classic rock") || s.includes("metal") || s.includes("punk") || s.includes("emo") || s.includes("hardcore") || s.includes("shoegaze"))) return "rock";
        if (g.some((s) => s.includes("country") || s.includes("alt-country") || s.includes("country pop") || s.includes("americana"))) return "country";
        if (g.some((s) => s.includes("afrobeats") || s.includes("afrobeat") || s.includes("afro-fusion") || s.includes("afrofusion") || s.includes("amapiano"))) return "afrobeats";
        if (g.some((s) => s.includes("jazz") || s.includes("bebop") || s.includes("latin jazz") || s.includes("smooth jazz"))) return "jazz";
        if (g.some((s) => s.includes("dancehall"))) return "dancehall";
        if (g.some((s) => s.includes("reggae") || s.includes("reggae fusion"))) return "reggae";
        if (g.some((s) => s.includes("indie") || s.includes("indie pop") || s.includes("indie rock") || s.includes("bedroom pop") || s.includes("indie folk"))) return "indie";
        if (g.some((s) => s.includes("metal") || s.includes("death metal") || s.includes("black metal") || s.includes("metalcore"))) return "metal";
        if (g.some((s) => s.includes("punk") || s.includes("pop punk") || s.includes("hardcore punk"))) return "punk";
        if (g.some((s) => s.includes("folk") || s.includes("singer-songwriter"))) return "folk";
        if (g.some((s) => s.includes("blues"))) return "blues";
        if (g.some((s) => s.includes("classical") || s.includes("orchestra") || s.includes("orchestral"))) return "classical";
        if (g.some((s) => s.includes("soundtrack") || s.includes("score") || s.includes("ost"))) return "soundtrack";
        if (g.some((s) => s.includes("ambient") || s.includes("chillout") || s.includes("lo-fi") || s.includes("lofi"))) return "ambient";
        if (g.some((s) => s.includes("desi") || s.includes("bollywood") || s.includes("punjabi") || s.includes("hindi pop") || s.includes("indian pop"))) return "desi";
        return null;
      };

      function classifyType(a: any): "single" | "ep" | "album" {
        const at = String(a?.album_type || "").toLowerCase();
        const tt = typeof a?.total_tracks === "number"
          ? a.total_tracks
          : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
        if (at === "compilation") return "album";
        if (tt <= 2) return "single";
        if (tt <= 6) return "ep";
        return "album";
      }

      const bucketKeys = [
        "rap", "rnb", "pop", "rock", "latin", "edm", "country", "kpop", "afrobeats",
        "jazz", "dancehall", "reggae", "indie", "metal", "punk", "folk", "blues", "classical",
        "soundtrack", "ambient", "jpop", "desi",
      ];
      const buckets: Record<string, any[]> = Object.fromEntries(bucketKeys.map((k) => [k, [] as any[]]));
      const bucketMatchCount: Record<string, number> = Object.fromEntries(bucketKeys.map((k) => [k, 0]));
      const sampleAfterPopFilter: Array<{
        albumTitle: string;
        artistName: string;
        artistPopularity: number;
        artistGenres: string[];
      }> = [];

      let popularityPassCount = 0;
      let bucketedCount = 0;
      for (const a of recent) {
        const primaryArtistId = a?.artists?.[0]?.id ?? null;
        if (!primaryArtistId) continue;
        const art = artistMap.get(primaryArtistId);
        const pop = typeof art?.popularity === "number" ? art.popularity : null;
        if (pop != null && pop >= 50) popularityPassCount += 1;
        if (pop == null || pop < 50) continue;
        if (sampleAfterPopFilter.length < 10) {
          sampleAfterPopFilter.push({
            albumTitle: String(a?.name ?? ""),
            artistName: String(a?.artists?.[0]?.name ?? ""),
            artistPopularity: pop,
            artistGenres: Array.isArray(art?.genres) ? art.genres : [],
          });
        }
        const genresArr = Array.isArray(art?.genres) ? art.genres : [];
        const b = bucketFor(genresArr);
        if (!b) continue;
        if (bucketMatchCount[b] != null) bucketMatchCount[b] += 1;
        if (!want.has(b)) continue;
        buckets[b].push({
          id: a.id,
          title: a.name,
          artist: a.artists?.[0]?.name ?? "",
          artistId: primaryArtistId,
          artistPopularity: pop,
          releaseDate: a.release_date ?? null,
          spotifyUrl: a.external_urls?.spotify ?? null,
          imageUrl: a.images?.[0]?.url ?? null,
          type: classifyType(a),
        });
        bucketedCount += 1;
      }

      const cmp = (x: any, y: any) => {
        const popDiff = (y.artistPopularity ?? 0) - (x.artistPopularity ?? 0);
        if (popDiff) return popDiff;
        const dx = Date.parse(x.releaseDate ?? "1970-01-01");
        const dy = Date.parse(y.releaseDate ?? "1970-01-01");
        return dy - dx;
      };

      for (const k of Object.keys(buckets)) {
        buckets[k].sort(cmp);
        buckets[k] = buckets[k].slice(0, 30);
      }

      const payload: any = { market: marketFixed, days: daysUsed, buckets };
      if (debug) {
        payload.build = BUILD_ID;
        payload.debug = {
          browse_count: itemsAll.length,
          filtered_count: recent.length,
          artist_count: artistMap.size,
          days_used: daysUsed,
          date_pass_count: datePassCount,
          popularity_pass_count: popularityPassCount,
          bucketed_count: bucketedCount,
          bucket_match_count: bucketMatchCount,
          sample_after_pop_filter: sampleAfterPopFilter,
          browse_sample_dates: browseSampleDates,
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
