import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useSession } from './session';
import { emit, on, off } from './events';
import { normalizeAdvancedOrder, normalizeRatingOrder, type RatingSection } from './ratingOrder';

export type RatingPreferences = { artwork: boolean; notes: boolean; order?: RatingSection[]; advancedOrder?: RatingSection[] };
export const defaultRatingPreferences: RatingPreferences = { artwork: false, notes: true };
export const ratingPreferencesKey = (id: string) => `rating_preferences_v1:${id}`;
export function parseRatingPreferences(raw: string | null): RatingPreferences {
  const value = raw ? JSON.parse(raw) : {};
  return { artwork: typeof value?.artwork === 'boolean' ? value.artwork : false, notes: typeof value?.notes === 'boolean' ? value.notes : true,
    ...(value?.order ? { order: normalizeRatingOrder(value.order), advancedOrder: normalizeAdvancedOrder(value.advancedOrder ?? value.order) } :
      value?.advancedOrder ? { advancedOrder: normalizeAdvancedOrder(value.advancedOrder) } : {}) };
}
export async function saveRatingPreferences(id: string, preferences: RatingPreferences) {
  await AsyncStorage.setItem(ratingPreferencesKey(id), JSON.stringify(preferences));
  emit('prefs:rating_extras', { id, preferences });
}
export function useRatingPreferences() {
  const { user } = useSession();
  const id = user?.id;
  const [state, setState] = useState<{ id?: string; preferences: RatingPreferences; ready: boolean }>({ preferences: defaultRatingPreferences, ready: false });
  useEffect(() => {
    let active = true;
    let changed = false;
    const update = (value?: { id: string; preferences: RatingPreferences }) => {
      if (value && value.id === id) { changed = true; setState({ id, preferences: value.preferences, ready: true }); }
    };
    on('prefs:rating_extras', update);
    if (id) void AsyncStorage.getItem(ratingPreferencesKey(id)).then(raw => {
      const preferences = parseRatingPreferences(raw);
      if (active && !changed) setState({ id, preferences, ready: true });
    }).catch(() => { if (active && !changed) setState({ id, preferences: defaultRatingPreferences, ready: true }); });
    return () => { active = false; off('prefs:rating_extras', update); };
  }, [id]);
  return { preferences: state.id === id ? state.preferences : defaultRatingPreferences, ready: !!id && state.id === id && state.ready, userId: id };
}
