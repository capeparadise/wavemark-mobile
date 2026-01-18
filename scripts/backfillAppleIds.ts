// Backfill apple_track_id, apple_album_id, apple_storefront for existing listen_list rows.
// Run with: npx ts-node scripts/backfillAppleIds.ts (after installing ts-node) or compile to JS.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Node 18+ has global fetch. If not present, instruct user.
if (typeof fetch !== 'function') {
  console.error('Global fetch not found. Use Node 18+, or install node-fetch and import it.');
  process.exit(1);
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, anon, { auth: { persistSession: false } });

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface ITunesTrack { wrapperType: 'track'; trackId: number; collectionId?: number; }
interface ITunesCollection { wrapperType: 'collection'; collectionId: number; }
type ITunesResult = ITunesTrack | ITunesCollection | { wrapperType?: string; trackId?: number; collectionId?: number };

async function lookup(id: string, country: string): Promise<ITunesResult[] | null> {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${country}&entity=song`);
    if (!res.ok) return null;
    const j: any = await res.json();
    const arr: any[] = Array.isArray(j?.results) ? j.results : [];
    return arr as ITunesResult[];
  } catch { return null; }
}

async function preflight(): Promise<boolean> {
  const cols = 'id,apple_id,apple_url'; // minimal always-existing
  const { data, error } = await supabase.from('listen_list').select(cols).limit(1);
  if (error) {
    console.error('Preflight basic select failed:', error.message);
    return false;
  }
  // Try selecting one of the new columns to see if migration applied
  const test = await supabase.from('listen_list').select('apple_track_id').limit(1);
  if (test.error) {
    console.error('Column apple_track_id missing. Apply migration SQL file first.');
    return false;
  }
  return true;
}

async function run() {
  const ok = await preflight();
  if (!ok) {
    console.error('Backfill aborted: required columns not present.');
    process.exit(1);
  }
  const { data: rows, error } = await supabase
    .from('listen_list')
    .select('id,item_type,apple_id,apple_track_id,apple_album_id,apple_storefront,apple_url,title,artist_name')
    .order('id', { ascending: true })
    .limit(2000); // safety cap
  if (error) throw error;

  let updates = 0;
  for (const r of rows || []) {
    if (!r.apple_id) continue;
    const needTrack = r.item_type === 'track' && !r.apple_track_id;
    const needAlbum = !r.apple_album_id;
    if (!needTrack && !needAlbum && r.apple_storefront) continue;

    // Derive storefront from existing URL if possible
    let storefront = r.apple_storefront || 'US';
    if (r.apple_url) {
      try {
        const u = new URL(r.apple_url);
        const seg = u.pathname.split('/').filter(Boolean)[0];
        if (seg && /^[a-z]{2}$/i.test(seg)) storefront = seg.toUpperCase();
      } catch {}
    }

    const results = await lookup(r.apple_id, storefront);
    await sleep(120); // be polite to API
    if (!results || !results.length) continue;

    // Identify primary album and track
  const track = results.find((x: ITunesResult) => x.wrapperType === 'track' && String((x as ITunesTrack).trackId) === r.apple_id) || results.find((x: ITunesResult) => x.wrapperType === 'track');
  const collection = results.find((x: ITunesResult) => x.wrapperType === 'collection');

    const patch: any = {};
  const trackTyped = track && track.wrapperType === 'track' ? (track as ITunesTrack) : null;
  const collectionTyped = collection && collection.wrapperType === 'collection' ? (collection as ITunesCollection) : null;
  if (needTrack && trackTyped?.trackId) patch.apple_track_id = String(trackTyped.trackId);
  const albumSourceId = collectionTyped?.collectionId || trackTyped?.collectionId;
  if (needAlbum && albumSourceId) patch.apple_album_id = String(albumSourceId);
    if (!r.apple_storefront && storefront) patch.apple_storefront = storefront.toLowerCase();

    if (Object.keys(patch).length) {
      const { error: upErr } = await supabase.from('listen_list').update(patch).eq('id', r.id);
      if (!upErr) updates++;
    }
  }
  console.log('Backfill complete. Rows updated:', updates);
}

run().catch(e => { console.error(e); process.exit(1); });
