// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

// Tiny in-memory cache (best-effort, per-warm instance)
type CacheEntry = { ts: number; body: string };
const CACHE_TTL_MS = 60 * 1000; // 60s
const cache = new Map<string, CacheEntry>();
const now = () => Date.now();

async function getAppToken(clientId: string, clientSecret: string) {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error("spotify token failed");
  const json = await res.json();
  return json.access_token as string;
}

serve(async (req) => {
  const url = new URL(req.url);
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

    const cid = Deno.env.get("SPOTIFY_CLIENT_ID")!;
    const sec = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
    const token = await getAppToken(cid, sec);

    const hdrs = { Authorization: `Bearer ${token}` };

    // Generic search (albums, tracks, artists)
    if (pathname.endsWith("/spotify-search")) {
      if (!q) return new Response("q required", { status: 400 });
      const typeParam = type || "album,track,artist";
      const r = await fetch(
        `${API}/search?` + new URLSearchParams({ q, type: typeParam, market, limit: "25" }),
        { headers: hdrs },
      );
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // Lookup by id (album/track)
    if (pathname.endsWith("/lookup")) {
      if (!id || !lookupType) return new Response("id and lookupType required", { status: 400 });
      const kind = lookupType.toLowerCase();
      if (kind !== "album" && kind !== "track") return new Response("lookupType must be album or track", { status: 400 });
      const url2 = kind === "album"
        ? `${API}/albums/${id}?` + new URLSearchParams({ market })
        : `${API}/tracks/${id}?` + new URLSearchParams({ market });
      const r = await fetch(url2, { headers: hdrs });
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // Artist details
    if (pathname.endsWith("/artist")) {
      if (!artistId) return new Response("artistId required", { status: 400 });
      const r = await fetch(`${API}/artists/${artistId}`, { headers: hdrs });
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // NEW: artist precise/loose search
    if (pathname.endsWith("/artist-search")) {
      if (!q) return new Response("q required", { status: 400 });
      const mode = (url.searchParams.get("mode") ?? "loose").toLowerCase(); // "loose" | "precise"
      const qs = mode === "precise" ? `artist:"${q}"` : q; // loose allows partial text
      const r = await fetch(
        `https://api.spotify.com/v1/search?` +
          new URLSearchParams({ q: qs, type: "artist", market, limit: "15" }),
        { headers: hdrs }
      );
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // NEW: artist albums (recent first)
    if (pathname.endsWith("/artist-albums")) {
      if (!artistId) return new Response("artistId required", { status: 400 });
      // Include appears_on to surface features
      const r = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}/albums?` +
          new URLSearchParams({ include_groups: "album,single,appears_on", market, limit: "50" }),
        { headers: hdrs }
      );
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // NEW: artist top tracks
    if (pathname.endsWith("/artist-top-tracks")) {
      if (!artistId) return new Response("artistId required", { status: 400 });
      const r = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=${market}`,
        { headers: hdrs }
      );
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // Related artists
    if (pathname.endsWith("/related")) {
      if (!artistId) return new Response("artistId required", { status: 400 });
      const r = await fetch(`${API}/artists/${artistId}/related-artists`, { headers: hdrs });
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // New releases (Browse) — market aware
    if (pathname.endsWith("/new-releases")) {
  const r = await fetch(`${API}/browse/new-releases?country=${market}&limit=50`, { headers: hdrs });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json", "X-Route": "BROWSE", "X-Path": pathname } });
    }

    // New releases (Wide) — search with paging, dedupe, filter by days
    if (pathname.endsWith("/new-releases-wide")) {
      const daysParam = Math.max(1, Number(url.searchParams.get("days") ?? "28"));
      const targetParam = Math.max(10, Math.min(500, Number(url.searchParams.get("target") ?? "200")));
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear - 1]; // handle year boundary

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

      const seen = new Set<string>();
      const out: any[] = [];
      const limit = 50;
      const maxPagesPerQuery = 8; // up to ~400 per year (practically filtered below)

      async function searchYear(y: number) {
        const q = `year:${y}`;
        for (let page = 0; page < maxPagesPerQuery; page++) {
          const offset = page * limit;
          const url2 = `${API}/search?` + new URLSearchParams({ q, type: 'album', market, limit: String(limit), offset: String(offset) });
          const r2 = await fetch(url2, { headers: hdrs });
          if (!r2.ok) break;
          const j2: any = await r2.json();
          const items: any[] = j2.albums?.items ?? [];
          if (!items.length) break;
          for (const a of items) {
            if (!a?.id) continue;
            if (seen.has(a.id)) continue;
            // filter unwanted
            if ((a.album_type ?? '').toLowerCase() === 'compilation') continue;
            const d = daysAgoFrom(a.release_date);
            if (d > daysParam) continue;
            seen.add(a.id);
            out.push(a);
          }
          // early exit when enough
          if (out.length >= targetParam) break;
        }
      }

      for (const y of years) {
        if (out.length >= targetParam) break;
        try { await searchYear(y); } catch (_) {}
      }

      // Enrich with primary artist popularity/followers and rank by popularity-first with a recency lift
      try {
        // Collect primary artist IDs
        const artistIds = Array.from(new Set(
          out.map((a: any) => (a?.artists?.[0]?.id ?? '')).filter((s: string) => !!s)
        ));
        const artistMap = new Map<string, any>();
        for (let i = 0; i < artistIds.length; i += 50) {
          const ids = artistIds.slice(i, i + 50);
          if (!ids.length) continue;
          const ar = await fetch(`${API}/artists?ids=${ids.join(',')}`, { headers: hdrs });
          if (!ar.ok) continue;
          const aj: any = await ar.json();
          for (const art of aj.artists ?? []) artistMap.set(art.id, art);
        }

        // Scoring helpers (aligned with genre route)
        function popNorm(pop?: number): number { return Math.min(1, Math.max(0, (typeof pop === 'number' ? pop : 0) / 100)); }
        function followersNorm(followers?: number): number { return Math.min(1, Math.log10(Math.max(1, typeof followers === 'number' ? followers : 0)) / 6); }
        function recencyExp2(releaseDate?: string | null, halfLifeDays = 7): number {
          const n = normalizeDate(releaseDate);
          if (!n) return 0;
          const t = Date.parse(n);
          if (Number.isNaN(t)) return 0;
          const days = Math.max(0, (Date.now() - t) / (24*60*60*1000));
          const k = Math.LN2 / halfLifeDays;
          return Math.exp(-k * days);
        }
        function marketBoost2(genres: string[], market: string): number {
          const g = (genres ?? []).map((s) => s.toLowerCase());
          if (market === 'GB') {
            if (g.some((s) => s.includes('grime') || s.includes('uk ') || s.includes('british') || s.includes('uk drill') || s.includes('uk rap') || s.includes('britpop') || s.includes('london'))) return 15;
          }
          if (market === 'US') {
            if (g.some((s) => s.includes('country') || s.includes('alt-country') || s.includes('trap'))) return 8;
          }
          return 0;
        }
        const W_POP = 0.60, W_REC = 0.30, W_FOL = 0.10;

        // Compute a composite for each album and sort
        out.sort((a: any, b: any) => {
          const aid = a?.artists?.[0]?.id ?? '';
          const bid = b?.artists?.[0]?.id ?? '';
          const aa = aid ? artistMap.get(aid) : null;
          const bb = bid ? artistMap.get(bid) : null;
          const ap = typeof aa?.popularity === 'number' ? aa.popularity : 0;
          const bp = typeof bb?.popularity === 'number' ? bb.popularity : 0;
          const af = typeof aa?.followers?.total === 'number' ? aa.followers.total : 0;
          const bf = typeof bb?.followers?.total === 'number' ? bb.followers.total : 0;
          const ar = recencyExp2(a?.release_date, 7);
          const br = recencyExp2(b?.release_date, 7);
          const am = marketBoost2(aa?.genres ?? [], market);
          const bm = marketBoost2(bb?.genres ?? [], market);
          const ascore = (W_POP * popNorm(ap) + W_REC * ar + W_FOL * followersNorm(af)) * 100 + (am * 0.1);
          const bscore = (W_POP * popNorm(bp) + W_REC * br + W_FOL * followersNorm(bf)) * 100 + (bm * 0.1);
          if (bscore !== ascore) return bscore - ascore;
          const na = normalizeDate(a?.release_date) ?? '1970-01-01';
          const nb = normalizeDate(b?.release_date) ?? '1970-01-01';
          const dt = Date.parse(nb) - Date.parse(na);
          if (dt) return dt;
          return bp - ap;
        });
      } catch (_) {
        // Fallback: if enrichment fails, keep newest-first order
        out.sort((a: any, b: any) => {
          const na = normalizeDate(a?.release_date) ?? '1970-01-01';
          const nb = normalizeDate(b?.release_date) ?? '1970-01-01';
          return Date.parse(nb) - Date.parse(na);
        });
      }

      const capped = out.slice(0, targetParam);
      const body = JSON.stringify({ albums: { items: capped } });
      return new Response(body, { headers: { "Content-Type": "application/json", "X-Route": "WIDE", "X-Path": pathname, "X-Count": String(capped.length) } });
    }

    // New: New releases by genre buckets (robust matching even if subpaths are not forwarded)
    try { console.log("PATH", pathname); } catch (_) {}
  if (
    rawUrl.includes("/new-releases-genre") ||
    pathname.includes("/new-releases-genre") ||
    url.searchParams.has("genres") ||
    url.searchParams.has("strict") ||
    url.searchParams.has("days")
  ) {
      const initialDays = Math.max(1, Number(url.searchParams.get("days") ?? "28"));
      const strictParam = (url.searchParams.get('strict') ?? '').toLowerCase();
      const strict = strictParam === '1' || strictParam === 'true';
  // Genres: default to a sensible set if empty or missing
      const defaultGenres = "rap,rnb,pop,rock,latin,edm,country,kpop,afrobeats,jazz";
      const rawParam = url.searchParams.get("genres");
      let raw = (rawParam ?? "").toLowerCase();
      raw = raw.split(",").map((s) => s.trim()).filter(Boolean).join(",");
      if (!raw) raw = defaultGenres;
      const want = new Set(raw.split(","));
      const wantHas = (k: string) => (want.size === 0) || want.has(k);

      // If after normalization we still have no genres, return shaped empty buckets
      if (!raw || want.size === 0) {
        const empty: any = { rap: [], rnb: [], pop: [], rock: [], latin: [], edm: [], country: [], kpop: [], afrobeats: [], jazz: [], dancehall: [], reggae: [], indie: [], metal: [], punk: [], folk: [], blues: [], classical: [], soundtrack: [], ambient: [], jpop: [], desi: [] };
        return new Response(JSON.stringify({ market, days: initialDays, buckets: empty }), { headers: { "Content-Type": "application/json" } });
      }

      // Cache fast path
      const cacheKey = `nrg:${market}:${initialDays}:${strict ? 1 : 0}:${raw}:${light ? 1 : 0}`;
      const hit = cache.get(cacheKey);
      if (hit && (now() - hit.ts) < CACHE_TTL_MS) {
        return new Response(hit.body, { headers: { "Content-Type": "application/json", "X-Cache": "HIT" } });
      }

      function marketBoost(genres: string[], market: string): number {
        const g = (genres ?? []).map((s) => s.toLowerCase());
        // GB heuristics
        if (market === 'GB') {
          if (g.some((s) => s.includes('grime') || s.includes('uk ') || s.includes('british') || s.includes('uk drill') || s.includes('uk rap') || s.includes('britpop') || s.includes('london'))) return 15;
        }
        // US example (placeholder for future):
        if (market === 'US') {
          if (g.some((s) => s.includes('country') || s.includes('alt-country') || s.includes('trap'))) return 8;
        }
        return 0;
      }

      function followersBoost(followers?: number): number {
        const f = typeof followers === 'number' ? followers : 0;
        // Log scale to avoid overpowering score; multiplied for impact
        return Math.log10(Math.max(1, f)) * 3; // ~3 per 10x
      }

      function popNorm(pop?: number): number { return Math.min(1, Math.max(0, (typeof pop === 'number' ? pop : 0) / 100)); }
      function followersNorm(followers?: number): number { return Math.min(1, Math.log10(Math.max(1, typeof followers === 'number' ? followers : 0)) / 6); }
      function daysAgo(releaseDate?: string | null): number {
        if (!releaseDate) return 9999;
        let s = String(releaseDate);
        // Normalize precision: YYYY -> YYYY-07-01, YYYY-MM -> YYYY-MM-15
        if (/^\d{4}$/.test(s)) s = `${s}-07-01`;
        else if (/^\d{4}-\d{2}$/.test(s)) s = `${s}-15`;
        const dt = Date.parse(s);
        if (Number.isNaN(dt)) return 9999;
        const d = (Date.now() - dt) / (24*60*60*1000);
        return Math.max(0, d);
      }
  function recencyExp(releaseDate?: string | null, halfLifeDays = 5): number {
        const d = daysAgo(releaseDate);
        const k = Math.LN2 / halfLifeDays; // exp(-k*halfLifeDays) = 0.5
        return Math.exp(-k * d);
      }
  const W_POP = 0.60, W_REC = 0.30, W_FOL = 0.10;
      function compositeScore(pop?: number, followers?: number, releaseDate?: string | null, genres?: string[], market?: string): {score:number, pop:number, days:number} {
        const pn = popNorm(pop);
        const fn = followersNorm(followers);
        const rn = recencyExp(releaseDate, 7);
        const base01 = W_POP*pn + W_REC*rn + W_FOL*fn;
        const base = base01 * 100; // scale to ~0-100
        // Small market influence as additive tweak
        const mb = marketBoost(genres ?? [], market ?? '');
        const out = base + (mb * 0.1); // e.g., +1.5 for +15 boost
        return { score: out, pop: (typeof pop === 'number' ? pop : 0), days: daysAgo(releaseDate) };
      }

      function classifyType(a: any): 'single' | 'ep' | 'album' {
        const at = String(a?.album_type || '').toLowerCase();
        const tt = typeof a?.total_tracks === 'number' ? a.total_tracks : (Array.isArray(a?.tracks?.items) ? a.tracks.items.length : 0);
        if (at === 'compilation') return 'album';
        if (tt <= 2) return 'single';
        if (tt <= 6) return 'ep';
        return 'album';
      }

  async function fetchBuckets(days: number) {
        const emptyBucketsAll: Record<string, any[]> = { rap: [], rnb: [], pop: [], rock: [], latin: [], edm: [], country: [], kpop: [], afrobeats: [], jazz: [], dancehall: [], reggae: [], indie: [], metal: [], punk: [], folk: [], blues: [], classical: [], soundtrack: [], ambient: [], jpop: [], desi: [] };
  const r = await fetch(`${API}/browse/new-releases?country=${market}&limit=100`, { headers: hdrs });
        if (!r.ok) return { buckets: emptyBucketsAll, days } as any;
        const jr: any = await r.json();
        const albums: any[] = jr.albums?.items ?? [];

  const recent = albums.filter((a) => daysAgo(a.release_date) <= days);

  const artistIds = Array.from(new Set(recent.flatMap((a) => (a.artists ?? []).map((x: any) => x?.id)).filter(Boolean)));
        const artistMap = new Map<string, any>();
        for (let i = 0; i < artistIds.length; i += 50) {
          const ids = artistIds.slice(i, i + 50);
          if (!ids.length) continue;
          const ar = await fetch(`${API}/artists?ids=${ids.join(",")}`, { headers: hdrs });
          if (!ar.ok) continue;
          const aj: any = await ar.json();
          for (const art of aj.artists ?? []) artistMap.set(art.id, art);
        }

  const buckets: Record<string, any[]> = { rap: [], rnb: [], pop: [], rock: [], latin: [], edm: [], country: [], kpop: [], afrobeats: [], jazz: [], dancehall: [], reggae: [], indie: [], metal: [], punk: [], folk: [], blues: [], classical: [], soundtrack: [], ambient: [], jpop: [], desi: [] };
        const bucketFor = (genres: string[]): string | null => {
          const g = (genres ?? []).map((s) => s.toLowerCase());
          if (g.some((s) => s.includes("hip hop") || s.includes("hip-hop") || s.includes("rap") || s.includes("trap") || s.includes("drill") || s.includes("grime") || s.includes("pop rap"))) return "rap";
          if (g.some((s) => s.includes("r&b") || s.includes("rnb") || s.includes("soul") || s.includes("neo-soul") || s.includes("contemporary r&b"))) return "rnb";
          if (g.some((s) => s.includes("pop") || s.includes("dance pop") || s.includes("electropop") || s.includes("hyperpop"))) return "pop";
          if (g.some((s) => s.includes("latin") || s.includes("reggaeton") || s.includes("regional mexican") || s.includes("corrido") || s.includes("corridos") || s.includes("urbano latino") || s.includes("bachata") || s.includes("salsa"))) return "latin";
          if (g.some((s) => s.includes("edm") || s.includes("electronic") || s.includes("house") || s.includes("techno") || s.includes("trance") || s.includes("drum and bass") || s.includes("dnb") || s.includes("dubstep") || s.includes("downtempo") || s.includes("synthwave") || s.includes("electronica"))) return "edm";
          if (g.some((s) => s.includes("rock") || s.includes("alt rock") || s.includes("alternative rock") || s.includes("classic rock") || s.includes("metal") || s.includes("punk") || s.includes("emo") || s.includes("hardcore") || s.includes("shoegaze"))) return "rock";
          if (g.some((s) => s.includes("country") || s.includes("alt-country") || s.includes("country pop") || s.includes("americana"))) return "country";
          if (g.some((s) => s.includes("k-pop") || s.includes("kpop") || s.includes("korean pop"))) return "kpop";
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
          if (g.some((s) => s.includes("j-pop") || s.includes("jpop") || s.includes("japanese pop"))) return "jpop";
          if (g.some((s) => s.includes("desi") || s.includes("bollywood") || s.includes("punjabi") || s.includes("hindi pop") || s.includes("indian pop"))) return "desi";
          return null;
        };

        for (const a of recent) {
          if ((a.album_type ?? '').toLowerCase() === 'compilation') continue;
          const artists = (a.artists ?? []) as any[];
          // Prefer primary artist, else first with genres
          let art = artists[0]?.id ? artistMap.get(artists[0].id) : null;
          if (!art) {
            for (const ar of artists) {
              const m = ar?.id ? artistMap.get(ar.id) : null;
              if (m && Array.isArray(m.genres) && m.genres.length) { art = m; break; }
            }
          }
          const genresArr = (art?.genres ?? []) as string[];
          const b = art ? bucketFor(genresArr) : null;
          if (b && wantHas(b)) {
            const comp = compositeScore(art?.popularity, art?.followers?.total, a.release_date, genresArr, market);
            buckets[b].push({
              id: a.id,
              title: a.name,
              artist: (a.artists?.[0]?.name ?? ""),
              releaseDate: a.release_date ?? null,
              spotifyUrl: a.external_urls?.spotify ?? null,
              imageUrl: a.images?.[0]?.url ?? null,
              type: classifyType(a),
              __score: comp.score,
              __pop: comp.pop,
              __days: comp.days,
            });
          }
        }
  // Sort buckets with pairwise override: if one is >=7 days newer and not >15 popularity points lower, prefer newer
  const cmp = (x: any, y: any) => {
          const dxDays = (x.__days ?? 9999);
          const dyDays = (y.__days ?? 9999);
          const dp = (x.__pop ?? 0) - (y.__pop ?? 0);
          const REC_DIFF = 6, POP_DOM = 8;
          const dayDiff = dxDays - dyDays; // positive => x older
          if (Math.abs(dayDiff) >= REC_DIFF) {
            if (dayDiff > 0 && ((y.__pop ?? 0) - (x.__pop ?? 0)) <= POP_DOM) return 1; // y is newer, not much less popular
            if (dayDiff < 0 && ((x.__pop ?? 0) - (y.__pop ?? 0)) <= POP_DOM) return -1; // x is newer, not much less popular
          }
          const s = (y.__score ?? 0) - (x.__score ?? 0);
          if (s) return s;
          const t = (Date.parse(y.releaseDate ?? '1970-01-01') - Date.parse(x.releaseDate ?? '1970-01-01'));
          if (t) return t;
          return (y.__pop ?? 0) - (x.__pop ?? 0);
        };
        function dedupeById(arr: any[]): any[] {
          if (!Array.isArray(arr) || arr.length === 0) return arr ?? [];
          const seen = new Set<string>();
          const out: any[] = [];
          for (const it of arr) {
            const id = String(it.id || '');
            if (id && seen.has(id)) continue;
            if (id) seen.add(id);
            out.push(it);
          }
          return out;
        }
  for (const k of Object.keys(buckets)) {
          buckets[k].sort(cmp);
          // Consolidate per artist to avoid multiple singles clutter
          const trimmed = buckets[k].slice(0, 200).map(({ __score, __pop, __days, ...rest }) => rest);
          buckets[k] = dedupeById(trimmed).slice(0, 100);
        }
        return { buckets, days };
      }

      // Try multiple windows to avoid empty UI
  const windows = strict ? [initialDays] : [initialDays, Math.max(initialDays, 45), Math.max(initialDays, 90), Math.max(initialDays, 180)];
  let result = await fetchBuckets(windows[0]);
      const isEmpty = (b: Record<string, any[]>) => {
        for (const k of Object.keys(b)) { if (Array.isArray((b as any)[k]) && ((b as any)[k] as any[]).length > 0) return false; }
        return true;
      };
  if (!strict && isEmpty(result.buckets) && windows[1] !== windows[0]) result = await fetchBuckets(windows[1]);
  if (!strict && isEmpty(result.buckets) && windows[2] !== windows[1]) result = await fetchBuckets(windows[2]);

  // Fallback: if still empty or sparse on requested keys, use search by current year and bucket by artist genres; merge per-genre
  if (!light) {
      const cutoff2 = new Date(); cutoff2.setDate(cutoff2.getDate() - initialDays);
      const cutoffISO2 = cutoff2.toISOString().slice(0, 10);
  const MIN_WANT = 8;
  const wantKeys = Array.from(want);
      const anyEmptyOrSparse = wantKeys.some((k) => {
        const arr = (result.buckets as any)[k] as any[] | undefined;
        return !Array.isArray(arr) || arr.length < MIN_WANT;
      });
      const coreAll = [...result.buckets.rap, ...result.buckets.rnb, ...result.buckets.pop, ...result.buckets.rock];
      const coreMostlyStale = coreAll.length > 0 && coreAll.every((a) => (a.releaseDate ?? '') < cutoffISO2);

  if (isEmpty(result.buckets) || coreMostlyStale || anyEmptyOrSparse) {
        async function searchAlbumsByYear(year: number): Promise<any[]> {
          const queries = [
            `year:${year}`,
            // Attempt tag:new (undocumented, best-effort)
            `tag:new year:${year}`,
          ];
          const seen = new Set<string>();
          const out: any[] = [];
          for (const q of queries) {
            const r = await fetch(`${API}/search?` + new URLSearchParams({ q, type: 'album', market, limit: '50' }), { headers: hdrs });
            if (!r.ok) continue;
            const j: any = await r.json();
            for (const a of j.albums?.items ?? []) {
              if (!a?.id || seen.has(a.id)) continue;
              seen.add(a.id);
              out.push(a);
            }
          }
          return out;
        }

        try {
          const currentYear = new Date().getFullYear();
          const albums = (await searchAlbumsByYear(currentYear))
            .concat(await searchAlbumsByYear(currentYear - 1));
          // Filter to initialDays window, then bucket by artist genres
          const recent = albums.filter((a) => daysAgo(a.release_date) <= initialDays);
          const uniqIds = new Set<string>();
          const uniqRecent = recent.filter((a) => (a?.id && !uniqIds.has(a.id)) ? (uniqIds.add(a.id), true) : false);

          const artistIds2 = Array.from(new Set(uniqRecent.flatMap((a: any) => (a.artists ?? []).map((x: any) => x?.id)).filter(Boolean)));
          const artistMap2 = new Map<string, any>();
          for (let i = 0; i < artistIds2.length; i += 50) {
            const ids = artistIds2.slice(i, i + 50);
            if (!ids.length) continue;
            const ar = await fetch(`${API}/artists?ids=${ids.join(',')}`, { headers: hdrs });
            if (!ar.ok) continue;
            const aj: any = await ar.json();
            for (const art of aj.artists ?? []) artistMap2.set(art.id, art);
          }

          const buckets2: Record<string, any[]> = { rap: [], rnb: [], pop: [], rock: [], latin: [], edm: [], country: [], kpop: [], afrobeats: [], jazz: [], dancehall: [], reggae: [], indie: [], metal: [], punk: [], folk: [], blues: [], classical: [], soundtrack: [], ambient: [], jpop: [], desi: [] };
          const bucketFor2 = (genres: string[]): string | null => {
            const g = (genres ?? []).map((s) => s.toLowerCase());
            if (g.some((s) => s.includes('hip hop') || s.includes('hip-hop') || s.includes('rap') || s.includes('trap') || s.includes('drill') || s.includes('grime') || s.includes('pop rap'))) return 'rap';
            if (g.some((s) => s.includes('r&b') || s.includes('rnb') || s.includes('soul') || s.includes('neo-soul') || s.includes('contemporary r&b'))) return 'rnb';
            if (g.some((s) => s.includes('pop') || s.includes('dance pop') || s.includes('electropop') || s.includes('hyperpop'))) return 'pop';
            if (g.some((s) => s.includes('latin') || s.includes('reggaeton') || s.includes('regional mexican') || s.includes('corrido') || s.includes('corridos') || s.includes('urbano latino') || s.includes('bachata') || s.includes('salsa'))) return 'latin';
            if (g.some((s) => s.includes('edm') || s.includes('electronic') || s.includes('house') || s.includes('techno') || s.includes('trance') || s.includes('drum and bass') || s.includes('dnb') || s.includes('dubstep') || s.includes('downtempo') || s.includes('synthwave') || s.includes('electronica'))) return 'edm';
            if (g.some((s) => s.includes('rock') || s.includes('alt rock') || s.includes('alternative rock') || s.includes('classic rock') || s.includes('metal') || s.includes('punk') || s.includes('emo') || s.includes('hardcore') || s.includes('shoegaze'))) return 'rock';
            if (g.some((s) => s.includes('country') || s.includes('alt-country') || s.includes('country pop') || s.includes('americana'))) return 'country';
            if (g.some((s) => s.includes('k-pop') || s.includes('kpop') || s.includes('korean pop'))) return 'kpop';
            if (g.some((s) => s.includes('afrobeats') || s.includes('afrobeat') || s.includes('afro-fusion') || s.includes('afrofusion') || s.includes('amapiano'))) return 'afrobeats';
            if (g.some((s) => s.includes('jazz') || s.includes('bebop') || s.includes('latin jazz') || s.includes('smooth jazz'))) return 'jazz';
            if (g.some((s) => s.includes('dancehall'))) return 'dancehall';
            if (g.some((s) => s.includes('reggae') || s.includes('reggae fusion'))) return 'reggae';
            if (g.some((s) => s.includes('indie') || s.includes('indie pop') || s.includes('indie rock') || s.includes('bedroom pop') || s.includes('indie folk'))) return 'indie';
            if (g.some((s) => s.includes('metal') || s.includes('death metal') || s.includes('black metal') || s.includes('metalcore'))) return 'metal';
            if (g.some((s) => s.includes('punk') || s.includes('pop punk') || s.includes('hardcore punk'))) return 'punk';
            if (g.some((s) => s.includes('folk') || s.includes('singer-songwriter'))) return 'folk';
            if (g.some((s) => s.includes('blues'))) return 'blues';
            if (g.some((s) => s.includes('classical') || s.includes('orchestra') || s.includes('orchestral'))) return 'classical';
            if (g.some((s) => s.includes('soundtrack') || s.includes('score') || s.includes('ost'))) return 'soundtrack';
            if (g.some((s) => s.includes('ambient') || s.includes('chillout') || s.includes('lo-fi') || s.includes('lofi'))) return 'ambient';
            if (g.some((s) => s.includes('j-pop') || s.includes('jpop') || s.includes('japanese pop'))) return 'jpop';
            if (g.some((s) => s.includes('desi') || s.includes('bollywood') || s.includes('punjabi') || s.includes('hindi pop') || s.includes('indian pop'))) return 'desi';
            return null;
          };

          for (const a of uniqRecent) {
            if ((a.album_type ?? '').toLowerCase() === 'compilation') continue;
            const artists = (a.artists ?? []) as any[];
            let art = artists[0]?.id ? artistMap2.get(artists[0].id) : null;
            if (!art) {
              for (const ar of artists) {
                const m = ar?.id ? artistMap2.get(ar.id) : null;
                if (m && Array.isArray(m.genres) && m.genres.length) { art = m; break; }
              }
            }
            const genresArr = (art?.genres ?? []) as string[];
            const b = art ? bucketFor2(genresArr) : null;
            if (b && wantHas(b)) {
              const comp = compositeScore(art?.popularity, art?.followers?.total, a.release_date, genresArr, market);
              buckets2[b].push({
                id: a.id,
                title: a.name,
                artist: (a.artists?.[0]?.name ?? ''),
                releaseDate: a.release_date ?? null,
                spotifyUrl: a.external_urls?.spotify ?? null,
                imageUrl: a.images?.[0]?.url ?? null,
                type: classifyType(a),
                __score: comp.score,
                __pop: comp.pop,
                __days: comp.days,
              });
            }
          }
          const cmp2 = (x: any, y: any) => {
            const dxDays = (x.__days ?? 9999);
            const dyDays = (y.__days ?? 9999);
            const REC_DIFF = 6, POP_DOM = 8;
            const dayDiff = dxDays - dyDays;
            if (Math.abs(dayDiff) >= REC_DIFF) {
              if (dayDiff > 0 && ((y.__pop ?? 0) - (x.__pop ?? 0)) <= POP_DOM) return 1;
              if (dayDiff < 0 && ((x.__pop ?? 0) - (y.__pop ?? 0)) <= POP_DOM) return -1;
            }
            const s = (y.__score ?? 0) - (x.__score ?? 0);
            if (s) return s;
            const t = (Date.parse(y.releaseDate ?? '1970-01-01') - Date.parse(x.releaseDate ?? '1970-01-01'));
            if (t) return t;
            return (y.__pop ?? 0) - (x.__pop ?? 0);
          };
          for (const k of Object.keys(buckets2)) {
            buckets2[k].sort(cmp2);
            const trimmed = buckets2[k].slice(0, 200).map(({ __score, __pop, __days, ...rest }) => rest);
            buckets2[k] = dedupeById(trimmed).slice(0, 100);
          }
          if (isEmpty(result.buckets) || coreMostlyStale) {
            // If fallback produced anything for any wanted key, adopt it; else keep current
            const anyWanted = wantKeys.some((k) => Array.isArray((buckets2 as any)[k]) && ((buckets2 as any)[k] as any[]).length > 0);
            if (anyWanted) result = { buckets: buckets2, days: initialDays } as any;
          } else {
            // Merge only for requested keys that are empty or sparse
            for (const k of wantKeys) {
              const existing = (result.buckets as any)[k] as any[] | undefined;
              const fill = (buckets2 as any)[k] as any[] | undefined;
              if (!Array.isArray(fill) || fill.length === 0) continue;
              if (!Array.isArray(existing) || existing.length < MIN_WANT) {
                const base = Array.isArray(existing) ? existing : [];
                const seen = new Set(base.map((x: any) => x.id));
                const extras = fill.filter((x: any) => !seen.has(x.id));
                (result.buckets as any)[k] = [...base, ...extras].slice(0, 50);
              }
            }
          }
        } catch (e) {
          // ignore fallback errors
        }
  }

  // Final fallback helper: fill sparse buckets using top artists by genre and their latest releases
  async function fillBucketFromTopArtists(key: string, wantCount = 60, maxDays = initialDays) {
        if (want.size > 0 && !want.has(key)) return;
        const map: Record<string, string> = {
          rap: 'rap OR "hip hop"',
          rnb: 'r&b OR soul',
          pop: 'pop',
          rock: 'rock OR "alternative rock" OR "indie rock"',
          latin: 'reggaeton OR "regional mexican" OR latin',
          edm: 'electronic OR edm OR house OR techno OR trance OR "drum and bass" OR dnb OR dubstep',
          country: 'country',
          kpop: 'k-pop OR kpop',
          afrobeats: 'afrobeats OR afrobeat OR amapiano',
          jazz: 'jazz',
          dancehall: 'dancehall',
          reggae: 'reggae',
          indie: 'indie OR "indie pop" OR "indie rock" OR "bedroom pop" OR shoegaze OR "dream pop"',
          metal: 'metal',
          punk: 'punk',
          folk: 'folk OR "singer-songwriter"',
          blues: 'blues',
          classical: 'classical OR orchestral',
          soundtrack: 'soundtrack OR score OR ost',
          ambient: 'ambient OR chillout OR lofi',
          jpop: 'j-pop OR jpop',
          desi: 'bollywood OR punjabi OR desi',
        };
        const q = map[key];
        if (!q) return;
  // Search for top artists using broad text queries (genre: filter can be sparse)
  const ar = await fetch(`${API}/search?` + new URLSearchParams({ q, type: 'artist', market, limit: '50' }), { headers: hdrs });
        if (!ar.ok) return;
  const aj: any = await ar.json();
  const arts: any[] = (aj.artists?.items ?? []).sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 120);
        const out: any[] = result.buckets[key] ?? [];
        const seen = new Set(out.map((x: any) => x.id));
        for (const a of arts) {
          if (!a?.id) continue;
          const al = await fetch(`${API}/artists/${a.id}/albums?` + new URLSearchParams({ include_groups: 'album,single', market, limit: '50' }), { headers: hdrs });
          if (!al.ok) continue;
          const alj: any = await al.json();
          for (const it of (alj.items ?? [])) {
            const rd = it.release_date ?? null;
            if (!rd) continue;
            if ((it.album_type ?? '').toLowerCase() === 'compilation') continue;
            if (daysAgo(rd) > maxDays) continue;
            if (seen.has(it.id)) continue;
            seen.add(it.id);
            const rec = recencyExp(rd, 7) * 100; // scale roughly to match composite baseline
            const score = (a.popularity ?? 0) + followersBoost(a?.followers?.total) + rec + marketBoost(a?.genres ?? [], market) * 0.1;
            out.push({
              id: it.id,
              title: it.name,
              artist: (it.artists?.[0]?.name ?? ''),
              releaseDate: rd,
              spotifyUrl: it.external_urls?.spotify ?? null,
              imageUrl: it.images?.[0]?.url ?? null,
              type: classifyType(it),
              __score: score,
            });
            if (out.length >= wantCount) break;
          }
          if (out.length >= wantCount) break;
        }
  // Sort, consolidate, and trim
  out.sort((x: any, y: any) => (y.__score ?? 0) - (x.__score ?? 0));
  const mapped = out.map(({ __score, ...rest }: any) => rest);
  result.buckets[key] = dedupeById(mapped).slice(0, 100);
  }

      // Apply fill for buckets that are empty or too sparse
      {
        if (!light) {
        const keys = Object.keys(result.buckets);
        for (const k of keys) {
          const MIN = 24;
          const arr0 = result.buckets[k] ?? [];
          if ((arr0?.length ?? 0) < MIN) {
            try { await fillBucketFromTopArtists(k, 60, initialDays); } catch (e) {}
            const arr1 = result.buckets[k] ?? [];
            if (!strict && (arr1?.length ?? 0) < MIN) {
              try { await fillBucketFromTopArtists(k, 80, Math.max(initialDays, 60)); } catch (e) {}
              const arr2 = result.buckets[k] ?? [];
              // If still very sparse for niche genres, widen more in non-strict mode
              const niche = ['punk','indie','folk','soundtrack','ambient','jpop','desi'];
              if (!strict && niche.includes(k) && (arr2?.length ?? 0) < 5) {
                try { await fillBucketFromTopArtists(k, 100, Math.max(initialDays, 90)); } catch (e) {}
              }
            }
          }
        }
  }
        // Final consolidation pass across all buckets
        for (const k of Object.keys(result.buckets)) {
          result.buckets[k] = dedupeById(result.buckets[k]).slice(0, 100);
        }
      }

  try { console.log("NRG", { market, days: result.days, keys: Object.keys(result.buckets), counts: Object.fromEntries(Object.entries(result.buckets).map(([k,v])=>[k, Array.isArray(v)?v.length:0])) }); } catch (e) {}
  const body = JSON.stringify({ market, days: result.days, buckets: result.buckets });
  try { cache.set(cacheKey, { ts: now(), body }); } catch (e) {}
  return new Response(body, { headers: { "Content-Type": "application/json", "X-Cache": "MISS", "X-Route": "NRG", "X-Path": pathname } });
    }

    // Direct lookup by ID (handles pasted URLs/IDs for presaves not discoverable via search)
    if (pathname.endsWith("/lookup")) {
  if (!id || (lookupType !== "album" && lookupType !== "track")) {
        return new Response("id and lookupType=album|track required", { status: 400 });
      }
      const r = await fetch(`${API}/${lookupType}s/${id}?market=${market}`, { headers: hdrs });
      return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
    }

    // Default: full-text search (market aware)
    if (!q) {
      return new Response(JSON.stringify({ albums:{}, tracks:{}, artists:{} }), {
        headers: { "Content-Type": "application/json", "X-Route": "DEFAULT", "X-Path": pathname },
      });
    }

    const searchUrl = `${API}/search?` + new URLSearchParams({
      q,
      type,
      market,
      include_external: "audio",
      limit: "20",
    });

  const r = await fetch(searchUrl, { headers: hdrs });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
}
}
);
