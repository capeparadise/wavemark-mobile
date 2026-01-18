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

export type ThemeName = 'dawn' | 'grove' | 'harbor' | 'noir';

export type ThemeDefinition = {
  name: ThemeName;
  label: string;
  description: string;
  isDark: boolean;
  colors: ThemeColors;
};

export const themeList: ThemeDefinition[] = [
  {
    name: 'dawn',
    label: 'Citrine',
    description: 'Electric yellow with midnight ink.',
    isDark: false,
    colors: {
      bg: {
        primary: '#f7e65a',
        secondary: '#fff3b0',
        muted: '#e6d15b',
        elevated: '#1a1a22',
      },
      blend: {
        top: '#fff7c7',
        mid: '#f7d658',
        bottom: '#2b1f66',
        glow: '#7a4bff',
      },
      text: {
        primary: '#1a1a22',
        secondary: '#242632',
        muted: '#4b5563',
        subtle: '#f9f3d1',
        inverted: '#ffffff',
      },
      accent: {
        primary: '#2c2178',
        subtle: '#8c7b3a',
        success: '#0b7a4b',
      },
      border: {
        subtle: '#e0cb66',
        strong: '#1a1a22',
        muted: '#d2be69',
      },
      overlay: {
        dim: 'rgba(0,0,0,0.4)',
        softLight: 'rgba(255,255,255,0.12)',
      },
      shadow: {
        light: 'rgba(26,26,34,0.2)',
      },
    },
  },
  {
    name: 'grove',
    label: 'Sage',
    description: 'Smoky green with deep moss.',
    isDark: false,
    colors: {
      bg: {
        primary: '#a7bca3',
        secondary: '#e1e9d9',
        muted: '#c7d4bf',
        elevated: '#1c2a24',
      },
      blend: {
        top: '#d7e4ce',
        mid: '#a6b8a1',
        bottom: '#1c2a24',
        glow: '#3f7c62',
      },
      text: {
        primary: '#1c2a24',
        secondary: '#22332c',
        muted: '#4c5b55',
        subtle: '#e8f0e2',
        inverted: '#f9fff4',
      },
      accent: {
        primary: '#1f6f5c',
        subtle: '#7c9b8c',
        success: '#2d8a3a',
      },
      border: {
        subtle: '#c4d2bb',
        strong: '#1c2a24',
        muted: '#b1c2aa',
      },
      overlay: {
        dim: 'rgba(0,0,0,0.4)',
        softLight: 'rgba(255,255,255,0.12)',
      },
      shadow: {
        light: 'rgba(28,42,36,0.2)',
      },
    },
  },
  {
    name: 'harbor',
    label: 'Violet',
    description: 'Electric purple with velvet depth.',
    isDark: false,
    colors: {
      bg: {
        primary: '#b38bff',
        secondary: '#e7daff',
        muted: '#cdb4ff',
        elevated: '#271b4a',
      },
      blend: {
        top: '#e8dbff',
        mid: '#b48cff',
        bottom: '#2a1a59',
        glow: '#7b4bff',
      },
      text: {
        primary: '#271b4a',
        secondary: '#2e2158',
        muted: '#54428c',
        subtle: '#efe6ff',
        inverted: '#ffffff',
      },
      accent: {
        primary: '#6e40ff',
        subtle: '#8a74c7',
        success: '#26a269',
      },
      border: {
        subtle: '#c7b0f2',
        strong: '#271b4a',
        muted: '#b7a0ea',
      },
      overlay: {
        dim: 'rgba(0,0,0,0.4)',
        softLight: 'rgba(255,255,255,0.12)',
      },
      shadow: {
        light: 'rgba(39,27,74,0.2)',
      },
    },
  },
  {
    name: 'noir',
    label: 'Noir',
    description: 'Ink black with hot accents.',
    isDark: true,
    colors: {
      bg: {
        primary: '#0b0b0f',
        secondary: '#14151b',
        muted: '#1e2028',
        elevated: '#0a0a0e',
      },
      blend: {
        top: '#1d1f2a',
        mid: '#151822',
        bottom: '#0b0b0f',
        glow: '#3b2333',
      },
      text: {
        primary: '#f8fafc',
        secondary: '#e5e7eb',
        muted: '#9ca3af',
        subtle: '#cbd5e1',
        inverted: '#ffffff',
      },
      accent: {
        primary: '#f43f5e',
        subtle: '#475569',
        success: '#22c55e',
      },
      border: {
        subtle: '#262b36',
        strong: '#3b4454',
        muted: '#2f3644',
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
