import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export default function BlurTabBarBackground() {
  const { themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.shadowCapsule}>
        <View style={styles.capsule}>
          <BlurView
            tint={isDark ? 'dark' : 'light'}
            intensity={isDark ? 82 : 78}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(18,20,28,0.42)' : 'rgba(255,255,255,0.28)' },
            ]}
          />
          <View style={[StyleSheet.absoluteFill, styles.innerHighlight]} />
        </View>
      </View>
    </View>
  );
}

export function useBottomTabOverflow() {
  return useBottomTabBarHeight();
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadowCapsule: {
    width: '84%',
    height: '100%',
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  capsule: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
  },
  innerHighlight: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});
