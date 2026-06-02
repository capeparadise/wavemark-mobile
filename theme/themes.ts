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
    description: 'Soft citrine with midnight ink.',
    isDark: false,
    colors: {
      bg: {
        primary: '#ead98f',
        secondary: '#fff6d2',
        muted: '#dcc770',
        elevated: '#1a1a22',
      },
      blend: {
        top: '#fff8de',
        mid: '#dfca79',
        bottom: '#46375f',
        glow: '#7b65c7',
      },
      text: {
        primary: '#1a1a22',
        secondary: '#242632',
        muted: '#4b5563',
        subtle: '#f9f3d1',
        inverted: '#ffffff',
      },
      accent: {
        primary: '#3e2f86',
        subtle: '#857746',
        success: '#0b7a4b',
      },
      border: {
        subtle: '#d5c071',
        strong: '#1a1a22',
        muted: '#c5b36d',
      },
      overlay: {
        dim: 'rgba(0,0,0,0.4)',
        softLight: 'rgba(255,255,255,0.12)',
      },
      shadow: {
        light: 'rgba(26,26,34,0.14)',
      },
    },
  },
  {
    name: 'grove',
    label: 'Sage',
    description: 'Smoky sage with deep moss.',
    isDark: false,
    colors: {
      bg: {
        primary: '#9fb49f',
        secondary: '#dde8d9',
        muted: '#bdcdb7',
        elevated: '#1c2a24',
      },
      blend: {
        top: '#dbe8d3',
        mid: '#9fb39d',
        bottom: '#263b34',
        glow: '#4c8068',
      },
      text: {
        primary: '#1c2a24',
        secondary: '#22332c',
        muted: '#4c5b55',
        subtle: '#e8f0e2',
        inverted: '#f9fff4',
      },
      accent: {
        primary: '#1f725f',
        subtle: '#7c988b',
        success: '#2d8a3a',
      },
      border: {
        subtle: '#bfceb8',
        strong: '#1c2a24',
        muted: '#adbea8',
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
    description: 'Soft violet with velvet depth.',
    isDark: false,
    colors: {
      bg: {
        primary: '#aa91e6',
        secondary: '#e8ddff',
        muted: '#c8b6ef',
        elevated: '#271b4a',
      },
      blend: {
        top: '#ede4ff',
        mid: '#aa8fe8',
        bottom: '#33265f',
        glow: '#7557dd',
      },
      text: {
        primary: '#271b4a',
        secondary: '#2e2158',
        muted: '#54428c',
        subtle: '#efe6ff',
        inverted: '#ffffff',
      },
      accent: {
        primary: '#6847dc',
        subtle: '#8975c2',
        success: '#26a269',
      },
      border: {
        subtle: '#c3b1ea',
        strong: '#271b4a',
        muted: '#b3a1df',
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
        primary: '#0d0e13',
        secondary: '#171922',
        muted: '#222633',
        elevated: '#090a0f',
      },
      blend: {
        top: '#202331',
        mid: '#151823',
        bottom: '#0d0e13',
        glow: '#432736',
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
