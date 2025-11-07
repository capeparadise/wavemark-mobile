// app/_layout.tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureDevSignIn } from '../lib/devAuth';
import { SessionProvider } from '../lib/session';

export default function RootLayout() {
  useEffect(() => {
    if (__DEV__) {
      ensureDevSignIn();
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            {/* Tabs group */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* Login lives outside tabs */}
            <Stack.Screen name="login" options={{ headerShown: false }} />
            {/* New releases wide and genres screens */}
            <Stack.Screen name="new-releases-all" options={{ headerShown: false }} />
            <Stack.Screen name="new-releases-all-genres" options={{ headerShown: false }} />
            <Stack.Screen name="new-releases/[genre]" options={{ headerShown: false }} />
          </Stack>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
