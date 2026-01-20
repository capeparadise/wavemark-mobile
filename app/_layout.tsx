// app/_layout.tsx
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { hasSeenFirstLogin } from '../lib/firstLogin';
import { SessionProvider, useSession } from '../lib/session';
import { themeByName } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

function AuthSync() {
  const { session, loading } = useSession();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      const root = segments[0];
      if (root === 'session') return;
      if (session && root === '(auth)') { router.replace('/session'); return; }
      if (!session && (root === '(tabs)' || root === '(onboarding)')) { router.replace('/session'); return; }
      if (session && (root === '(tabs)' || root === '(onboarding)')) {
        const seen = await hasSeenFirstLogin(session.user.id);
        if (cancelled) return;
        if (!seen && root === '(tabs)') router.replace('/session');
        if (seen && root === '(onboarding)') router.replace('/session');
      }
    })();
    return () => { cancelled = true; };
  }, [loading, segments, session]);

  return null;
}

export default function RootLayout() {
  const { themeName, colors } = useTheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <AuthSync />
          <StatusBar
            style={themeByName[themeName]?.isDark ? 'light' : 'dark'}
            backgroundColor={colors.bg.primary}
          />
          <Stack initialRouteName="session" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="session" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
