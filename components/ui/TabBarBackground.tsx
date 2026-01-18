import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';

export default function TabBarBackground() {
  const { colors } = useTheme();
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg.primary }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.blend.bottom, opacity: 0.15 }]} />
    </View>
  );
}

export function useBottomTabOverflow() {
  return 0;
}
