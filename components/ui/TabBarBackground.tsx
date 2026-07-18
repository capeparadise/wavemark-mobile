import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export const TAB_BAR_HEIGHT = 54;

export default function TabBarBackground() {
  const { themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.shadowCapsule}>
        <View style={styles.capsule}>
          <LinearGradient
            colors={[
              isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.42)',
              isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.18)',
              isDark ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.28)',
            ]}
            locations={[0, 0.54, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(16,18,27,0.66)' : 'rgba(255,255,255,0.34)' },
            ]}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(6,7,12,0.18)' : 'rgba(248,250,252,0.14)' },
            ]}
          />
          <View style={[StyleSheet.absoluteFill, styles.innerHighlight]} />
        </View>
      </View>
    </View>
  );
}

export function useBottomTabOverflow() {
  return 0;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadowCapsule: {
    width: '82%',
    maxWidth: 360,
    height: TAB_BAR_HEIGHT,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  capsule: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
  },
  innerHighlight: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
});
