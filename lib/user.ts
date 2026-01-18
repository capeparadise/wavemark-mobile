// app/lib/user.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDefaultPlayer as getDefaultPlayerPref } from './listen';
import { supabase } from './supabase';

export type Profile = {
  user_id: string;
  default_player: 'apple' | 'spotify';
  created_at: string;
  updated_at: string;
  advanced_ratings_enabled?: boolean | null;
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

/* ---------------- Advanced Ratings Preference ---------------- */

const ADV_KEY = (uid: string) => `adv_ratings:${uid}`;

export async function getAdvancedRatingsEnabled(): Promise<boolean> {
  const uid = await getSessionUserId();
  if (!uid) return false;
  // Try profiles table first
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('advanced_ratings_enabled')
      .eq('user_id', uid)
      .maybeSingle();
    if (!error && data && typeof data.advanced_ratings_enabled === 'boolean') {
      return !!data.advanced_ratings_enabled;
    }
  } catch {}
  // Fallback to AsyncStorage per user
  try {
    const raw = await AsyncStorage.getItem(ADV_KEY(uid));
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function setAdvancedRatingsEnabled(enabled: boolean): Promise<boolean> {
  const uid = await getSessionUserId();
  if (!uid) return false;
  // Try to persist in profiles; if column missing, fall back to storage
  try {
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id: uid, advanced_ratings_enabled: enabled }, { onConflict: 'user_id' });
    if (!error) return true;
  } catch {}
  try {
    await AsyncStorage.setItem(ADV_KEY(uid), enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export function useAdvancedRatingsEnabled() {
  const React = require('react');
  const [enabled, setEnabled] = React.useState(false as boolean);
  React.useEffect(() => {
    getAdvancedRatingsEnabled().then(setEnabled).catch(() => setEnabled(false));
  }, []);
  return [enabled, setEnabled] as const;
}
