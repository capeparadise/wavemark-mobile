// app/lib/queries.ts
import type { AppleAlbum, AppleTrack } from './apple';
import { supabase } from './supabaseClient';

export type ListenRow = {
  id: string;
  user_id: string;
  item_type: 'track' | 'album' | 'ep';
  title: string;
  artist_name: string;
  artwork_url: string | null;
  external_id: string;                // Apple/Spotify ID (TEXT)
  provider: 'apple' | 'spotify';
  created_at: string;                 // when the row was added
  done_at: string | null;             // when the user marked it done
};

// ---------- Add to listen list (Apple search results) ----------
export async function addToListenListFromApple(
  item: AppleTrack | AppleAlbum,
  itemType: 'track' | 'album' | 'ep'
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };

  const isTrack = (i: any): i is AppleTrack => 'trackId' in i;

  const externalId = String(isTrack(item) ? item.trackId : item.collectionId);
  const title      = isTrack(item) ? item.trackName : item.collectionName;
  const artistName = item.artistName;
  const artworkUrl = (item as any).artworkUrl ?? null;

  const { error } = await supabase.from('listen_list').insert({
    user_id: user.id,
    item_type: itemType,
    title,
    artist_name: artistName,
    artwork_url: artworkUrl,
    external_id: externalId,
    provider: 'apple',
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ---------- Fetch the user’s listen list ----------
export async function fetchListenList(): Promise<ListenRow[]> {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('listen_list')
    .select(
      'id,user_id,item_type,title,artist_name,artwork_url,external_id,provider,created_at,done_at'
    )
    .eq('user_id', user.id)
    .order('done_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('fetchListenList error', error);
    return [];
  }
  return (data ?? []) as ListenRow[];
}

// ---------- Mark an item done/undone ----------
export async function markDone(id: string, done: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('listen_list')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) {
    console.error('markDone error', error);
    return false;
  }
  return true;
}

// ---------- Remove an item ----------
export async function removeListen(id: string): Promise<boolean> {
  const { error } = await supabase.from('listen_list').delete().eq('id', id);
  if (error) {
    console.error('removeListen error', error);
    return false;
  }
  return true;
}
