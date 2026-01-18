import { Linking } from 'react-native';
import { supabase } from './supabase';

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple' | 'spotify';
  provider_id: string; // Apple: trackId (track) or collectionId (album)
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
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from('listen_list')
    .select('id,item_type,provider,provider_id,title,artist_name,artwork_url,release_date,apple_url,apple_id,spotify_url,spotify_id,rating,review,rated_at,done_at,upcoming,created_at')
    .eq('user_id', user.id)
    .is('done_at', null)
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

async function appleDeepLinkForTrack(trackId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&entity=song`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { resultCount: number; results: any[] };
    if (!json?.results?.length) return null;

    const song =
      json.results.find((r) => String(r.trackId) === String(trackId) && r.trackViewUrl) ??
      json.results.find((r) => r.trackViewUrl);

    const url: string | undefined = song?.trackViewUrl;
    return url ?? null;
  } catch {
    return null;
  }
}

async function appleDeepLinkForAlbum(collectionId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(collectionId)}&entity=album`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { resultCount: number; results: any[] };
    if (!json?.results?.length) return null;

    const album = json.results.find((r) => r.collectionViewUrl) ?? json.results[0];
    const url: string | undefined = album?.collectionViewUrl;
    return url ?? null;
  } catch {
    return null;
  }
}

function appleSearchUrl(title: string, artist: string) {
  const q = encodeURIComponent(`${title} ${artist}`);
  return `https://music.apple.com/search?term=${q}`;
}

function spotifySearchUrl(title: string, artist: string) {
  const q = encodeURIComponent(`${title} ${artist}`);
  return `https://open.spotify.com/search/${q}`;
}

export async function openRowWith(
  row: ListenRow,
  player: DefaultPlayer
): Promise<boolean> {
  let url: string | null = null;

  if (player === 'apple') {
    if (row.item_type === 'track') {
      url = await appleDeepLinkForTrack(row.provider_id);
      if (!url) url = appleSearchUrl(row.title, row.artist_name);
    } else {
      url = await appleDeepLinkForAlbum(row.provider_id);
      if (!url) url = appleSearchUrl(row.title, row.artist_name);
    }
  } else {
    url = spotifySearchUrl(row.title, row.artist_name);
  }

  if (!url) return false;

  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;

  await Linking.openURL(url);
  return true;
}
