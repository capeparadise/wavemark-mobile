import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export default function BlurTabBarBackground() {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <View style={[StyleSheet.absoluteFill, styles.clip]}>
      <BlurView
        tint={isDark ? 'dark' : 'light'}
        intensity={isDark ? 74 : 64}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.bg.secondary, opacity: isDark ? 0.38 : 0.42 },
        ]}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.blend.bottom, opacity: isDark ? 0.16 : 0.06 }]} />
      <View style={[StyleSheet.absoluteFill, { borderWidth: 1, borderColor: colors.overlay.softLight, borderRadius: 999 }]} />
    </View>
  );
}

export function useBottomTabOverflow() {
  return useBottomTabBarHeight();
}

const styles = StyleSheet.create({
  clip: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});
