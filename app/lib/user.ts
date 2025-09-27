// app/lib/user.ts
import { supabase } from './supabaseClient';

export type Profile = {
  user_id: string;
  default_player: 'apple' | 'spotify';
  created_at: string;
  updated_at: string;
};

export async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Get (or create) your profile row; returns 'apple' by default if missing. */
export async function getDefaultPlayer(): Promise<'apple' | 'spotify'> {
  const uid = await getSessionUserId();
  if (!uid) return 'apple';

  const { data, error } = await supabase
    .from('profiles')
    .select('default_player')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) {
    console.warn('getDefaultPlayer error', error);
    return 'apple';
  }
  if (!data) {
    // create default row
    const { error: insErr } = await supabase
      .from('profiles')
      .insert({ user_id: uid, default_player: 'apple' });
    if (insErr) console.warn('profiles insert default error', insErr);
    return 'apple';
  }
  return (data.default_player as 'apple' | 'spotify') ?? 'apple';
}

/** Set your default player preference. */
export async function setDefaultPlayer(p: 'apple' | 'spotify'): Promise<boolean> {
  const uid = await getSessionUserId();
  if (!uid) return false;

  // upsert-like: try update, if no row, insert.
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: uid, default_player: p });

  if (error) {
    console.warn('setDefaultPlayer error', error);
    return false;
  }
  return true;
}
