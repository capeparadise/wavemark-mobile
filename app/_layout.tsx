// app/_layout.tsx
import { Stack } from 'expo-router';
import { SessionProvider } from './lib/session';

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Tabs group */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Login lives outside tabs */}
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack>
    </SessionProvider>
  );
}
