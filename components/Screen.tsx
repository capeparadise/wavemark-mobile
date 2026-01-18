import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { SafeAreaView, type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/useTheme';
import { themeByName } from '../theme/themes';

type ScreenProps = ViewProps & {
  edges?: Edge[];
};

export default function Screen({ children, style, edges, ...rest }: ScreenProps) {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? true;
  useSafeAreaInsets(); // ensures provider is present
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg.primary, position: 'relative' }}
      edges={edges ?? [ 'top', 'left', 'right' ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[colors.blend.top, colors.blend.mid, colors.blend.bottom]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ position: 'absolute', top: -200, left: -140, width: 420, height: 420, borderRadius: 210, backgroundColor: colors.accent.primary, opacity: 0.12 }} />
        <View style={{ position: 'absolute', top: 120, right: -220, width: 440, height: 440, borderRadius: 220, backgroundColor: colors.blend.glow, opacity: 0.1 }} />
        <View style={{ position: 'absolute', bottom: -240, left: -120, width: 460, height: 460, borderRadius: 230, backgroundColor: colors.accent.subtle, opacity: 0.08 }} />
        {/* Top fade to integrate headers */}
        <LinearGradient
          colors={[isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.6 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 180 }}
        />
      </View>
      <View style={[{ flex: 1, paddingHorizontal: 16, paddingTop: 4, backgroundColor: 'transparent' }, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}
