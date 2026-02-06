import { emit } from './events';
import { FN_BASE } from './fnBase';
import { supabase } from './supabase';

export async function isFollowing(artistId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('followed_artists')
    .select('artist_id').eq('user_id', user.id).eq('artist_id', artistId).limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export async function followArtist(input: { artistId: string; artistName: string; spotifyUrl?: string | null; }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };
  const { error } = await supabase.from('followed_artists').upsert({
    user_id: user.id,
    artist_id: input.artistId,
    artist_name: input.artistName,
    spotify_url: input.spotifyUrl ?? null
  });
  if (error) return { ok: false, message: error.message };
  // Fire-and-forget: trigger a feed refresh for this artist on the server
  try { fetch(`${FN_BASE}/check-new-releases?` + new URLSearchParams({ artistId: input.artistId })).catch(() => {}); } catch {}
  // Notify UI to refresh feed
  emit('feed:refresh');
  return { ok: true };
}

export async function unfollowArtist(artistId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in' };
  const { error } = await supabase
    .from('followed_artists')
    .delete()
    .eq('user_id', user.id)
    .eq('artist_id', artistId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export type FeedItem = {
  id: string;
  artist_id: string;
  artist_name: string | null;
  title: string;
  release_date: string | null;
  spotify_url: string | null;
  apple_url?: string | null;
  created_at: string;
  image_url?: string | null;
  artwork_url?: string | null;
  release_type?: 'album' | 'single' | 'compilation' | null; // legacy feed field
  item_type?: 'album' | 'single' | null; // normalized type for listen_list
  provider_id?: string | null;
  spotify_id?: string | null;
  apple_id?: string | null;
  external_id?: string | null;
};

function normalizeFeedItem(row: any): FeedItem | null {
  if (!row || typeof row !== 'object') return null;
  const artistId = row.artist_id as string | undefined;
  const title = row.title as string | undefined;
  const id =
    row.id ??
    row.provider_id ??
    row.spotify_id ??
    row.apple_id ??
    row.external_id ??
    row.spotify_url ??
    row.apple_url ??
    (artistId && title ? `${artistId}__${title}` : null);
  if (!id) return null;
  return {
    ...(row as any),
    id: String(id),
  } as FeedItem;
}

export async function fetchFeed(): Promise<FeedItem[]> {
  const { data, error } = await supabase
    .from('new_release_feed')
    .select('*')
    .order('release_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return [];
  return (Array.isArray(data) ? data : []).map(normalizeFeedItem).filter(Boolean) as FeedItem[];
}

export async function fetchFeedForArtists(input: { artistIds: string[]; limit?: number }): Promise<FeedItem[]> {
  const artistIds = Array.from(new Set((input.artistIds || []).filter(Boolean)));
  if (!artistIds.length) return [];
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.max(1, Math.min(500, input.limit)) : 200;
  const { data, error } = await supabase
    .from('new_release_feed')
    .select('*')
    .in('artist_id', artistIds)
    .order('release_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (Array.isArray(data) ? data : []).map(normalizeFeedItem).filter(Boolean) as FeedItem[];
}

export type FollowedArtist = { id: string; name: string };
export async function listFollowedArtists(): Promise<FollowedArtist[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('followed_artists')
    .select('artist_id, artist_name')
    .eq('user_id', user.id);
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).map((r) => ({ id: r.artist_id as string, name: (r.artist_name as string) || '' }));
}
