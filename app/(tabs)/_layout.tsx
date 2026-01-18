import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import TabBarBackground from '../../components/ui/TabBarBackground';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <Tabs
      initialRouteName="discover"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text.secondary,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarLabelStyle: { fontWeight: '700', fontSize: 11, paddingBottom: 2 },
        tabBarItemStyle: { paddingTop: 6, paddingHorizontal: 8 },
        tabBarBackground: () => (TabBarBackground ? <TabBarBackground /> : null),
        tabBarStyle: {
          height: 54 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingHorizontal: 6,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
        },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="listen"
        options={{
          title: 'Listen',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sparkles-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: true,
          headerStyle: { backgroundColor: colors.bg.primary },
          headerTitleStyle: { fontWeight: '800', color: colors.text.secondary },
          headerRight: () => (
            <Ionicons
              name="settings-outline"
              size={22}
              color={colors.text.secondary}
              // Expo Router: use a link-like behavior to navigate to /settings
              onPress={() => {
                try {
                  // dynamic import to avoid top-level dependency
                  // eslint-disable-next-line @typescript-eslint/no-var-requires
                  const { router } = require('expo-router');
                  router.push('/profile/settings');
                } catch {}
              }}
              style={{ marginRight: 12 }}
              accessibilityLabel="Settings"
            />
          ),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />
      {/** Settings removed from tab bar; accessible from Profile header */}

      {/*
        Safety: if any of these files still exist in (tabs), force-hide them.
        (If you moved/deleted them already, these lines are harmless.)
      */}
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="rated" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      {/* Explicitly hide any accidental settings tab route */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="upcoming" options={{ href: null }} />
      <Tabs.Screen name="calendar" options={{ href: null }} />
      <Tabs.Screen name="add-release" options={{ href: null }} />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
