// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

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

type FollowedArtist = { artist_id: string; artist_name: string | null };

function normalizedName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isVariousArtists(value: unknown) {
  return normalizedName(value) === "various artists";
}

function releaseArtistMatch(album: any, artistId: string) {
  const artists = Array.isArray(album?.artists) ? album.artists : [];
  return artists.find((artist: any) => artist?.id === artistId) ?? null;
}

function isAllowedFollowedRelease(album: any, artistId: string) {
  const albumType = normalizedName(album?.album_type);
  const albumGroup = normalizedName(album?.album_group);
  if (!album?.id || !album?.name || !album?.release_date || !album?.external_urls?.spotify) return false;
  if (albumType === "compilation" || albumGroup === "compilation" || albumGroup === "appears_on") return false;
  if (album?.external_urls?.spotify && !String(album.external_urls.spotify).includes("open.spotify.com/album/")) return false;
  if ((Array.isArray(album?.artists) ? album.artists : []).some((artist: any) => isVariousArtists(artist?.name))) return false;
  return !!releaseArtistMatch(album, artistId);
}

serve(async (req) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    }
    const url = new URL(req.url);
  const market = (url.searchParams.get("market") ?? "GB").toUpperCase();
  const maxArtists = Number(url.searchParams.get("limitArtists") ?? "200");
  const singleArtistId = url.searchParams.get("artistId");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
    const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response("Missing Supabase service env", { status: 500 });
    }
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return new Response("Missing Spotify env", { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const bearer = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!bearer) return new Response('Authentication required', { status: 401 });
    // Only the exact server-side credential may scan across accounts. Never
    // trust decoded JWT claims or a caller-supplied user ID.
    const schedulerToken = Deno.env.get('FEED_SCAN_SCHEDULER_TOKEN');
    const trustedScheduler = bearer === SUPABASE_SERVICE_ROLE_KEY || (!!schedulerToken && bearer === schedulerToken);
    let userId: string | null = null;
    if (!trustedScheduler) {
      const { data, error } = await supabase.auth.getUser(bearer);
      if (error || !data?.user) return new Response('Authentication required', { status: 401 });
      userId = data.user.id;
    }
    if (!/^[A-Z]{2}$/.test(market) || !Number.isInteger(maxArtists) || maxArtists < 1 || maxArtists > 200 ||
        (singleArtistId !== null && !/^[A-Za-z0-9]{22}$/.test(singleArtistId))) {
      return new Response('Invalid scan parameters', { status: 400 });
    }
    if (!trustedScheduler) {
      if (!singleArtistId) return new Response('An artist is required', { status: 400 });
      const { data, error } = await supabase.from('followed_artists')
        .select('artist_id').eq('user_id', userId).eq('artist_id', singleArtistId).limit(1);
      if (error) return new Response('Unable to verify artist follow', { status: 503 });
      if (!data?.length) return new Response('Follow this artist before refreshing', { status: 403 });
    }

    let artists: Array<[string, string | null]> = [];
    if (singleArtistId) {
      artists = [[singleArtistId, null]];
    } else {
      // Fetch followed artists (all users). We'll dedupe by artist_id client-side.
      const { data: follows, error: followsErr } = await supabase
        .from("followed_artists")
        .select("artist_id, artist_name")
        .limit(1000);
      if (followsErr) throw followsErr;

      const uniqueMap = new Map<string, string | null>();
      (follows ?? []).forEach((f: FollowedArtist) => {
        if (!uniqueMap.has(f.artist_id)) uniqueMap.set(f.artist_id, f.artist_name ?? null);
      });
      artists = Array.from(uniqueMap.entries()).slice(0, Math.max(0, maxArtists));
    }
    if (artists.length === 0) {
      return new Response(JSON.stringify({ processed: 0, inserted: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await getAppToken(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
    const hdrs = { Authorization: `Bearer ${token}` };

    let inserted = 0;
    let processed = 0;

    // Process sequentially to be gentle on Spotify's API
    for (const [artistId, artistName] of artists) {
      processed++;
      const r = await fetch(
        `${API}/artists/${artistId}/albums?` +
          new URLSearchParams({ include_groups: "album,single", market, limit: "50" }),
        { headers: hdrs }
      );
      if (!r.ok) continue;
      const data = await r.json();
      const items = data.items ?? [];

      for (const a of items) {
        if (!isAllowedFollowedRelease(a, artistId)) continue;
        const title = a?.name ?? null;
        const relDate = a?.release_date ?? null;
        const url = a?.external_urls?.spotify ?? null;
        const matchedArtist = releaseArtistMatch(a, artistId);
        const rowArtist = matchedArtist?.name ?? artistName ?? null;
        const imageUrl = a?.images?.[0]?.url ?? null;
        const releaseType = a?.album_type ?? null; // 'album' | 'single' | 'compilation'
        if (!title || !relDate || !url) continue;

        // Check if already exists by spotify_url
        const { data: existing, error: exErr } = await supabase
          .from("new_release_feed")
          .select("id,image_url,release_type")
          .eq("spotify_url", url)
          .limit(1)
          .maybeSingle();
        if (exErr) continue;
        if (existing) {
          // Backfill missing columns if schema supports them
          if ((imageUrl && (!('image_url' in existing) || existing.image_url == null)) || (releaseType && (!('release_type' in existing) || existing.release_type == null))) {
            const { error: updErr } = await supabase
              .from("new_release_feed")
              .update({ image_url: imageUrl ?? null, release_type: releaseType ?? null })
              .eq("id", (existing as any).id);
            // If columns don't exist, ignore
          }
          continue;
        }

        let { error: insErr } = await supabase.from("new_release_feed").insert({
          artist_id: artistId,
          artist_name: rowArtist,
          title,
          release_date: relDate,
          spotify_url: url,
          image_url: imageUrl,
          release_type: releaseType,
        });
        if (insErr && /column .* does not exist/i.test(insErr.message || '')) {
          // Fallback for older schema without these columns
          const { error: retryErr } = await supabase.from("new_release_feed").insert({
            artist_id: artistId,
            artist_name: rowArtist,
            title,
            release_date: relDate,
            spotify_url: url,
          });
          insErr = retryErr || null;
        }
        if (!insErr) inserted++;
      }
    }

    return new Response(JSON.stringify({ processed, inserted }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response('Release refresh failed', { status: 500 });
  }
});
