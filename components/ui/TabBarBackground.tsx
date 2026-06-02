import { StyleSheet, View } from 'react-native';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export default function TabBarBackground() {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <View style={[StyleSheet.absoluteFill, styles.clip]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg.secondary, opacity: isDark ? 0.76 : 0.62 }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.blend.bottom, opacity: isDark ? 0.2 : 0.08 }]} />
      <View style={[StyleSheet.absoluteFill, { borderWidth: 1, borderColor: colors.overlay.softLight, borderRadius: 999 }]} />
    </View>
  );
}

export function useBottomTabOverflow() {
  return 0;
}

const styles = StyleSheet.create({
  clip: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});
