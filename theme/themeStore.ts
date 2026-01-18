import AsyncStorage from '@react-native-async-storage/async-storage';
import { emit, off, on } from '../lib/events';
import { themes, type ThemeName } from './themes';

const THEME_KEY = 'prefs_theme_v1';
const THEME_EVENT = 'prefs:theme';

let currentTheme: ThemeName = 'dawn';
let initPromise: Promise<void> | null = null;

export async function initTheme() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_KEY);
        if (stored && stored in themes) {
          currentTheme = stored as ThemeName;
        }
      } catch {
        // ignore storage failures
      }
    })();
  }
  return initPromise;
}

export function getThemeName() {
  return currentTheme;
}

export function getThemeColors() {
  return themes[currentTheme];
}

export async function setThemeName(name: ThemeName) {
  currentTheme = name;
  try {
    await AsyncStorage.setItem(THEME_KEY, name);
  } catch {
    // ignore storage failures
  }
  emit(THEME_EVENT, name);
}

export function subscribeTheme(handler: (name: ThemeName) => void) {
  on(THEME_EVENT, handler);
  return () => off(THEME_EVENT, handler);
}
