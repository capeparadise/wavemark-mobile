// supabase/functions/apple-resolve/index.ts
// @ts-nocheck
// Resolve an Apple Music canonical ID + URL for a track or album using the Apple Music API.
// Input JSON: { type: 'track'|'album', title: string, artist?: string }
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
    const termParts = [title, artist].filter(Boolean).join(' ');
    const musicJson = await searchMusicApi(termParts, type === 'track' ? ['songs','albums'] : ['albums']);
    if (musicJson) {
      const bestMusic = pickBestFromMusicApi(type, title, artist, musicJson);
      out = buildReturnFromMusic(type, bestMusic);
    }

    // Fallback to iTunes if Music API failed or incomplete
    if (!out.id || !out.url) {
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
