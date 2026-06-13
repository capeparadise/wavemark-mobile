import AsyncStorage from '@react-native-async-storage/async-storage';
import { emit, off, on } from '../lib/events';
import { themes, type ThemeName } from './themes';

const THEME_KEY = 'prefs_theme_v1';
const THEME_EVENT = 'prefs:theme';

let currentTheme: ThemeName = 'dark';
let initPromise: Promise<void> | null = null;

function normalizeThemeName(_value: string | null): ThemeName {
  return 'dark';
}

export async function initTheme() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_KEY);
        const normalized = normalizeThemeName(stored);
        currentTheme = normalized;
        if (stored !== normalized) {
          await AsyncStorage.setItem(THEME_KEY, normalized);
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
  const eventHandler = (name?: ThemeName) => {
    handler(name ?? currentTheme);
  };
  on(THEME_EVENT, eventHandler);
  return () => off(THEME_EVENT, eventHandler);
}
