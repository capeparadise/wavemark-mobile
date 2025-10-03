import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { supabase } from './supabase';

export type ListenPlayer = 'apple' | 'spotify';

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: ListenPlayer; // source provider saved at insert time
  provider_id: string | null;

  title: string;
  artist_name: string | null;
  release_date?: string | null;

  apple_url: string | null;
  apple_id: string | null;

  spotify_url: string | null;
  spotify_id: string | null;

  done_at: string | null; // ISO string or null
};

export type AppleTrack = {
  trackId: number;
  trackName: string;
  artistName: string;
  trackViewUrl?: string;
  artworkUrl?: string;
  artworkUrl100?: string;
};

export type AppleAlbum = {
  collectionId: number;
  collectionName: string;
  artistName: string;
  collectionViewUrl?: string;
  artworkUrl?: string;
  artworkUrl100?: string;
};

const DEFAULT_PLAYER_KEY = 'default_player';

export async function getDefaultPlayer(): Promise<ListenPlayer> {
  try {
    const v = await AsyncStorage.getItem(DEFAULT_PLAYER_KEY);
    if (v === 'apple' || v === 'spotify') return v;
  } catch {}
  return 'apple';
}

export async function setDefaultPlayer(p: ListenPlayer) {
  await AsyncStorage.setItem(DEFAULT_PLAYER_KEY, p);
}

export async function addToListenList(
  type: 'track' | 'album',
  item: AppleTrack | AppleAlbum
): Promise<{ ok: true; row: ListenRow } | { ok: false; message: string }> {
  // Ensure we have the signed-in user for RLS (user_id = auth.uid())
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, message: userErr.message };
  if (!user) return { ok: false, message: 'Not signed in' };

  const appleUrl =
    type === 'track'
      ? (item as any).trackViewUrl ?? null
      : (item as any).collectionViewUrl ?? null;

  const appleId =
    type === 'track'
      ? (item as any).trackId != null
        ? String((item as any).trackId)
        : null
      : (item as any).collectionId != null
        ? String((item as any).collectionId)
        : null;

  const title =
    type === 'track'
      ? (item as any).trackName ?? ''
      : (item as any).collectionName ?? '';

  const artist = (item as any).artistName ?? null;

  const insertPayload = {
    // IMPORTANT for RLS:
    user_id: user.id, // must equal auth.uid() under your policy
    item_type: type,
    provider: 'apple' as const,
    provider_id: appleId,
    title,
    artist_name: artist,
    apple_url: appleUrl,
    apple_id: appleId,
    // spotify_url/spotify_id remain null unless enriched later
  };

  const { data, error } = await supabase
    .from('listen_list')
    .insert(insertPayload)
    .select()
    .single();

  if (error) return { ok: false, message: error.message };
  return { ok: true, row: data as ListenRow };
}

export async function fetchListenList(): Promise<ListenRow[]> {
  const { data, error } = await supabase
    .from('listen_list')
    .select(
      'id,item_type,provider,provider_id,title,artist_name,apple_url,apple_id,spotify_url,spotify_id,done_at'
    )
    .order('done_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: false });

  if (error || !data) return [];
  return data as ListenRow[];
}

export async function markDone(
  id: string,
  makeDone: boolean
): Promise<{ ok: boolean; message?: string }> {
  const patch = { done_at: makeDone ? new Date().toISOString() : null };

  const { error } = await supabase
    .from('listen_list')
    .update(patch)
    .eq('id', id);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function removeListen(
  id: string
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('listen_list').delete().eq('id', id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

function buildAppleSearchUrl(title: string, artist?: string | null) {
  const q = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  return `https://music.apple.com/us/search?term=${q}`;
}

function buildSpotifySearchUrl(title: string, artist?: string | null) {
  const q = encodeURIComponent([title, artist].filter(Boolean).join(' '));
  return `https://open.spotify.com/search/${q}`;
}

async function tryOpen(url: string | null | undefined) {
  if (!url) return false;
  try {
    const can = await Linking.canOpenURL(url);
    if (!can) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function tryApple(item: ListenRow) {
  if (await tryOpen(item.apple_url)) return true;
  return await tryOpen(buildAppleSearchUrl(item.title, item.artist_name));
}

async function trySpotify(item: ListenRow) {
  if (await tryOpen(item.spotify_url)) return true;
  if (item.spotify_id) {
    const path = item.item_type === 'track' ? 'track' : 'album';
    if (await tryOpen(`https://open.spotify.com/${path}/${item.spotify_id}`)) {
      return true;
    }
  }
  return await tryOpen(buildSpotifySearchUrl(item.title, item.artist_name));
}

export async function openByDefaultPlayer(item: ListenRow): Promise<boolean> {
  const preferred = await getDefaultPlayer();

  if (preferred === 'apple') {
    if (await tryApple(item)) return true;
    if (await trySpotify(item)) return true;
    return false;
  } else {
    if (await trySpotify(item)) return true;
    if (await tryApple(item)) return true;
    return false;
  }
}

// Compatibility wrappers for older callers expecting these names
export async function openInAppleMusic(item: ListenRow): Promise<boolean> {
  return await tryApple(item);
}

export async function openInSpotify(item: ListenRow): Promise<boolean> {
  return await trySpotify(item);
}
