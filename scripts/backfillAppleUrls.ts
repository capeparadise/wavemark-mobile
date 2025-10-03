/* ========================================================================
   VS CODE AGENT INSTRUCTIONS
   File: scripts/backfillAppleUrls.ts
   ACTION: Create this file.
   PURPOSE:
     - Populate apple_url/apple_id for older rows without them.
   RUN:
     - Import and call backfillAppleUrls() from a dev/debug screen or button.
   ======================================================================== */

import { supabase } from '../lib/supabase';

type LL = {
  id: string;
  item_type: 'track' | 'album';
  title: string;
  artist_name: string | null;
  apple_url: string | null;
  apple_id: string | null;
  provider: 'apple' | 'spotify';
  provider_id: string | null;
};

export async function backfillAppleUrls() {
  const { data, error } = await supabase
    .from('listen_list')
    .select(
      'id,item_type,title,artist_name,apple_url,apple_id,provider,provider_id'
    );

  if (error) throw error;

  const rows = (data ?? []) as LL[];

  for (const r of rows) {
    if (r.apple_url) continue;
    // use iTunes Search API (no auth)
    const query = encodeURIComponent(
      [r.title, r.artist_name].filter(Boolean).join(' ')
    );
    const entity = r.item_type === 'track' ? 'song' : 'album';
    const url = `https://itunes.apple.com/search?term=${query}&entity=${entity}&limit=1`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
  const json = (await res.json()) as any;
  const hit = json?.results?.[0];
      if (!hit) continue;

      const appleUrl =
        r.item_type === 'track'
          ? hit.trackViewUrl ?? null
          : hit.collectionViewUrl ?? null;
      const appleId =
        r.item_type === 'track'
          ? hit.trackId != null
            ? String(hit.trackId)
            : null
          : hit.collectionId != null
            ? String(hit.collectionId)
            : null;

      if (appleUrl) {
        await supabase
          .from('listen_list')
          .update({ apple_url: appleUrl, apple_id: appleId })
          .eq('id', r.id);
      }
    } catch {
      // ignore individual failures
    }
  }
}
