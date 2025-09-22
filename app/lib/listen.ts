// app/lib/listen.ts
import type { AppleAlbum, AppleTrack } from './apple';
import { supabase } from './supabaseClient';

/** What a row in the user's listen list looks like in the app */
export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple';
  provider_id: string;        // Apple ID (trackId / collectionId as string)
  title: string;
  artist_name: string;
  artwork_url: string | null;
  release_date: string | null;
  done_at: string | null;     // when the user marked it “done”
  created_at: string;
};

/** Add a track OR an album from Apple to the user's listen list */
export async function addToListenList(
  itemType: 'track' | 'album',
  item: AppleTrack | AppleAlbum
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Normalise input from Apple types
  const isTrack = itemType === 'track';
  const provider_id = String(isTrack ? (item as AppleTrack).trackId : (item as AppleAlbum).collectionId);

  const title = isTrack ? (item as AppleTrack).trackName : (item as AppleAlbum).collectionName;
  const artist_name = isTrack ? (item as AppleTrack).artistName : (item as AppleAlbum).artistName;
  const artwork_url = (item as any).artworkUrl ?? null;
  const release_date = isTrack
    ? ((item as AppleTrack).releaseDate ?? null)
    : ((item as AppleAlbum).releaseDate ?? null);

  const { error } = await supabase
    .from('listen_list')
    .insert({
      item_type: itemType,
      provider: 'apple',
      provider_id,
      title,
      artist_name,
      artwork_url,
      release_date,
    })
    .select()
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

/** Fetch the current user's listen list (newest first) */
export async function fetchListenList(): Promise<ListenRow[]> {
  const { data, error } = await supabase
    .from('listen_list')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as unknown as ListenRow[];
}

/** Mark an item done/undone */
export async function markDone(id: string, done: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('listen_list')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', id);

  return !error;
}

/** Remove an item from the list */
export async function removeListen(id: string): Promise<boolean> {
  const { error } = await supabase.from('listen_list').delete().eq('id', id);
  return !error;
}
