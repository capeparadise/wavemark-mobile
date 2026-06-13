import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import TabBarBackground from '../../components/ui/TabBarBackground';
import { themeByName } from '../../theme/themes';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;

  return (
    <Tabs
      initialRouteName="discover"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent.primary,
        tabBarInactiveTintColor: isDark ? '#a8afbd' : '#64748b',
        tabBarLabelStyle: { fontWeight: '700', fontSize: 11, marginTop: -1, paddingBottom: 0 },
        tabBarIconStyle: { marginTop: 1 },
        tabBarItemStyle: { paddingTop: 1, paddingBottom: 0, paddingHorizontal: 4, borderRadius: 999 },
        tabBarBackground: () => (TabBarBackground ? <TabBarBackground /> : null),
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: Math.max(insets.bottom + 2, 12),
          height: 60,
          paddingTop: 0,
          paddingBottom: 0,
          paddingHorizontal: 44,
          borderTopWidth: 0,
          borderWidth: 0,
          borderRadius: 0,
          backgroundColor: 'transparent',
          overflow: 'visible',
          shadowColor: '#000',
          shadowOpacity: 0,
          elevation: 0,
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
          title: 'Your Wave',
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
          headerTransparent: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: 'transparent' },
          headerBackground: () => (
            <View style={StyleSheet.absoluteFill}>
              <BlurView
                tint={isDark ? 'dark' : 'light'}
                intensity={isDark ? 46 : 34}
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.bg.primary, opacity: isDark ? 0.2 : 0.22 },
                ]}
              />
            </View>
          ),
          headerTitleStyle: { fontWeight: '800', color: colors.text.secondary },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />

      {/*
        Safety: if any of these files still exist in (tabs), force-hide them.
        (If you moved/deleted them already, these lines are harmless.)
      */}
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="rated" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="upcoming" options={{ href: null }} />
      <Tabs.Screen name="add-release" options={{ href: null }} />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
