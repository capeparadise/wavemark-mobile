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
          colors={[colors.bg.elevated, colors.blend.mid, colors.bg.primary]}
          locations={[0, 0.44, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(104,71,220,0)', 'rgba(104,71,220,0.12)', 'rgba(104,71,220,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.ambientBeamTop}
        />
        <LinearGradient
          colors={['rgba(137,117,194,0)', 'rgba(137,117,194,0.08)', 'rgba(137,117,194,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.ambientBeamBottom}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.045)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.028)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.filmLineTop} />
        <View style={styles.filmLineBottom} />
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

const styles = StyleSheet.create({
  ambientBeamTop: {
    position: 'absolute',
    top: -64,
    left: -120,
    right: -90,
    height: 260,
    transform: [{ rotate: '-11deg' }],
  },
  ambientBeamBottom: {
    position: 'absolute',
    left: -110,
    right: -130,
    bottom: -34,
    height: 240,
    transform: [{ rotate: '8deg' }],
  },
  filmLineTop: {
    position: 'absolute',
    top: 134,
    left: -40,
    right: -40,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.035)',
    transform: [{ rotate: '-11deg' }],
  },
  filmLineBottom: {
    position: 'absolute',
    left: -60,
    right: -60,
    bottom: 112,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.028)',
    transform: [{ rotate: '8deg' }],
  },
});
