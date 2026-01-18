import type { ListenSummary, ProfileSnapshot } from './stats';

export type Achievement = {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
};

export function computeAchievements(snapshot: ProfileSnapshot): Achievement[] {
  const { uniqueCount, ratingsCount, streak, ratings, listened } = snapshot;
  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const ratingsThisMonth = ratings.filter(r => r.rated_at && Date.parse(r.rated_at) >= monthAgo).length;
  const hasTen = ratings.some(r => (r.rating ?? 0) >= 10);
  const listens30 = listened.filter(r => r.done_at && Date.parse(r.done_at) >= monthAgo).length;

  const defs: Achievement[] = [
    { id: 'first-listen', title: 'First Listen', description: 'Complete your first listen', unlocked: uniqueCount >= 1 },
    { id: '10-listens', title: '10 Listens', description: 'Reach 10 unique listens', unlocked: uniqueCount >= 10 },
    { id: '50-listens', title: '50 Listens', description: 'Reach 50 unique listens', unlocked: uniqueCount >= 50 },
    { id: '100-listens', title: '100 Listens', description: 'Reach 100 unique listens', unlocked: uniqueCount >= 100 },
    { id: 'first-rating', title: 'First Rating', description: 'Rate your first item', unlocked: ratingsCount >= 1 },
    { id: '10-ratings', title: '10 Ratings', description: 'Rate 10 items', unlocked: ratingsCount >= 10 },
    { id: '5-day-streak', title: '5-Day Streak', description: 'Listen on 5 days in a row', unlocked: streak >= 5 },
    { id: '10-this-month', title: '10 Ratings This Month', description: 'Rate 10 items this month', unlocked: ratingsThisMonth >= 10 },
    { id: 'perfect-10', title: 'Top Rated', description: 'Give a 10/10 rating', unlocked: hasTen },
    { id: 'habit', title: "Listener's Habit", description: '20 listens in 30 days', unlocked: listens30 >= 20 },
  ];
  return defs;
}
