/* ========================================================================
   File: scripts/backfillAppleUrls.ts
   PURPOSE:
     - Populate apple_url for existing listen_list rows that are missing them.
   USAGE (run from project root, Node 18+):
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfillAppleUrls.ts
   REQUIREMENTS:
     - Your Supabase URL and SERVICE ROLE key in env (server-side only; do NOT ship to client!)
   ======================================================================== */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

// Admin client (service role) — bypasses RLS
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

type Row = {
  id: string;
  item_type: 'track' | 'album';
  title: string | null;
  artist_name: string | null;
  apple_id: string | null;
  apple_url: string | null;
};

async function lookupAppleUrl(id: string, type: 'track' | 'album'): Promise<string | null> {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
  const j = (await res.json()) as any;
  const r = j?.results?.[0];
    if (!r) return null;
    return type === 'track'
      ? (r.trackViewUrl ?? r.collectionViewUrl ?? null)
      : (r.collectionViewUrl ?? r.trackViewUrl ?? null);
  } catch {
    return null;
  }
}

async function backfillBatch(limit = 50): Promise<number> {
  const { data: rows, error } = await admin
    .from('listen_list')
    .select('id,item_type,title,artist_name,apple_id,apple_url')
    .is('apple_url', null)
    .not('apple_id', 'is', null)
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  let updated = 0;
  for (const r of rows as Row[]) {
    if (!r.apple_id) continue;

    const url = await lookupAppleUrl(r.apple_id, r.item_type);
    if (!url) {
      console.log('[skip] no url:', r.id, r.title);
      continue;
    }

    const { error: updErr } = await admin
      .from('listen_list')
      .update({ apple_url: url })
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
