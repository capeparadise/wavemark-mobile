// app/lib/listen.ts
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';

// Keep this in sync with your table columns
export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple';
  provider_id: string;        // Apple ID (trackId / collectionId as string)
  title: string;
  artist_name: string;
  artwork_url: string | null;
  release_date: string | null; // ISO or null
  done_at: string | null;      // when the user marked it “done”
  created_at: string;          // server default
};

/**
 * Add a new item into listen_list.
 * You already call this from the Artist screen — keeping here for completeness.
 */
export async function addToListenList(itemType: 'track'|'album', item: {
  provider_id: string;
  title: string;
  artist_name: string;
  artwork_url?: string | null;
  release_date?: string | null;
}) {
  const { error } = await supabase
    .from('listen_list')
    .insert({
      item_type: itemType,
      provider: 'apple',
      provider_id: item.provider_id,
      title: item.title,
      artist_name: item.artist_name,
      artwork_url: item.artwork_url ?? null,
      release_date: item.release_date ?? null,
    });

  if (error) {
    console.error('addToListenList error', error);
    return { ok: false as const, message: error.message ?? 'Failed to add' };
  }
  return { ok: true as const };
}

/** Fetch current user’s list (latest first). */
export async function fetchListenList(): Promise<ListenRow[]> {
  const { data, error } = await supabase
    .from('listen_list')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('fetchListenList error', error);
    return [];
  }
  return (data ?? []) as ListenRow[];
}

/** Toggle done_at (pass newDone=true to set now; false to clear) */
export async function markDone(id: string, newDone: boolean) {
  const { error } = await supabase
    .from('listen_list')
    .update({ done_at: newDone ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) {
    console.error('markDone error', error);
    return false;
  }
  return true;
}

/** Remove row */
export async function removeListen(id: string) {
  const { error } = await supabase
    .from('listen_list')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('removeListen error', error);
    return false;
  }
  return true;
}

/* ---------- Open-in-Spotify / Apple helpers ---------- */

/** Safe query like "Title – Artist Name" */
export function buildSearchQuery(row: Pick<ListenRow, 'title' | 'artist_name'>) {
  const q = `${row.title} ${row.artist_name}`.trim();
  // encode for URL fragments
  return encodeURIComponent(q);
}

/** Try to open Spotify app search; fallback to web */
export async function openInSpotify(row: Pick<ListenRow, 'title' | 'artist_name'>) {
  const encoded = buildSearchQuery(row);
  const appUrl = `spotify:search:${decodeURIComponent(encoded)}`; // spotify:search expects unencoded text
  const webUrl = `https://open.spotify.com/search/${encoded}`;

  try {
    const supported = await Linking.canOpenURL('spotify:');
    if (supported) {
      await Linking.openURL(appUrl);
      return true;
    }
  } catch (_) {
    // ignore and try web
  }
  await Linking.openURL(webUrl);
  return true;
}

/** Try to open Apple Music app search; fallback to web */
export async function openInAppleMusic(row: Pick<ListenRow, 'title' | 'artist_name'>) {
  const encoded = buildSearchQuery(row);
  // Apple Music deep link search on iOS
  const appUrl = `music://search?term=${encoded}`;
  const webUrl = `https://music.apple.com/us/search?term=${encoded}`;

  try {
    const supported = await Linking.canOpenURL('music://');
    if (supported) {
      await Linking.openURL(appUrl);
      return true;
    }
  } catch (_) {
    // ignore and try web
  }
  await Linking.openURL(webUrl);
  return true;
}
