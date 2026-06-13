// app/_layout.tsx
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getHasSeenOnboarding } from '../lib/onboarding';
import { SessionProvider, useSession } from '../lib/session';
import { themeByName } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

function AuthSync() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const { colors } = useTheme();
  const [checkingAccess, setCheckingAccess] = useState(false);

  useEffect(() => {
    if (loading) {
      setCheckingAccess(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const root = segments[0];
      const isProtectedRoot = root === '(tabs)' || root === 'onboarding' || root === 'profile';

      if (root === 'session') {
        setCheckingAccess(false);
        return;
      }

      if (session && root === '(auth)') {
        setCheckingAccess(false);
        router.replace('/session');
        return;
      }

      if (!session && isProtectedRoot) {
        setCheckingAccess(true);
        router.replace('/session');
        return;
      }

      if (session && isProtectedRoot) {
        setCheckingAccess(true);
        const hasSeenOnboarding = await getHasSeenOnboarding();
        if (cancelled) return;
        if (!hasSeenOnboarding && root === '(tabs)') {
          router.replace('/onboarding');
          return;
        }
        if (hasSeenOnboarding && root === 'onboarding') {
          router.replace('/session');
          return;
        }
      }
      if (!cancelled) setCheckingAccess(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, segments, session]);

  if (!checkingAccess) return null;

  return (
    <View pointerEvents="none" style={[styles.loadingOverlay, { backgroundColor: colors.bg.primary }]}>
      <ActivityIndicator />
    </View>
  );
}

export default function RootLayout() {
  const { themeName, colors } = useTheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar
            style={themeByName[themeName]?.isDark ? 'light' : 'dark'}
            backgroundColor={colors.bg.primary}
          />
          <Stack initialRouteName="session" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="session" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <AuthSync />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
