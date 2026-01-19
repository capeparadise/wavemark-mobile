// app/_layout.tsx
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/session';
import { themeByName } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

function AuthSync() {
  const { session, loading } = useSession();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const root = segments[0];
    if (root === 'session') return;
    if (session && root === '(auth)') router.replace('/session');
    if (!session && root === '(tabs)') router.replace('/session');
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
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
