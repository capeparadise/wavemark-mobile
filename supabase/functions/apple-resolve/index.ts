// supabase/functions/apple-resolve/index.ts
// @ts-nocheck
// Resolve an Apple Music canonical ID + URL for a track or album using the Apple Music API.
// Input JSON: { type: 'track'|'album', title: string, artist?: string }
// Env vars required:
//   APPLE_MUSIC_DEV_TOKEN  (Apple Music API developer token)
//   APPLE_MUSIC_STOREFRONT (optional, default 'us')
// Falls back to iTunes Search if Music API not available.

// deno-lint-ignore-file no-explicit-any

const DEV_TOKEN = Deno.env.get('APPLE_MUSIC_DEV_TOKEN');
const STOREFRONT = (Deno.env.get('APPLE_MUSIC_STOREFRONT') || 'us').toLowerCase();

function norm(s: string) {
  return s.toLowerCase().normalize('NFKD')
    .replace(/[’'`]/g, "'")
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function score(type: 'track'|'album', wantTitle: string, wantArtist: string, cand: any): number {
  const titleAttr = type === 'track' ? (cand.attributes?.name ?? '') : (cand.attributes?.name ?? '');
  const artistAttr = cand.attributes?.artistName ?? '';
  const gotTitle = norm(titleAttr);
  const gotArtist = norm(artistAttr);
  let s = 0;
  if (gotTitle === wantTitle) s += 4; else if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) s += 2;
  if (wantArtist) {
    if (gotArtist === wantArtist) s += 3; else if (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist)) s += 1;
  }
  // Recent boost (<=14 days)
  try {
    const dateStr = cand.attributes?.releaseDate;
    if (dateStr) {
      const d = new Date(dateStr);
      const days = (Date.now() - d.getTime()) / 86400000;
      if (!isNaN(days) && days <= 14) s += 1;
    }
  } catch {}
  return s;
}

async function searchMusicApi(term: string, types: string[]): Promise<any | null> {
  if (!DEV_TOKEN) return null;
  const url = new URL(`https://api.music.apple.com/v1/catalog/${STOREFRONT}/search`);
  url.searchParams.set('term', term);
  url.searchParams.set('types', types.join(','));
  url.searchParams.set('limit', '5');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function itunesFallback(term: string, entity: 'musicTrack'|'album', country: string): Promise<any[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country.toUpperCase()}&entity=${entity}&limit=5`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.results) ? j.results : [];
}

function pickBestFromMusicApi(type: 'track'|'album', title: string, artist: string | undefined, json: any) {
  const wantTitle = norm(title);
  const wantArtist = norm(artist || '');
  const bucket = type === 'track' ? json?.results?.songs?.data ?? [] : json?.results?.albums?.data ?? [];
  let best: any = null; let bestScore = -1;
  for (const cand of bucket) {
    const s = score(type, wantTitle, wantArtist, cand);
    if (s > bestScore) { best = cand; bestScore = s; }
    if (bestScore >= 6) break; // strong match
  }
  return best;
}

function buildReturnFromMusic(type: 'track'|'album', cand: any) {
  if (!cand) return { id: null, url: null, albumId: null };
  const id = cand.id ?? null;
  const url = cand.attributes?.url ?? null; // canonical Apple Music URL
  let albumId: string | null = null;
  if (type === 'track') {
    // Try to derive album (collection) id via relationships or URL path
    try {
      const relAlbum = cand.relationships?.albums?.data?.[0]?.id;
      if (relAlbum) albumId = relAlbum;
    } catch {}
  }
  return { id, url, albumId };
}

function pickBestFromItunes(type: 'track'|'album', title: string, artist: string | undefined, rows: any[]) {
  const wantTitle = norm(title);
  const wantArtist = norm(artist || '');
  let best: any = null; let bestScore = -1;
  for (const r of rows) {
    const gotTitle = norm(type === 'track' ? r.trackName : r.collectionName);
    const gotArtist = norm(r.artistName);
    let s = 0;
    if (gotTitle === wantTitle) s += 3; else if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) s += 2;
    if (wantArtist) {
      if (gotArtist === wantArtist) s += 3; else if (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist)) s += 1;
    }
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return best;
}

function buildReturnFromItunes(type: 'track'|'album', best: any) {
  if (!best) return { id: null, url: null, albumId: null };
  const id = type === 'track' ? (best.trackId ?? best.collectionId ?? null) : (best.collectionId ?? null);
  const url = type === 'track' ? (best.trackViewUrl ?? best.collectionViewUrl ?? null) : (best.collectionViewUrl ?? null);
  const albumId = type === 'track' ? (best.collectionId ? String(best.collectionId) : null) : (best.collectionId ? String(best.collectionId) : null);
  return { id: id ? String(id) : null, url: url ? String(url) : null, albumId };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { type, title, artist } = await req.json();
    if (!type || !title) return Response.json({ error: 'Missing type or title' }, { status: 400 });

    // Attempt Music API first if token present
    let out = { id: null, url: null, albumId: null } as any;
    if (DEV_TOKEN) {
      const termParts = [title, artist].filter(Boolean).join(' ');
      const musicJson = await searchMusicApi(termParts, type === 'track' ? ['songs','albums'] : ['albums']);
      if (musicJson) {
        const bestMusic = pickBestFromMusicApi(type, title, artist, musicJson);
        out = buildReturnFromMusic(type, bestMusic);
      }
    }

    // Fallback to iTunes if Music API failed or incomplete
    if (!out.id || !out.url) {
      const termParts = [title, artist].filter(Boolean).join(' ');
      const itRows = await itunesFallback(termParts, type === 'track' ? 'musicTrack' : 'album', STOREFRONT);
      const bestIt = pickBestFromItunes(type, title, artist, itRows);
      const itOut = buildReturnFromItunes(type, bestIt);
      if (!out.id) out.id = itOut.id;
      if (!out.url) out.url = itOut.url;
      if (!out.albumId) out.albumId = itOut.albumId;
    }

    return Response.json({ id: out.id, url: out.url, albumId: out.albumId }, { status: 200 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
});
