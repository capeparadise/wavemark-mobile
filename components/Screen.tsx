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
  const shapeOpacity = isDark ? 0.11 : 0.08;
  useSafeAreaInsets(); // ensures provider is present
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg.primary, position: 'relative' }}
      edges={edges ?? [ 'top', 'left', 'right' ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[colors.blend.top, colors.blend.mid, colors.blend.bottom]}
          locations={[0, 0.58, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ position: 'absolute', top: -190, left: -150, width: 390, height: 390, borderRadius: 195, backgroundColor: colors.accent.primary, opacity: shapeOpacity }} />
        <View style={{ position: 'absolute', top: 130, right: -230, width: 430, height: 430, borderRadius: 215, backgroundColor: colors.blend.glow, opacity: isDark ? 0.13 : 0.09 }} />
        <View style={{ position: 'absolute', bottom: -230, left: -130, width: 430, height: 430, borderRadius: 215, backgroundColor: colors.accent.subtle, opacity: isDark ? 0.09 : 0.07 }} />
        {/* Top fade to integrate headers */}
        <LinearGradient
          colors={[isDark ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.2)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.6 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 150 }}
        />
      </View>
      <View style={[{ flex: 1, paddingHorizontal: 16, paddingTop: 8, backgroundColor: 'transparent' }, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}
