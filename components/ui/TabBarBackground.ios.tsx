import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export default function BlurTabBarBackground() {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg.primary }]} />
      <BlurView
        tint={isDark ? 'dark' : 'light'}
        intensity={80}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.blend.bottom, opacity: isDark ? 0.5 : 0.2 },
        ]}
      />
    </View>
  );
}

export function useBottomTabOverflow() {
  return useBottomTabBarHeight();
}
