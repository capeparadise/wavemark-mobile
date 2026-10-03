import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ArtistAlbum } from './spotifyArtist';

export type ArtistPageSnapshot = {
  name: string;
  imageUrl: string | null;
  followers?: number;
  genres: string[];
  albums: ArtistAlbum[];
  savedAt: number;
};
const memory = new Map<string, ArtistPageSnapshot>();
const key = (id: string, market: string) => `artist_page_v1:${market}:${id}`;
const valid = (value: ArtistPageSnapshot | null | undefined) => !!value && Array.isArray(value.albums) && Date.now() - value.savedAt < 24 * 60 * 60 * 1000;
export function peekArtistPage(id: string, market: string) {
  const value = memory.get(key(id, market));
  return valid(value) ? value! : null;
}
export async function readArtistPage(id: string, market: string) {
  const cached = peekArtistPage(id, market);
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(key(id, market));
    const value = raw ? JSON.parse(raw) : null;
    if (!valid(value)) return null;
    memory.set(key(id, market), value);
    return value as ArtistPageSnapshot;
  } catch { return null; }
}
export function writeArtistPage(id: string, market: string, value: Omit<ArtistPageSnapshot, 'savedAt'>) {
  const snapshot = { ...value, savedAt: Date.now() };
  memory.set(key(id, market), snapshot);
  if (memory.size > 30) memory.delete(memory.keys().next().value!);
  void AsyncStorage.setItem(key(id, market), JSON.stringify(snapshot)).catch(() => {});
}
