import { StyleSheet, View } from 'react-native';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export default function TabBarBackground() {
  const { themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.shadowCapsule}>
        <View style={styles.capsule}>
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(17,20,28,0.72)' : 'rgba(255,255,255,0.46)' },
            ]}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(248,250,252,0.22)' },
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
    width: '84%',
    height: '100%',
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
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
    borderColor: 'rgba(255,255,255,0.22)',
  },
});
