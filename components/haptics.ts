// Tiny safe haptics wrapper
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoHaptics from 'expo-haptics';
import { emit } from '../lib/events';

const KEY = 'prefs_haptics_enabled';
let enabled = true;

// Load pref async (best-effort)
AsyncStorage.getItem(KEY).then((v) => {
  if (v === 'false') enabled = false;
}).catch(() => {});

export function isHapticsEnabled() {
  return enabled;
}

export async function setHapticsEnabled(v: boolean) {
  enabled = v;
  try { await AsyncStorage.setItem(KEY, v ? 'true' : 'false'); } catch {}
  try { emit('prefs:haptics', v); } catch {}
  // eslint-disable-next-line no-console
  console.log('[settings] haptics_enabled:', v);
}

export const H = {
  success: () => { if (enabled) ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => {}); },
  error: () => { if (enabled) ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error).catch(() => {}); },
  tap: () => { if (enabled) ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light).catch(() => {}); },
};
