import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchArtistDetails } from './spotifyArtist';

const GENRE_CACHE_KEY = 'genre_cache_v1';
const HIDDEN_KEY = 'tune_hidden_styles_v1';
const GENRE_INCLUDE_KEY = 'tune_include_genres_v1';

export type StyleKey = 'classical' | 'kids' | 'sleep' | 'metal' | 'gospel';

export const STYLE_FILTERS: Record<StyleKey, { label: string; keywords: string[] }> = {
  classical: { label: 'Hide Classical', keywords: ['classical', 'baroque', 'orchestral', 'opera', 'piano'] },
  kids: { label: 'Hide Kids / Family', keywords: ['kids', 'children', 'family'] },
  sleep: { label: 'Hide Meditation / Sleep', keywords: ['sleep', 'meditation', 'ambient', 'relaxation'] },
  metal: { label: 'Hide Metal', keywords: ['metal', 'death', 'black', 'doom'] },
  gospel: { label: 'Hide Gospel', keywords: ['gospel'] },
};

type GenreCacheEntry = { g: string[]; ts: number };
const memCache = new Map<string, GenreCacheEntry>();
let cacheLoaded = false;

async function loadGenreCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(GENRE_CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([id, v]: any) => {
        if (v && Array.isArray(v.g)) {
          memCache.set(id, { g: v.g, ts: typeof v.ts === 'number' ? v.ts : Date.now() });
        }
      });
    }
  } catch {}
}

async function persistGenreCache() {
  try {
    const obj: Record<string, GenreCacheEntry> = {};
    memCache.forEach((v, k) => { obj[k] = v; });
    await AsyncStorage.setItem(GENRE_CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

export async function getArtistGenresCached(artistId?: string | null): Promise<string[]> {
  if (!artistId) return [];
  await loadGenreCache();
  const cached = memCache.get(artistId);
  if (cached && cached.g) return cached.g;
  try {
    const details = await fetchArtistDetails(artistId);
    const genres = Array.isArray(details?.genres) ? details!.genres : [];
    memCache.set(artistId, { g: genres, ts: Date.now() });
    persistGenreCache();
    return genres;
  } catch {
    return [];
  }
}

export async function loadHiddenStyles(): Promise<Set<StyleKey>> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) return new Set(arr.filter((v) => v && STYLE_FILTERS[v as StyleKey]) as StyleKey[]);
  } catch {}
  return new Set();
}

export async function saveHiddenStyles(set: Set<StyleKey>) {
  try {
    await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export type CanonicalGenre =
  | 'hiphop' | 'rnb' | 'pop' | 'rock' | 'indie' | 'electronic' | 'afrobeats' | 'latin'
  | 'country' | 'jazz' | 'classical' | 'metal' | 'gospel' | 'kpop';

const CANONICAL: Record<CanonicalGenre, string[]> = {
  hiphop: ['hip hop', 'hip-hop', 'rap', 'trap'],
  rnb: ['r&b', 'rnb', 'neo-soul', 'soul'],
  pop: ['pop'],
  rock: ['rock', 'punk', 'alt rock', 'hard rock'],
  indie: ['indie'],
  electronic: ['electronic', 'edm', 'house', 'techno', 'dance'],
  afrobeats: ['afrobeats', 'afro', 'afrobeat', 'afro pop'],
  latin: ['latin', 'reggaeton', 'salsa', 'cumbia', 'bachata'],
  country: ['country'],
  jazz: ['jazz'],
  classical: ['classical', 'orchestral', 'opera', 'baroque'],
  metal: ['metal', 'death', 'black', 'doom'],
  gospel: ['gospel'],
  kpop: ['k-pop', 'k pop', 'kpop'],
};

export function mapToCanonicalGenres(genres: string[]): CanonicalGenre[] {
  const out = new Set<CanonicalGenre>();
  const lower = genres.map((g) => g.toLowerCase());
  lower.forEach((g) => {
    (Object.keys(CANONICAL) as CanonicalGenre[]).forEach((key) => {
      if (CANONICAL[key].some((kw) => g.includes(kw))) out.add(key);
    });
  });
  return Array.from(out);
}

export async function loadIncludedGenres(): Promise<Set<CanonicalGenre>> {
  try {
    const raw = await AsyncStorage.getItem(GENRE_INCLUDE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) return new Set(arr.filter((v) => CANONICAL[v as CanonicalGenre]) as CanonicalGenre[]);
  } catch {}
  return new Set();
}

export async function saveIncludedGenres(set: Set<CanonicalGenre>) {
  try {
    await AsyncStorage.setItem(GENRE_INCLUDE_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function shouldHide(genres: string[], hidden: Set<StyleKey>): boolean {
  if (!hidden.size || !genres || !genres.length) return false;
  const lower = genres.map((g) => g.toLowerCase());
  for (const key of hidden) {
    const cfg = STYLE_FILTERS[key];
    if (!cfg) continue;
    const hit = lower.some((g) => cfg.keywords.some((kw) => g.includes(kw)));
    if (hit) return true;
  }
  return false;
}

export async function filterReleasesByStyle<T extends { artistId?: string | null }>(items: T[], hidden: Set<StyleKey>): Promise<T[]> {
  if (!hidden.size) return items;
  const results = await Promise.all(items.map(async (item) => {
    const genres = await getArtistGenresCached(item.artistId);
    return shouldHide(genres, hidden) ? null : item;
  }));
  return results.filter(Boolean) as T[];
}

export async function filterReleasesByGenres<T extends { artistId?: string | null }>(items: T[], include: Set<CanonicalGenre>): Promise<T[]> {
  if (!include.size) return items;
  const results = await Promise.all(items.map(async (item) => {
    const genres = await getArtistGenresCached(item.artistId);
    const mapped = mapToCanonicalGenres(genres);
    const match = mapped.some((g) => include.has(g));
    return match ? item : null;
  }));
  return results.filter(Boolean) as T[];
}
