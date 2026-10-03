import type { ListenSummary } from './stats';
import { supabase } from './supabase';

export function weeklyWindow(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function rankWeeklySongs(rows: ListenSummary[], now = new Date()): ListenSummary[] {
  const { start, end } = weeklyWindow(now);
  const sorted = rows.filter(row => {
    const logged = Date.parse(row.done_at || '');
    return (row.item_type === 'track' || row.item_type === 'single') &&
      typeof row.rating === 'number' && Number.isFinite(row.rating) && row.rating >= 1 && row.rating <= 10 &&
      logged >= +start && logged < +end && logged <= +now;
  }).sort((a, b) => (b.rating! - a.rating!) ||
    (Date.parse(b.done_at!) - Date.parse(a.done_at!)) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  return sorted.filter(row => {
    const key = row.spotify_id ? `spotify:${row.spotify_id}` : row.apple_id ? `apple:${row.apple_id}` :
      row.provider && row.provider_id ? `${row.provider}:${row.provider_id}` : `row:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

export async function fetchWeeklyTopFive(userId: string, now = new Date()): Promise<ListenSummary[]> {
  const { start } = weeklyWindow(now);
  const rows: ListenSummary[] = [];
  // Page the eligible week, rather than deriving a chart from the truncated history preview.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('listen_list')
      .select('id,title,artist_name,item_type,artwork_url,done_at,rating,rating_details,rated_at,provider,provider_id,spotify_id,apple_id,spotify_url,apple_url')
      .eq('user_id', userId).in('item_type', ['track', 'single'])
      .gte('done_at', start.toISOString()).lte('done_at', now.toISOString())
      .gte('rating', 1).lte('rating', 10)
      .order('id', { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    const page = (data || []) as ListenSummary[];
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rankWeeklySongs(rows, now);
}
