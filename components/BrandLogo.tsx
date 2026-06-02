import React, { useMemo } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { themeByName } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

const LOGO_DARK = require('../assets/brand/rppl-logo.png');
const LOGO_LIGHT = require('../assets/brand/rppl-logo-light.png');
const FALLBACK_LOGO_ASPECT_RATIO = 744 / 460;

type BrandLogoProps = {
  height?: number;
  variant?: 'auto' | 'dark' | 'light';
  style?: StyleProp<ImageStyle>;
};

export default function BrandLogo({ height = 28, variant = 'auto', style }: BrandLogoProps) {
  const { themeName } = useTheme();
  const isDarkTheme = themeByName[themeName]?.isDark ?? false;
  const source = variant === 'auto'
    ? (isDarkTheme ? LOGO_LIGHT : LOGO_DARK)
    : (variant === 'light' ? LOGO_LIGHT : LOGO_DARK);

  const aspectRatio = useMemo(() => {
    const resolveAssetSource = (Image as unknown as {
      resolveAssetSource?: (source: unknown) => { width?: number; height?: number } | undefined;
    }).resolveAssetSource;
    const resolved = resolveAssetSource?.(source);
    if (!resolved?.width || !resolved?.height) return FALLBACK_LOGO_ASPECT_RATIO;
    return resolved.width / resolved.height;
  }, [source]);

  return (
    <Image
      source={source}
      resizeMode="contain"
      style={[
        {
          height,
          width: height * aspectRatio,
        },
        style,
      ]}
      accessibilityIgnoresInvertColors
    />
  );
}
