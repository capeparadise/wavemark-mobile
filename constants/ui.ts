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

export function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function mixWithWhite(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return { r: mix(r), g: mix(g), b: mix(b) };
}

function mixHex(from: string, to: string, amount: number) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mix = (start: number, end: number) => Math.round(start + (end - start) * amount);
  return {
    r: mix(a.r, b.r),
    g: mix(a.g, b.g),
    b: mix(a.b, b.b),
  };
}

// Glass-card helper: soft translucency, faint border, and gentle elevation.
export function glassCardBase(
  colors: {
    bg: { primary: string; secondary: string };
    border: { subtle: string };
    overlay: { softLight: string };
    shadow: { light: string };
  },
  opts?: { isDark?: boolean }
) {
  const isDark = opts?.isDark ?? true;
  const base = isDark
    ? mixWithWhite(colors.bg.secondary, 0.08)
    : mixHex(colors.bg.secondary, '#ffffff', 0.38);
  const strokeRgb = isDark
    ? mixWithWhite(colors.bg.secondary, 0.2)
    : mixHex(colors.border.subtle, '#ffffff', 0.28);
  const surface = `rgba(${base.r},${base.g},${base.b},${isDark ? 0.78 : 0.68})`;
  const stroke = `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},${isDark ? 0.74 : 0.76})`;
  return {
    backgroundColor: surface,
    borderColor: stroke,
    borderWidth: 1,
    borderRadius: ui.radius.md,
    shadowColor: colors.shadow.light,
    shadowOpacity: isDark ? 0.22 : 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    overflow: 'hidden',
  } as const;
}

export function glassPillBase(
  colors: {
    bg: { muted: string; secondary: string };
    border: { subtle: string };
    accent: { primary: string };
    shadow: { light: string };
  },
  opts?: { selected?: boolean; isDark?: boolean }
) {
  const selected = !!opts?.selected;
  const isDark = opts?.isDark ?? true;
  return {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    minHeight: 38,
    borderWidth: 1,
    borderColor: selected ? withAlpha(colors.accent.primary, isDark ? 0.72 : 0.62) : withAlpha(colors.border.subtle, isDark ? 0.76 : 0.62),
    backgroundColor: selected
      ? withAlpha(colors.accent.primary, isDark ? 0.26 : 0.18)
      : withAlpha(colors.bg.secondary, isDark ? 0.5 : 0.46),
    shadowColor: selected ? colors.accent.primary : colors.shadow.light,
    shadowOpacity: selected ? 0.12 : 0.05,
    shadowRadius: selected ? 12 : 8,
    shadowOffset: { width: 0, height: 3 },
  } as const;
}
