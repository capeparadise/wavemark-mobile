// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Followed = { user_id: string; artist_id: string; artist_name: string | null };

function stripDecorations(t: string) {
  return t
    .replace(/\s*-\s*(single|ep|deluxe|expanded|clean|explicit)\b.*$/i, '')
    .replace(/\s*\(.*?\)\s*$/g, '')
    .trim();
}

async function appleSearchAlbums(artist: string, country: string) {
  const term = encodeURIComponent(artist);
  const url = `https://itunes.apple.com/search?term=${term}&country=${country}&entity=album&limit=50`;
  const r = await fetch(url);
  if (!r.ok) return [] as any[];
  const j: any = await r.json();
  return (j.results ?? []).filter((x: any) => x.collectionId && x.collectionName);
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const country = (url.searchParams.get('country') ?? 'GB').toUpperCase();
    const horizonDays = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '60')));
    const limitArtists = Math.max(1, Math.min(200, Number(url.searchParams.get('limitArtists') ?? '100')));

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response('Missing Supabase env', { status: 500 });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get followed artists per user
    const { data: follows, error } = await supabase
      .from('followed_artists')
      .select('user_id,artist_id,artist_name')
      .limit(10000);
    if (error) return new Response(error.message, { status: 500 });

    // Group by user
    const byUser = new Map<string, Followed[]>();
    for (const f of (follows ?? []) as Followed[]) {
      if (!byUser.has(f.user_id)) byUser.set(f.user_id, []);
      byUser.get(f.user_id)!.push(f);
    }

    const today = new Date();
    const cutoff = new Date(today.getTime() + horizonDays * 86400000);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    let inserted = 0;
    for (const [userId, list] of byUser.entries()) {
      const sample = list.slice(0, limitArtists);
      for (const f of sample) {
        const name = f.artist_name || '';
        if (!name) continue;
        const results = await appleSearchAlbums(name, country);
        for (const it of results) {
          const rd = it.releaseDate ? String(it.releaseDate).slice(0, 10) : null;
          if (!rd || rd <= today.toISOString().slice(0,10) || rd > cutoffIso) continue;
          const title = stripDecorations(it.collectionName || '');
          if (!title) continue;

          const payload = {
            user_id: userId,
            artist_id: f.artist_id,
            artist_name: name,
            title,
            release_date: rd,
            apple_id: String(it.collectionId),
            apple_url: it.collectionViewUrl ?? null,
            source: 'apple',
          };

          // Upsert by user + artist + title + date
          const { error: upErr } = await supabase
            .from('upcoming_releases')
            .upsert(payload, {
              onConflict: 'user_id,artist_id,title,release_date',
              ignoreDuplicates: false,
            });
          if (!upErr) inserted++;
        }

        // Phase 2: MusicBrainz future releases (best-effort by artist name)
        try {
          const y = today.getFullYear();
          const q = `artist:"${name}" AND (primarytype:album OR primarytype:ep)`;
          const mbUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json`;
          const mbRes = await fetch(mbUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'wavemark-mobile/1.0 (support@wavemark.app)' } });
          if (mbRes.ok) {
            const mbJson: any = await mbRes.json();
            const groups: any[] = mbJson['release-groups'] ?? [];
            for (const g of groups) {
              const title2 = stripDecorations(g.title || '');
              if (!title2) continue;
              const ptype = (g['primary-type'] || '').toLowerCase();
              if (ptype && ptype !== 'album' && ptype !== 'ep') continue;
              const frd = g['first-release-date'] ? String(g['first-release-date']).slice(0,10) : null;
              if (!frd) continue;
              if (frd <= today.toISOString().slice(0,10) || frd > cutoffIso) continue;
              const payload2 = {
                user_id: userId,
                artist_id: f.artist_id,
                artist_name: name,
                title: title2,
                release_date: frd,
                mb_release_group_id: g.id || null,
                source: 'musicbrainz',
              } as any;
              const { error: upErr2 } = await supabase
                .from('upcoming_releases')
                .upsert(payload2, {
                  onConflict: 'user_id,artist_id,title,release_date',
                  ignoreDuplicates: false,
                });
              // ignore upErr2
            }
          }
        } catch {}
      }
    }

    return new Response(JSON.stringify({ inserted }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(`Error: ${(e as Error).message}`, { status: 500 });
  }
});
