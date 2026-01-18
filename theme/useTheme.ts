import { useEffect, useState } from 'react';
import { getThemeColors, getThemeName, initTheme, setThemeName, subscribeTheme } from './themeStore';
import type { ThemeColors, ThemeName } from './themes';

export function useTheme() {
  const [themeName, setThemeNameState] = useState<ThemeName>(getThemeName());
  const [colors, setColors] = useState<ThemeColors>(getThemeColors());

  useEffect(() => {
    let active = true;
    initTheme().then(() => {
      if (!active) return;
      setThemeNameState(getThemeName());
      setColors(getThemeColors());
    });
    const unsubscribe = subscribeTheme((name) => {
      setThemeNameState(name);
      setColors(getThemeColors());
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    themeName,
    colors,
    setThemeName,
  };
}
