// app/lib/queries.ts
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple' | 'spotify';
  provider_id: string; // Apple: trackId (for tracks) or collectionId (for albums)
  title: string;
  artist_name: string;
  artwork_url: string | null;
  release_date: string | null;
  done_at: string | null;
  created_at: string;
};

export type DefaultPlayer = 'apple' | 'spotify';

/* ---------------- Preferences ---------------- */

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

/* ---------------- Listen list ---------------- */

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

/* ---------------- Open helpers ---------------- */

// Best guess storefront. (We can store a real one in user_prefs later.)
const APPLE_STOREFRONT = 'us';

/** Quick lookup to fetch the collectionId (album id) for a given Apple trackId. */
async function lookupAppleCollectionId(trackId: string): Promise<string | null> {
  try {
    // iTunes Search API (public)
    const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&entity=song`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { resultCount: number; results: any[] };
    if (!json?.results?.length) return null;

    // The first result should be the track; it contains collectionId (album id)
    const track = json.results.find((r) => r.trackId == trackId) ?? json.results[0];
    const collectionId = track?.collectionId ? String(track.collectionId) : null;
    return collectionId;
  } catch {
    return null;
  }
}

function appleAlbumUrl(albumId: string, trackId?: string) {
  // Track deep-link requires ?i=<trackId>
  if (trackId) {
    return `https://music.apple.com/${APPLE_STOREFRONT}/album/${albumId}?i=${trackId}`;
  }
  return `https://music.apple.com/${APPLE_STOREFRONT}/album/${albumId}`;
}

function appleSearchUrl(title: string, artist: string) {
  const q = encodeURIComponent(`${title} ${artist}`);
  return `https://music.apple.com/search?term=${q}`;
}

function spotifySearchUrl(title: string, artist: string) {
  const q = encodeURIComponent(`${title} ${artist}`);
  return `https://open.spotify.com/search/${q}`;
}

/** Open a row with a specified player; returns success boolean. */
export async function openRowWith(
  row: ListenRow,
  player: DefaultPlayer
): Promise<boolean> {
  let url: string | null = null;

  if (player === 'apple') {
    if (row.item_type === 'track') {
      // We only saved trackId — fetch its album (collectionId), then deep-link
      const collectionId = await lookupAppleCollectionId(row.provider_id);
      if (collectionId) {
        url = appleAlbumUrl(collectionId, row.provider_id);
      } else {
        // Fallback to search if we couldn't fetch the album
        url = appleSearchUrl(row.title, row.artist_name);
      }
    } else {
      // Album: provider_id already is the collectionId
      url = appleAlbumUrl(row.provider_id);
    }
  } else {
    // Spotify: until we store spotify IDs, use search
    url = spotifySearchUrl(row.title, row.artist_name);
  }

  if (!url) return false;

  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;

  await Linking.openURL(url);
  return true;
}
