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
  created_at: string;
  image_url?: string | null;
  release_type?: 'album' | 'single' | 'compilation' | null;
};
export async function fetchFeed(): Promise<FeedItem[]> {
  const { data, error } = await supabase
    .from('new_release_feed')
    .select('*')
    .order('release_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return [];
  return data as FeedItem[];
}
