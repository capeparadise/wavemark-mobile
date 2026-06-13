export type ThemeColors = {
  bg: {
    primary: string;
    secondary: string;
    muted: string;
    elevated: string;
  };
  blend: {
    top: string;
    mid: string;
    bottom: string;
    glow: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    subtle: string;
    inverted: string;
  };
  accent: {
    primary: string;
    subtle: string;
    success: string;
  };
  border: {
    subtle: string;
    strong: string;
    muted: string;
  };
  overlay: {
    dim: string;
    softLight: string;
  };
  shadow: {
    light: string;
  };
};

export type ThemeName = 'dark';

export type ThemeDefinition = {
  name: ThemeName;
  label: string;
  description: string;
  isDark: boolean;
  colors: ThemeColors;
};

const accent = {
  primary: '#6847dc',
  subtle: '#8975c2',
  success: '#26a269',
};

export const themeList: ThemeDefinition[] = [
  {
    name: 'dark',
    label: 'Dark',
    description: 'Deep mode.',
    isDark: true,
    colors: {
      bg: {
        primary: '#0d0e13',
        secondary: '#171922',
        muted: '#222633',
        elevated: '#090a0f',
      },
      blend: {
        top: '#202331',
        mid: '#151823',
        bottom: '#0d0e13',
        glow: '#2f244d',
      },
      text: {
        primary: '#f8fafc',
        secondary: '#e5e7eb',
        muted: '#9ca3af',
        subtle: '#cbd5e1',
        inverted: '#ffffff',
      },
      accent,
      border: {
        subtle: '#293040',
        strong: '#3f485c',
        muted: '#333b4c',
      },
      overlay: {
        dim: 'rgba(0,0,0,0.7)',
        softLight: 'rgba(255,255,255,0.08)',
      },
      shadow: {
        light: 'rgba(0,0,0,0.5)',
      },
    },
  },
];

export const themes = themeList.reduce((acc, theme) => {
  acc[theme.name] = theme.colors;
  return acc;
}, {} as Record<ThemeName, ThemeColors>);

export const themeByName = themeList.reduce((acc, theme) => {
  acc[theme.name] = theme;
  return acc;
}, {} as Record<ThemeName, ThemeDefinition>);
