import AsyncStorage from '@react-native-async-storage/async-storage';
import { emit } from './events';

export const ALL_GENRES = [
  'rap','rnb','pop','rock','latin','edm','country','kpop','afrobeats','jazz',
  'dancehall','reggae','indie','metal','punk','folk','blues','classical','soundtrack','ambient','jpop','desi'
];

export const DEFAULT_GENRES = ['rap','rnb','pop','rock','latin','edm','country','kpop','afrobeats','jazz'];

const STORAGE_KEY = 'preferredGenres';

export async function getPreferredGenres(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GENRES.slice();
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return DEFAULT_GENRES.slice();
    // sanitize to known values and preserve order using ALL_GENRES as canonical order
    const set = new Set<string>(list.map((s) => String(s).toLowerCase()));
    const out = ALL_GENRES.filter((g) => set.has(g));
    return out.length ? out : DEFAULT_GENRES.slice();
  } catch {
    return DEFAULT_GENRES.slice();
  }
}

export async function setPreferredGenres(genres: string[]): Promise<void> {
  const clean = genres
    .map((s) => String(s).toLowerCase())
    .filter((g) => ALL_GENRES.includes(g));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(new Set(clean))));
  try { emit('genres:changed', clean); } catch {}
}

export function formatGenreTitle(key: string): string {
  switch (key) {
    case 'rnb': return 'R&B';
    case 'kpop': return 'K-Pop';
    case 'jpop': return 'J-Pop';
    default:
      return key.charAt(0).toUpperCase() + key.slice(1);
  }
}
