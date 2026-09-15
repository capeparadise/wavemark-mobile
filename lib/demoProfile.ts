import AsyncStorage from '@react-native-async-storage/async-storage';
import { emit } from './events';
import { supabase } from './supabase';

type DemoSnapshot = {
  version: 1;
  savedAt: string;
  label: string;
  profile: Record<string, any> | null;
  listenList: Record<string, any>[];
  followedArtists: Record<string, any>[];
};

export type DemoSnapshotSummary = {
  label: string;
  savedAt: string;
};

const snapshotKey = (userId: string) => `rppl:demo-profile-snapshot:v1:${userId}`;

const RESET_CACHE_KEYS = [
  'profile_snapshot_v1',
  'listen_cache_v1',
  'listen_upcoming_cache_v1',
  'history_cache_v1',
  'pending_cache_v1',
  'ratings_cache_v1',
  'top_rated_cache_v1',
  'pickedCacheV1',
  'discover_for_you_v1',
  'discover_for_you_updates_v1',
  'discover_your_updates_releases_v2',
  'discover_new_releases_v3',
  'discover_feed_sections_v1',
  'discover_last_successful_refresh_v1',
  'preferredGenres',
  'tune_hidden_styles_v1',
  'tune_include_genres_v1',
];

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You need to sign in again.');
  return user.id;
}

async function clearDemoCaches(userId: string) {
  const allKeys = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  const keys = allKeys.filter((key) => RESET_CACHE_KEYS.some((base) => key === base || key === `${base}_${userId}`));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

async function captureSnapshot(userId: string): Promise<DemoSnapshot> {
  const [profileResult, listenResult, followedResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('listen_list').select('*').eq('user_id', userId),
    supabase.from('followed_artists').select('*').eq('user_id', userId),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (listenResult.error) throw new Error(listenResult.error.message);
  if (followedResult.error) throw new Error(followedResult.error.message);

  const profile = (profileResult.data as Record<string, any> | null) ?? null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    label: String(profile?.display_name || profile?.username || 'Previous demo profile'),
    profile,
    listenList: (listenResult.data as Record<string, any>[] | null) ?? [],
    followedArtists: (followedResult.data as Record<string, any>[] | null) ?? [],
  };
}

function announceReset() {
  emit('listen:updated');
  emit('listen:refresh');
  emit('feed:refresh');
  emit('follow:changed');
}

export async function getDemoSnapshotSummary(): Promise<DemoSnapshotSummary | null> {
  if (!__DEV__) return null;
  const userId = await currentUserId();
  const raw = await AsyncStorage.getItem(snapshotKey(userId));
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as DemoSnapshot;
    if (snapshot?.version !== 1) return null;
    return { label: snapshot.label, savedAt: snapshot.savedAt };
  } catch {
    return null;
  }
}

export async function resetDemoProfile() {
  if (!__DEV__) throw new Error('Demo tools are only available in development builds.');
  const userId = await currentUserId();
  const snapshot = await captureSnapshot(userId);
  await AsyncStorage.setItem(snapshotKey(userId), JSON.stringify(snapshot));

  const { data, error } = await supabase.rpc('reset_my_demo_profile');
  if (error) throw new Error(error.message || 'Could not reset the demo profile.');

  await clearDemoCaches(userId);
  announceReset();
  return { snapshot: { label: snapshot.label, savedAt: snapshot.savedAt }, counts: data as Record<string, number> | null };
}

export async function restoreDemoProfile() {
  if (!__DEV__) throw new Error('Demo tools are only available in development builds.');
  const userId = await currentUserId();
  const key = snapshotKey(userId);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) throw new Error('There is no saved demo profile to restore.');

  const snapshot = JSON.parse(raw) as DemoSnapshot;
  if (snapshot?.version !== 1) throw new Error('The saved demo profile is not compatible with this build.');

  const { error: resetError } = await supabase.rpc('reset_my_demo_profile');
  if (resetError) throw new Error(resetError.message || 'Could not prepare the demo profile restore.');

  if (snapshot.listenList.length) {
    const rows = snapshot.listenList.map((row) => ({ ...row, user_id: userId }));
    const { error } = await supabase.from('listen_list').insert(rows);
    if (error) throw new Error(`Could not restore listening activity: ${error.message}`);
  }

  if (snapshot.followedArtists.length) {
    const rows = snapshot.followedArtists.map((row) => ({ ...row, user_id: userId }));
    const { error } = await supabase.from('followed_artists').insert(rows);
    if (error) throw new Error(`Could not restore artist follows: ${error.message}`);
  }

  if (snapshot.profile) {
    const allowedProfileFields = [
      'display_name',
      'username',
      'avatar_url',
      'is_private',
      'profile_setup_completed',
      'advanced_ratings_enabled',
      'default_player',
    ];
    const patch = Object.fromEntries(
      allowedProfileFields
        .filter((field) => Object.prototype.hasOwnProperty.call(snapshot.profile, field))
        .map((field) => [field, snapshot.profile?.[field]]),
    );
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw new Error(`Could not restore the listener identity: ${error.message}`);
  }

  await clearDemoCaches(userId);
  await AsyncStorage.removeItem(key);
  announceReset();
  return { label: snapshot.label };
}
