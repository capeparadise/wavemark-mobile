import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUniqueListenedCount } from './listen';
import { supabase } from './supabase';

export type ListenSummary = {
  id: string;
  title: string;
  artist_name: string | null;
  item_type: 'album' | 'track' | 'single';
  artwork_url?: string | null;
  done_at: string | null;
  rating?: number | null;
  rated_at?: string | null;
  spotify_url?: string | null;
  apple_url?: string | null;
};

export type ProfileSnapshot = {
  uniqueCount: number;
  weekCount: number;
  monthCount: number;
  streak: number;
  ratingsCount: number;
  listened: ListenSummary[];
  ratings: ListenSummary[];
  topRated: ListenSummary[];
};

const CACHE_KEY = 'profile_snapshot_v1';

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sunday
  const diff = (day === 0 ? -6 : 1 - day); // Monday as start
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function startOfNDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0,0,0,0);
  return d;
}

function computeStreak(listened: ListenSummary[]): number {
  const days = Array.from(new Set(
    listened
      .filter(r => !!r.done_at)
      .map(r => new Date(r.done_at as string).toISOString().slice(0,10))
  )).sort((a,b) => (a > b ? -1 : 1));
  if (!days.length) return 0;
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0,0,0,0);
  for (const dayStr of days) {
    const day = new Date(dayStr + 'T00:00:00Z');
    const diff = Math.floor((cursor.getTime() - day.getTime()) / (24*60*60*1000));
    if (diff === 0) {
      streak += 1;
    } else if (diff === 1) {
      streak += 1;
    } else {
      break;
    }
    cursor = day;
  }
  return streak;
}

export async function loadCachedProfileSnapshot(): Promise<ProfileSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ProfileSnapshot;
  } catch {
    return null;
  }
}

export async function fetchProfileSnapshot(): Promise<ProfileSnapshot> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { uniqueCount: 0, weekCount: 0, monthCount: 0, streak: 0, ratingsCount: 0, listened: [], ratings: [], topRated: [] };

  const [uniqueCount, listenedRes, ratingsRes, topRes] = await Promise.all([
    getUniqueListenedCount(),
    supabase
      .from('listen_list')
      .select('id,title,artist_name,item_type,artwork_url,done_at,spotify_url,apple_url')
      .eq('user_id', user.id)
      .not('done_at', 'is', null)
      .order('done_at', { ascending: false, nullsFirst: false })
      .limit(400),
    supabase
      .from('listen_list')
      .select('id,title,artist_name,item_type,artwork_url,done_at,rating,rated_at,spotify_url,apple_url')
      .eq('user_id', user.id)
      .not('rating', 'is', null)
      .not('done_at', 'is', null)
      .order('rated_at', { ascending: false, nullsFirst: false })
      .order('done_at', { ascending: false, nullsFirst: false })
      .limit(400),
    supabase
      .from('listen_list')
      .select('id,title,artist_name,item_type,artwork_url,done_at,rating,rated_at,spotify_url,apple_url')
      .eq('user_id', user.id)
      .not('rating', 'is', null)
      .not('done_at', 'is', null)
      .order('rating', { ascending: false, nullsFirst: false })
      .order('rated_at', { ascending: false, nullsFirst: true })
      .order('done_at', { ascending: false, nullsFirst: true })
      .limit(10),
  ]);

  const listened = (listenedRes.data as ListenSummary[] | null) ?? [];
  const ratings = (ratingsRes.data as ListenSummary[] | null) ?? [];
  const topRated = (topRes.data as ListenSummary[] | null) ?? [];

  const weekStart = startOfWeek(new Date());
  const monthStart = startOfNDaysAgo(30);
  const weekCount = listened.filter(r => r.done_at && new Date(r.done_at) >= weekStart).length;
  const monthCount = listened.filter(r => r.done_at && new Date(r.done_at) >= monthStart).length;
  const streak = computeStreak(listened);
  const ratingsCount = ratings.length;

  const snapshot: ProfileSnapshot = {
    uniqueCount,
    weekCount,
    monthCount,
    streak,
    ratingsCount,
    listened,
    ratings,
    topRated,
  };

  try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)); } catch {}

  return snapshot;
}
