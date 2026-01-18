// Simple design tokens to keep spacing/radius consistent across screens.
export const ui = {
  spacing: {
    xs: 6,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  radius: {
    sm: 12,
    md: 16,
    lg: 22,
  },
};

export const icon = {
  button: 44,
};

export function getUiColors(colors: { bg: { secondary: string }; border: { subtle: string }; text: { secondary: string; muted: string } }) {
  return {
    card: colors.bg.secondary,
    border: colors.border.subtle,
    text: colors.text.secondary,
    muted: colors.text.muted,
  };
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized;
  const bigint = parseInt(full, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function mixWithWhite(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return { r: mix(r), g: mix(g), b: mix(b) };
}

// Glass-card helper: soft translucency, faint border, and gentle elevation.
export function glassCardBase(colors: { bg: { primary: string }; shadow: { light: string } }, opts?: { isDark?: boolean }) {
  const isDark = opts?.isDark ?? true;
  const base = mixWithWhite(colors.bg.primary, isDark ? 0.1 : 0.06);       // surface ~ +10% brightness
  const strokeRgb = mixWithWhite(colors.bg.primary, isDark ? 0.16 : 0.1); // elevated stroke ~ +16%
  const surface = `rgba(${base.r},${base.g},${base.b},0.88)`;
  const stroke = `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},0.8)`;
  return {
    backgroundColor: surface,
    borderColor: stroke,
    borderWidth: 1,
    borderRadius: ui.radius.md,
    shadowColor: colors.shadow.light,
    shadowOpacity: isDark ? 0.18 : 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: 'hidden',
  } as const;
}
