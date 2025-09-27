// app/lib/listen.ts
import type { AppleAlbum, AppleTrack } from './apple';
import { supabase } from './supabaseClient';

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple';
  provider_id: string;        // Apple ID (trackId / collectionId as string)
  title: string;
  artist_name: string;
  artwork_url: string | null;
  release_date: string | null; // Apple dates are ISO strings
  done_at: string | null;      // when the user marked it “done”
  created_at: string;
};

/** Add a track OR an album from Apple to the user's listen list */
export async function addToListenList(
  itemType: 'track' | 'album',
  item: AppleTrack | AppleAlbum
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const isTrack = itemType === 'track';

    // Apple IDs as strings
    const provider_id = String(
      isTrack ? (item as AppleTrack).trackId : (item as AppleAlbum).collectionId
    );

    const title = isTrack
      ? (item as AppleTrack).trackName
      : (item as AppleAlbum).collectionName;

    const artist_name = isTrack
      ? (item as AppleTrack).artistName
      : (item as AppleAlbum).artistName;

    const artwork_url = (item as any).artworkUrl ?? null;

    // IMPORTANT: read via `any` to avoid TS error if your Apple types don’t include releaseDate
    const release_date: string | null =
      (item as any).releaseDate ?? null;

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
      });

    if (error) {
      console.error('addToListenList insert error', error);
      return { ok: false, message: error.message ?? 'Insert failed' };
    }
    return { ok: true };
  } catch (e: any) {
    console.error('addToListenList exception', e);
    return { ok: false, message: e?.message ?? 'Unknown error' };
  }
}

/** Fetch current user's listen list (newest first) */
export async function fetchListenList(): Promise<ListenRow[]> {
  const { data, error } = await supabase
    .from('listen_list')
    .select(
      `
      id,
      item_type,
      provider,
      provider_id,
      title,
      artist_name,
      artwork_url,
      release_date,
      done_at,
      created_at
      `
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('fetchListenList error', error);
    return [];
  }
  return (data ?? []) as ListenRow[];
}

/** Toggle mark done / undone */
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

/** Remove an item from the listen list */
export async function removeListen(id: string): Promise<boolean> {
  const { error } = await supabase.from('listen_list').delete().eq('id', id);
  if (error) {
    console.error('removeListen error', error);
    return false;
  }
  return true;
}
