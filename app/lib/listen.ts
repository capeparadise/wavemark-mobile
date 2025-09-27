// app/lib/listen.ts
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';

export type ListenRow = {
  id: string;
  item_type: 'track' | 'album';
  provider: 'apple' | 'spotify';
  provider_id: string;      // Apple: trackId for tracks, collectionId for albums
  title: string;
  artist_name: string;
  artwork_url: string | null;
  release_date: string | null;
  done_at: string | null;
  created_at: string;
};

// Apple “types” we use when adding to the list
export type AppleTrack = {
  kind: 'song';
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100?: string;
  releaseDate?: string;
};

export type AppleAlbum = {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  releaseDate?: string;
};

/* ---------------- Insert ---------------- */

export async function addToListenList(
  itemType: 'track' | 'album',
  item: AppleTrack | AppleAlbum
): Promise<{ ok: boolean; message?: string }> {
  try {
    const isTrack = itemType === 'track';

    const provider_id = String(
      isTrack ? (item as AppleTrack).trackId : (item as AppleAlbum).collectionId
    );

    const title = isTrack
      ? (item as AppleTrack).trackName
      : (item as AppleAlbum).collectionName;

    const artist_name = (item as AppleTrack | AppleAlbum).artistName;

    const artwork_url =
      (item as any).artworkUrl ?? (item as any).artworkUrl100 ?? null;

    const release_date =
      (item as AppleTrack).releaseDate ??
      (item as AppleAlbum).releaseDate ??
      null;

    const { error } = await supabase.from('listen_list').insert([
      {
        item_type: itemType,
        provider: 'apple',
        provider_id,
        title,
        artist_name,
        artwork_url,
        release_date,
      },
    ]);

    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'Unknown error' };
  }
}

/* ---------------- Fetch / Update / Remove ---------------- */

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

/* ---------------- Deep-link helpers ---------------- */

async function appleDeepLinkForTrack(trackId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&entity=song`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { resultCount: number; results: any[] };
    if (!json?.results?.length) return null;

    const song =
      json.results.find(
        (r) => String(r.trackId) === String(trackId) && r.trackViewUrl
      ) ?? json.results.find((r) => r.trackViewUrl);

    return song?.trackViewUrl ?? null;
  } catch {
    return null;
  }
}

async function appleDeepLinkForAlbum(collectionId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(
        collectionId
      )}&entity=album`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { resultCount: number; results: any[] };
    if (!json?.results?.length) return null;

    const album =
      json.results.find((r) => r.collectionViewUrl) ?? json.results[0];

    return album?.collectionViewUrl ?? null;
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

export type DefaultPlayer = 'apple' | 'spotify';

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
    url = spotifySearchUrl(row.title, row.artist_name); // search until we store spotify URLs/ids
  }

  if (!url) return false;
  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;
  await Linking.openURL(url);
  return true;
}

/* ---- Back-compat exports so other files can import these names ---- */
export async function openInAppleMusic(row: ListenRow) {
  return openRowWith(row, 'apple');
}
export async function openInSpotify(row: ListenRow) {
  return openRowWith(row, 'spotify');
}
