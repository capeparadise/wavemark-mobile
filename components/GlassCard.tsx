import React from 'react';
import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ui, glassCardBase } from '../constants/ui';
import { themeByName } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

type Props = ViewProps & {
  onPress?: () => void;
  disabled?: boolean;
  asChild?: boolean;
};

export default function GlassCard({ children, style, onPress, disabled, asChild, ...rest }: Props) {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? true;
  const base = glassCardBase(colors, { isDark });
  const Container = asChild ? View : (onPress ? Pressable : View);

  return (
    <Container
      onPress={onPress}
      disabled={disabled}
      style={[base, { padding: ui.spacing.md }, style]}
      {...rest}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0.08)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.6 }}
        style={[StyleSheet.absoluteFill, { borderRadius: base.borderRadius }]}
        pointerEvents="none"
      />
      {children}
    </Container>
  );
}
