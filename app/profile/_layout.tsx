import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';
import { themeByName } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

export default function ProfileStackLayout() {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? true;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTransparent: true,
        headerBlurEffect: isDark ? 'dark' : 'light',
        headerStyle: { backgroundColor: 'transparent' },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', fontSize: 18, color: colors.text.secondary },
        headerBackTitleVisible: false,
        headerLeft: () => (
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: 8 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text.secondary} />
          </Pressable>
        ),
      }}
    >
      <Stack.Screen name="history" options={{ title: 'History' }} />
      <Stack.Screen name="ratings" options={{ title: 'Ratings' }} />
      <Stack.Screen name="pending" options={{ title: 'Pending Ratings' }} />
      <Stack.Screen name="top-rated" options={{ title: 'Top Rated' }} />
      <Stack.Screen name="insights" options={{ title: 'Insights' }} />
      <Stack.Screen name="share-card" options={{ title: 'Share Card' }} />
      <Stack.Screen name="achievements" options={{ title: 'Achievements' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
