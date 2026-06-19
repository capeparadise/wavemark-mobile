// supabase/functions/apple-resolve/index.ts
// @ts-nocheck
// Resolve an Apple Music canonical ID + URL for a track or album using the Apple Music API.
// Input JSON: { type: 'track'|'album', title: string, artist?: string, isrc?: string }
// Supabase secrets supported:
//   APPLE_MUSIC_TEAM_ID
//   APPLE_MUSIC_KEY_ID
//   APPLE_MUSIC_PRIVATE_KEY
//   APPLE_MUSIC_PRIVATE_KEY_BASE64
//   APPLE_MUSIC_DEV_TOKEN
//   APPLE_MUSIC_STOREFRONT
// Falls back to iTunes Search if Music API not available.

// deno-lint-ignore-file no-explicit-any

const MANUAL_DEV_TOKEN = Deno.env.get('APPLE_MUSIC_DEV_TOKEN')?.trim() || '';
const STOREFRONT = (Deno.env.get('APPLE_MUSIC_STOREFRONT') || 'gb').toLowerCase();
const APPLE_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h, comfortably below Apple's maximum.
const APPLE_TOKEN_REFRESH_SKEW_SECONDS = 60 * 5;

let cachedGeneratedToken: { token: string; expiresAtSeconds: number } | null = null;

function norm(s: string) {
  return s.toLowerCase().normalize('NFKD')
    .replace(/[’'`]/g, "'")
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string) {
  return norm(s).split(/\s+/).filter(Boolean);
}

function coverage(want: string[], got: string[]) {
  if (!want.length) return 0;
  const matches = want.filter((token) => got.includes(token)).length;
  return matches / want.length;
}

function confidenceFor(type: 'track'|'album', title: string, artist: string | undefined, cand: any) {
  const resultTitle = type === 'track'
    ? (cand.attributes?.name ?? cand.trackName ?? '')
    : (cand.attributes?.name ?? cand.collectionName ?? '');
  const resultArtist = cand.attributes?.artistName ?? cand.artistName ?? '';
  const wantTitle = tokens(title);
  const gotTitle = tokens(resultTitle);
  const wantArtist = tokens(artist || '');
  const gotArtist = tokens(resultArtist);
  const titleCoverage = coverage(wantTitle, gotTitle);
  const artistCoverage = wantArtist.length ? coverage(wantArtist, gotArtist) : 1;
  const exactTitle = norm(resultTitle) === norm(title);
  const exactArtist = !artist || norm(resultArtist) === norm(artist);
  const confidence = Math.min(
    1,
    (titleCoverage * 0.68) +
      (artistCoverage * 0.27) +
      (exactTitle ? 0.03 : 0) +
      (exactArtist ? 0.02 : 0),
  );
  return { confidence, resultTitle, resultArtist, titleCoverage, artistCoverage, exactTitle, exactArtist };
}

function isConfidentMatch(meta: any) {
  if (!meta) return false;
  if (meta.exactTitle && meta.exactArtist) return meta.confidence >= 0.95;
  return meta.confidence >= 0.92 && meta.titleCoverage >= 0.9 && meta.artistCoverage >= 0.8;
}

function isAmbiguous(bestMeta: any, secondMeta: any) {
  if (!bestMeta || !secondMeta) return false;
  if (bestMeta.exactTitle && bestMeta.exactArtist) return false;
  return bestMeta.confidence - secondMeta.confidence < 0.08;
}

function base64UrlEncode(input: string | ArrayBuffer | Uint8Array) {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64ToBytes(value: string) {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function privateKeyToPkcs8Bytes(privateKey: string) {
  const match = privateKey.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  const body = (match?.[1] || privateKey).replace(/\s+/g, '');
  return decodeBase64ToBytes(body);
}

function getPrivateKeyBytes(rawKey?: string | null, rawKeyBase64?: string | null) {
  if (rawKeyBase64?.trim()) {
    const bytes = decodeBase64ToBytes(rawKeyBase64);
    const decodedText = new TextDecoder().decode(bytes).replace(/\\n/g, '\n').trim();
    if (decodedText.includes('PRIVATE KEY')) return privateKeyToPkcs8Bytes(decodedText);
    return bytes;
  }
  const privateKey = (rawKey || '').replace(/\\n/g, '\n').trim();
  if (!privateKey) return null;
  return privateKeyToPkcs8Bytes(privateKey);
}

async function generateAppleDeveloperToken() {
  const teamId = Deno.env.get('APPLE_MUSIC_TEAM_ID')?.trim();
  const keyId = Deno.env.get('APPLE_MUSIC_KEY_ID')?.trim();
  const privateKeyBytes = getPrivateKeyBytes(
    Deno.env.get('APPLE_MUSIC_PRIVATE_KEY'),
    Deno.env.get('APPLE_MUSIC_PRIVATE_KEY_BASE64'),
  );

  if (!teamId || !keyId || !privateKeyBytes) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    cachedGeneratedToken &&
    cachedGeneratedToken.expiresAtSeconds - APPLE_TOKEN_REFRESH_SKEW_SECONDS > nowSeconds
  ) {
    return cachedGeneratedToken.token;
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const expiresAtSeconds = nowSeconds + APPLE_TOKEN_TTL_SECONDS;
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = { iss: teamId, iat: nowSeconds, exp: expiresAtSeconds };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${base64UrlEncode(signature)}`;
  cachedGeneratedToken = { token, expiresAtSeconds };
  return token;
}

async function getDeveloperToken() {
  try {
    const generatedToken = await generateAppleDeveloperToken();
    if (generatedToken) return generatedToken;
  } catch (e) {
    console.warn('[apple-resolve] failed to generate Apple Music developer token', {
      message: String((e as any)?.message ?? e),
    });
  }
  return MANUAL_DEV_TOKEN || null;
}

async function searchMusicApi(term: string, types: string[]): Promise<any | null> {
  const devToken = await getDeveloperToken();
  if (!devToken) return null;
  const url = new URL(`https://api.music.apple.com/v1/catalog/${STOREFRONT}/search`);
  url.searchParams.set('term', term);
  url.searchParams.set('types', types.join(','));
  url.searchParams.set('limit', '5');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${devToken}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function lookupMusicApiByIsrc(isrc: string): Promise<any | null> {
  const devToken = await getDeveloperToken();
  if (!devToken) return null;
  const cleanIsrc = String(isrc || '').trim();
  if (!cleanIsrc) return null;
  const url = new URL(`https://api.music.apple.com/v1/catalog/${STOREFRONT}/songs`);
  url.searchParams.set('filter[isrc]', cleanIsrc);
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${devToken}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

function buildReturnFromMusicSong(cand: any, source = 'isrc', matchReason = 'isrc') {
  if (!cand) return { id: null, url: null, albumId: null, source, confidence: 0, kind: 'track', matchReason };
  let albumId: string | null = null;
  try {
    albumId = cand.relationships?.albums?.data?.[0]?.id ?? null;
  } catch {}
  return {
    id: cand.id ?? null,
    url: cand.attributes?.url ?? null,
    albumId,
    source,
    confidence: 1,
    resultTitle: cand.attributes?.name ?? null,
    resultArtist: cand.attributes?.artistName ?? null,
    kind: 'track',
    matchReason,
  };
}

async function itunesLookupByIsrc(isrc: string, country: string): Promise<any | null> {
  const cleanIsrc = String(isrc || '').trim();
  if (!cleanIsrc) return null;
  const url = `https://itunes.apple.com/lookup?isrc=${encodeURIComponent(cleanIsrc)}&country=${country.toUpperCase()}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j.results) ? (j.results[0] ?? null) : null;
}

async function itunesFallback(term: string, entity: 'musicTrack'|'album', country: string): Promise<any[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country.toUpperCase()}&entity=${entity}&limit=5`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.results) ? j.results : [];
}

function pickBestFromMusicApi(type: 'track'|'album', title: string, artist: string | undefined, json: any) {
  const bucket = type === 'track' ? json?.results?.songs?.data ?? [] : json?.results?.albums?.data ?? [];
  let best: any = null; let bestMeta: any = null; let secondMeta: any = null;
  for (const cand of bucket) {
    const meta = confidenceFor(type, title, artist, cand);
    if (!bestMeta || meta.confidence > bestMeta.confidence) {
      secondMeta = bestMeta;
      best = cand;
      bestMeta = meta;
    } else if (!secondMeta || meta.confidence > secondMeta.confidence) {
      secondMeta = meta;
    }
  }
  return best && isConfidentMatch(bestMeta) && !isAmbiguous(bestMeta, secondMeta) ? { cand: best, meta: bestMeta } : null;
}

function buildReturnFromMusic(type: 'track'|'album', picked: any) {
  const cand = picked?.cand;
  if (!cand) return { id: null, url: null, albumId: null, source: 'music_search', confidence: 0, kind: type, matchReason: 'low_confidence' };
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
  return {
    id,
    url,
    albumId,
    source: 'music_search',
    confidence: picked.meta?.confidence ?? 0,
    resultTitle: picked.meta?.resultTitle ?? null,
    resultArtist: picked.meta?.resultArtist ?? null,
    kind: type,
    matchReason: 'title_artist_confident',
  };
}

function pickBestFromItunes(type: 'track'|'album', title: string, artist: string | undefined, rows: any[]) {
  let best: any = null; let bestMeta: any = null; let secondMeta: any = null;
  for (const r of rows) {
    const meta = confidenceFor(type, title, artist, r);
    if (!bestMeta || meta.confidence > bestMeta.confidence) {
      secondMeta = bestMeta;
      best = r;
      bestMeta = meta;
    } else if (!secondMeta || meta.confidence > secondMeta.confidence) {
      secondMeta = meta;
    }
  }
  return best && isConfidentMatch(bestMeta) && !isAmbiguous(bestMeta, secondMeta) ? { cand: best, meta: bestMeta } : null;
}

function buildReturnFromItunes(type: 'track'|'album', picked: any, source = 'itunes_search', matchReason = 'title_artist_confident') {
  const best = picked?.cand ?? picked;
  const meta = picked?.meta ?? null;
  if (!best) return { id: null, url: null, albumId: null };
  const id = type === 'track' ? (best.trackId ?? best.collectionId ?? null) : (best.collectionId ?? null);
  const url = type === 'track' ? (best.trackViewUrl ?? best.collectionViewUrl ?? null) : (best.collectionViewUrl ?? null);
  const albumId = type === 'track' ? (best.collectionId ? String(best.collectionId) : null) : (best.collectionId ? String(best.collectionId) : null);
  return {
    id: id ? String(id) : null,
    url: url ? String(url) : null,
    albumId,
    source,
    confidence: source === 'isrc' ? 1 : (meta?.confidence ?? 0),
    resultTitle: meta?.resultTitle ?? (type === 'track' ? best.trackName : best.collectionName) ?? null,
    resultArtist: meta?.resultArtist ?? best.artistName ?? null,
    kind: type,
    matchReason,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { type, title, artist, isrc } = await req.json();
    if (!type || !title) return Response.json({ error: 'Missing type or title' }, { status: 400 });

    // Attempt Music API first if token present
    let out = { id: null, url: null, albumId: null } as any;
    if (type === 'track' && isrc) {
      const isrcJson = await lookupMusicApiByIsrc(isrc);
      const isrcHit = Array.isArray(isrcJson?.data) ? isrcJson.data[0] : null;
      out = buildReturnFromMusicSong(isrcHit);
    }

    const termParts = [title, artist].filter(Boolean).join(' ');
    const musicJson = (!out.id || !out.url)
      ? await searchMusicApi(termParts, type === 'track' ? ['songs','albums'] : ['albums'])
      : null;
    if (musicJson) {
      const bestMusic = pickBestFromMusicApi(type, title, artist, musicJson);
      out = buildReturnFromMusic(type, bestMusic);
    }

    // Fallback to iTunes if Music API failed or incomplete
    if (!out.id || !out.url) {
      const isrcIt = type === 'track' && isrc ? await itunesLookupByIsrc(isrc, STOREFRONT) : null;
      const itRows = isrcIt ? [isrcIt] : await itunesFallback(termParts, type === 'track' ? 'musicTrack' : 'album', STOREFRONT);
      const bestIt = isrcIt ? isrcIt : pickBestFromItunes(type, title, artist, itRows);
      const itOut = buildReturnFromItunes(
        type,
        bestIt,
        isrcIt ? 'isrc' : 'itunes_search',
        isrcIt ? 'isrc' : 'title_artist_confident',
      );
      if (!out.id) out.id = itOut.id;
      if (!out.url) out.url = itOut.url;
      if (!out.albumId) out.albumId = itOut.albumId;
      if (itOut.url || itOut.id) {
        out.source = itOut.source;
        out.confidence = itOut.confidence;
        out.resultTitle = itOut.resultTitle;
        out.resultArtist = itOut.resultArtist;
        out.kind = itOut.kind;
        out.matchReason = itOut.matchReason;
      }
    }

    return Response.json({
      id: out.id,
      url: out.url,
      albumId: out.albumId,
      source: out.source ?? null,
      confidence: typeof out.confidence === 'number' ? out.confidence : 0,
      resultTitle: out.resultTitle ?? null,
      resultArtist: out.resultArtist ?? null,
      kind: out.kind ?? type,
      matchReason: out.matchReason ?? (out.url ? 'matched' : 'no_confident_match'),
    }, { status: 200 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
});
