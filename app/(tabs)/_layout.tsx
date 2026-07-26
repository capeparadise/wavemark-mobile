import { Ionicons } from '@expo/vector-icons';
import { PlatformPressable } from '@react-navigation/elements';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import TabBarBackground, { TAB_BAR_HEIGHT } from '../../components/ui/TabBarBackground';
import { themeByName } from '../../theme/themes';

const TAB_ITEM_SIZE = TAB_BAR_HEIGHT;
const ICON_SIZE = 24;
const TAB_BAR_HORIZONTAL_PADDING = 58;
const YOUR_WAVE_ICON = require('../../assets/icons/your-wave.png');

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? false;
  const renderTabIcon = (icon: React.ReactNode) => <View style={styles.tabIconSlot}>{icon}</View>;

  return (
    <Tabs
      initialRouteName="discover"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent.primary,
        tabBarInactiveTintColor: isDark ? '#a8afbd' : '#64748b',
        tabBarShowLabel: true,
        tabBarButton: (props) => (
          <PlatformPressable {...props} style={[props.style, styles.tabBarButton]} />
        ),
        tabBarIconStyle: styles.tabBarIconStyle,
        tabBarItemStyle: styles.tabBarItemStyle,
        tabBarLabelStyle: styles.tabBarLabelStyle,
        tabBarBackground: () => (TabBarBackground ? <TabBarBackground /> : null),
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: Math.max(insets.bottom + 2, 12),
          height: TAB_BAR_HEIGHT,
          paddingTop: 0,
          paddingBottom: 0,
          paddingHorizontal: TAB_BAR_HORIZONTAL_PADDING,
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
          tabBarLabel: 'Discover',
          tabBarIcon: ({ color }) => (
            renderTabIcon(<Ionicons name="compass-outline" color={color} size={ICON_SIZE} />)
          ),
        }}
      />
      <Tabs.Screen
        name="listen"
        options={{
          title: 'Listen',
          tabBarLabel: 'List',
          tabBarIcon: ({ color }) => (
            renderTabIcon(<Ionicons name="list-outline" color={color} size={ICON_SIZE} />)
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarLabel: 'Feed',
          tabBarIcon: ({ color }) => (
            renderTabIcon(
              <Image
                source={YOUR_WAVE_ICON}
                style={[styles.yourWaveIcon, { tintColor: color }]}
              />
            )
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
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
          tabBarIcon: ({ color }) => (
            renderTabIcon(<Ionicons name="person-circle-outline" color={color} size={ICON_SIZE} />)
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

const styles = StyleSheet.create({
  tabBarButton: {
    width: '100%',
    height: TAB_BAR_HEIGHT,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarIconStyle: {
    width: TAB_ITEM_SIZE,
    height: 29,
    marginTop: 0,
    marginBottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarItemStyle: {
    height: TAB_BAR_HEIGHT,
    paddingTop: 5,
    paddingBottom: 5,
    paddingHorizontal: 4,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarLabelStyle: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0,
    marginTop: 0,
    marginBottom: 3,
  },
  tabIconSlot: {
    width: TAB_ITEM_SIZE,
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yourWaveIcon: {
    width: 34,
    height: 34,
    resizeMode: 'contain',
  },
});
