// app/lib/queries.ts
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple' | 'spotify';
  provider_id: string; // Apple trackId or collectionId
  title: string;
  artist_name: string;
  artwork_url: string | null;
  release_date: string | null;
  done_at: string | null;
  created_at: string;
};

export type DefaultPlayer = 'apple' | 'spotify';

/* ---------- Preferences ---------- */
export async function getDefaultPlayer(): Promise<DefaultPlayer> {
  const { data, error } = await supabase
    .from('user_prefs')
    .select('default_player')
    .maybeSingle();

  if (error) {
    console.warn('getDefaultPlayer error', error);
    return 'apple';
  }
  return (data?.default_player as DefaultPlayer) ?? 'apple';
}

export async function setDefaultPlayer(
  player: DefaultPlayer
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase
    .from('user_prefs')
    .upsert(
      {
        default_player: player,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/* ---------- Listen list ---------- */
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

export async function markDone(id: string, done: boolean) {
  const { error } = await supabase
    .from('listen_list')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', id);

  return { ok: !error, message: error?.message };
}

export async function removeListen(id: string) {
  const { error } = await supabase.from('listen_list').delete().eq('id', id);
  return { ok: !error, message: error?.message };
}

/* ---------- Open helpers ---------- */

/** Apple Music deep links (best-effort). */
function appleDeepLink(row: ListenRow, storefront = 'us') {
  // If we only have the trackId, this generic pattern usually redirects to the song.
  if (row.item_type === 'track') {
    // Example: https://music.apple.com/us/album/?i=1440833139
    return `https://music.apple.com/${storefront}/album/?i=${row.provider_id}`;
  }
  // Album case: https://music.apple.com/us/album/{albumId}
  return `https://music.apple.com/${storefront}/album/${row.provider_id}`;
}

/** Fallback search links */
function appleSearchUrl(query: { title: string; artist: string }) {
  const q = encodeURIComponent(`${query.title} ${query.artist}`);
  return `https://music.apple.com/search?term=${q}`;
}
function spotifySearchUrl(query: { title: string; artist: string }) {
  const q = encodeURIComponent(`${query.title} ${query.artist}`);
  return `https://open.spotify.com/search/${q}`;
}

/** Open a row with a specified player; returns success boolean. */
export async function openRowWith(
  row: ListenRow,
  player: DefaultPlayer
): Promise<boolean> {
  let url: string;

  if (player === 'apple') {
    // Try deep link first
    const deep = appleDeepLink(row);
    if (await Linking.canOpenURL(deep)) {
      await Linking.openURL(deep);
      return true;
    }
    // Fallback to search
    url = appleSearchUrl({ title: row.title, artist: row.artist_name });
  } else {
    // Spotify: search until we store a spotify_id
    url = spotifySearchUrl({ title: row.title, artist: row.artist_name });
  }

  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;
  await Linking.openURL(url);
  return true;
}
