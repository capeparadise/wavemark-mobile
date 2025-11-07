// supabase/functions/spotify-resolve/index.ts
// @ts-nocheck
// Resolve a Spotify ID + URL for a track/album using Client Credentials flow.
// Expects POST JSON: { type: 'track'|'album', title: string, artist?: string }

// deno-lint-ignore-file no-explicit-any

const CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET');

async function getAppToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
  }
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Token fetch failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.access_token as string;
}

const MARKET = Deno.env.get('SPOTIFY_MARKET') ?? 'GB';

// Helpers for fuzzy-ish match
function norm(s: string) {
  return s.toLowerCase().normalize('NFKD')
    .replace(/[’'`]/g, "'")
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\(\)\[\]\{\}:;!?.&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function scoreCandidate(
  type: 'track'|'album',
  title: string,
  artist: string | undefined,
  cand: any
): number {
  const wantTitle = norm(title);
  const wantArtist = norm(artist ?? '');
  const gotTitle = norm(type === 'track' ? cand.name : cand.name);
  const gotArtist = norm((cand.artists?.[0]?.name ?? '') as string);

  let s = 0;
  if (gotTitle === wantTitle) s += 3;
  else if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) s += 2;

  if (wantArtist) {
    if (gotArtist === wantArtist) s += 3;
    else if (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist)) s += 1;
  }

  // recent releases get a tiny bump (helps “yesterday” albums)
  try {
    const date = new Date((cand.release_date ?? cand.album?.release_date) as string);
    const days = (Date.now() - date.getTime()) / 86400000;
    if (!isNaN(days) && days <= 14) s += 1;
  } catch {}
  return s;
}

async function searchOnce(q: string, type: 'track'|'album', limit = 5) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', type);
  url.searchParams.set('limit', String(limit));
  if (MARKET) url.searchParams.set('market', MARKET);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${await getAppToken()}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return type === 'track' ? json.tracks?.items ?? [] : json.albums?.items ?? [];
}

function stripDecorations(t: string) {
  return t.replace(/\s*-\s*(single|ep|deluxe|expanded|clean|explicit)\b.*$/i, '')
          .replace(/\s*\(.*?\)\s*$/g, '')
          .trim();
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { type, title, artist } = (await req.json()) as {
      type: 'track' | 'album'; title: string; artist?: string;
    };
    if (!type || !title) return Response.json({ error: 'Missing type or title' }, { status: 400 });

    // Try a few strategies, pick the best-scoring candidate
    const queries: string[] = [];
    // strict fielded with quotes
    queries.push(`${type}:"${title}"${artist ? ` artist:"${artist}"` : ''}`);
    // relaxed fielded without quotes
    queries.push(`${type}:${title}${artist ? ` artist:${artist}` : ''}`);
    // plain text
    queries.push([title, artist].filter(Boolean).join(' '));
    // stripped decorations (e.g., “(Deluxe)”, “- Single”)
    const stripped = stripDecorations(title);
    if (stripped !== title) {
      queries.push(`${type}:"${stripped}"${artist ? ` artist:"${artist}"` : ''}`);
      queries.push([stripped, artist].filter(Boolean).join(' '));
    }

    let best: any = null;
    let bestScore = -1;

    for (const q of queries) {
      const items = await searchOnce(q, type, 5);
      if (!items || items.length === 0) continue;
      for (const cand of items) {
        const s = scoreCandidate(type, title, artist, cand);
        if (s > bestScore) {
          best = cand;
          bestScore = s;
        }
      }
      if (bestScore >= 4) break; // good enough, stop early
    }

    if (!best) return Response.json({ id: null, url: null }, { status: 200 });

    const id = best.id as string;
    const urlOut = type === 'track'
      ? `https://open.spotify.com/track/${id}`
      : `https://open.spotify.com/album/${id}`;

    return Response.json({ id, url: urlOut }, { status: 200 });
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
});
