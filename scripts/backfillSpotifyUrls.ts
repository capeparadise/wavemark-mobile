/* ========================================================================
   File: scripts/backfillSpotifyUrls.ts
   PURPOSE:
     - Populate spotify_id/spotify_url for existing listen_list rows that are missing them.
   USAGE (run from project root, Node 18+):
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfillSpotifyUrls.ts
   REQUIREMENTS:
     - Your Supabase URL and **SERVICE ROLE** key in env (server-side only; do NOT ship to client!)
     - Edge function `spotify-resolve` already deployed
   ======================================================================== */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

// Admin client (service role) — bypasses RLS for backfill
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

type Row = {
  id: string;
  item_type: 'track' | 'album';
  title: string | null;
  artist_name: string | null;
  spotify_id: string | null;
  spotify_url: string | null;
};

async function resolveSpotify(
  type: 'track' | 'album',
  title: string,
  artist?: string | null
): Promise<{ id: string | null; url: string | null }> {
  const { data, error } = await admin.functions.invoke('spotify-resolve', {
    body: { type, title, artist: artist ?? undefined },
  });
  if (error) {
    console.warn('[resolve] error:', error.message);
    return { id: null, url: null };
  }
  return { id: data?.id ?? null, url: data?.url ?? null };
}

async function backfillBatch(limit = 50): Promise<number> {
  const { data: rows, error } = await admin
    .from('listen_list')
    .select('id,item_type,title,artist_name,spotify_id,spotify_url')
    .is('spotify_url', null)
    .not('title', 'is', null)
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  let updated = 0;
  for (const r of rows as Row[]) {
    const title = r.title?.trim();
    if (!title) continue;

    const { id, url } = await resolveSpotify(r.item_type, title, r.artist_name);
    if (!id || !url) {
      console.log('[skip] no match:', { id: r.id, title, artist: r.artist_name });
      continue;
    }

    const { error: updErr } = await admin
      .from('listen_list')
      .update({ spotify_id: id, spotify_url: url })
      .eq('id', r.id);

    if (updErr) {
      console.warn('[update] failed:', r.id, updErr.message);
      continue;
    }
    updated++;
    console.log('[updated]', r.id, '→', url);
  }
  return updated;
}

(async () => {
  let total = 0;
  for (;;) {
    const n = await backfillBatch(50);
    total += n;
    if (n === 0) break;
  }
  console.log('Backfill complete. Updated rows:', total);
})();
