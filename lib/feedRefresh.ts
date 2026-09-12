import { FN_BASE, SUPABASE_ANON_KEY } from './fnBase';
import { supabase } from './supabase';

// Do not use fetchFn here: it intentionally replaces Authorization with the
// public app key for catalog searches. Feed writes require a real session.
export async function requestArtistFeedRefresh(artistId: string, market: string): Promise<boolean> {
  if (!/^[A-Za-z0-9]{22}$/.test(artistId)) return false;
  try {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) return false;
    const response = await fetch(`${FN_BASE}/check-new-releases?${new URLSearchParams({ artistId, market })}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
