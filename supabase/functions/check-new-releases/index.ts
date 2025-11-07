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

serve(async (req) => {
  try {
    const url = new URL(req.url);
  const market = (url.searchParams.get("market") ?? "GB").toUpperCase();
  const maxArtists = parseInt(url.searchParams.get("limitArtists") ?? "200", 10);
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

    let artists: Array<[string, string | null]> = [];
    if (singleArtistId) {
      artists = [[singleArtistId, null]];
    } else {
      // Fetch followed artists (all users). We'll dedupe by artist_id client-side.
      const { data: follows, error: followsErr } = await supabase
        .from("followed_artists")
        .select("artist_id, artist_name");
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
          new URLSearchParams({ include_groups: "album,single", market, limit: "20" }),
        { headers: hdrs }
      );
      if (!r.ok) continue;
      const data = await r.json();
      const items = data.items ?? [];

      for (const a of items) {
        const title = a?.name ?? null;
        const relDate = a?.release_date ?? null;
        const url = a?.external_urls?.spotify ?? null;
        const rowArtist = a?.artists?.[0]?.id === artistId ? (a?.artists?.[0]?.name ?? artistName) : (artistName ?? a?.artists?.[0]?.name ?? null);
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
    return new Response(`error: ${(e as Error).message}` , { status: 500 });
  }
});
