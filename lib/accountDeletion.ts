import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

type DeleteAccountResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  code?: string;
  appleRevocation?: {
    status: 'not_applicable' | 'revoked' | 'required' | 'not_configured' | 'failed';
  };
};

const REQUEST_TIMEOUT_MS = 45_000;

function userStorageKeys(userId: string) {
  return [
    `adv_ratings:${userId}`,
    `listen_cache_v1_${userId}`,
    `listen_upcoming_cache_v1_${userId}`,
    `history_cache_v1_${userId}`,
    `pending_cache_v1_${userId}`,
    `ratings_cache_v1_${userId}`,
    `top_rated_cache_v1_${userId}`,
    `wavemark:feed-mode:${userId}`,
    `wavemark:first-login-seen:${userId}`,
  ];
}

const ACCOUNT_LOCAL_KEYS = [
  'default_player',
  'profile_snapshot_v1',
  'preferredGenres',
  'tune_hidden_styles_v1',
  'tune_include_genres_v1',
  'pickedCacheV1',
  'discover_for_you_v1',
  'discover_for_you_updates_v1',
  'wavemark:post-auth-redirect',
];

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Delete account timed out. Please try again.')), ms);
  });
}

export async function clearAccountLocalData(userId: string) {
  const keys = [...ACCOUNT_LOCAL_KEYS, ...userStorageKeys(userId)];
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {}
}

export async function deleteAccount(input?: { appleAuthorizationCode?: string | null }) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (!userId) return { ok: false, message: 'You need to sign in again before deleting your account.' };

  try {
    const invoke = supabase.functions.invoke<DeleteAccountResponse>('delete-account', {
      body: {
        appleAuthorizationCode: input?.appleAuthorizationCode ?? null,
      },
    });
    const { data, error } = await Promise.race([invoke, timeoutAfter(REQUEST_TIMEOUT_MS)]);

    if (error) {
      const context = (error as any)?.context;
      let body = context?.json ?? context?.data ?? null;
      if (!body && typeof context?.clone === 'function') {
        try {
          body = await context.clone().json();
        } catch {}
      }
      const message = body?.message || body?.error || error.message;
      return { ok: false, code: body?.code, message: message || 'Could not delete account.' };
    }

    if (!data?.ok) {
      return { ok: false, code: data?.code, message: data?.message || data?.error || 'Could not delete account.' };
    }

    await clearAccountLocalData(userId);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => supabase.auth.signOut());
    return { ok: true, appleRevocation: data.appleRevocation };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not delete account.' };
  }
}
