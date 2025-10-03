// app/lib/user.ts
import { getDefaultPlayer as getDefaultPlayerPref } from './listen';
import { supabase } from './supabase';

export type Profile = {
  user_id: string;
  default_player: 'apple' | 'spotify';
  created_at: string;
  updated_at: string;
};

export async function getSessionUserId(): Promise<string | null> {
  const { data }: { data: any } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Get (or create) your profile row; returns 'apple' by default if missing. */
export const getDefaultPlayer = getDefaultPlayerPref;

/** Set your default player preference. */
export async function setDefaultPlayer(p: 'apple' | 'spotify'): Promise<boolean> {
  const uid = await getSessionUserId();
  if (!uid) return false;

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: uid, default_player: p });

  if (error) {
    console.warn('setDefaultPlayer error', error);
    return false;
  }
  return true;
}
