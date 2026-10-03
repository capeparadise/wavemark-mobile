import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Screen from '../../components/StackScreen';
import { useTheme } from '../../theme/useTheme';

const destinations = [
  { label: 'Rating settings', detail: 'Choose your rating depth, artwork and notes', icon: 'options-outline', path: '/profile/rating-settings' },
  { label: 'Your ratings', detail: 'Revisit and edit your scores', icon: 'star-outline', path: '/profile/ratings' },
  { label: 'To rate', detail: 'Music you’ve heard but haven’t rated', icon: 'time-outline', path: '/profile/pending' },
  { label: 'Your notes', detail: 'The thoughts behind your ratings', icon: 'chatbubble-outline', path: '/profile/reviews' },
] as const;

export default function RatingHub() {
  const { colors } = useTheme();
  return <Screen><ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
    <Text style={{ color: colors.text.muted, lineHeight: 21, marginBottom: 12 }}>Everything about how you rate, in one place.</Text>
    {destinations.map(item => <Pressable key={item.path} accessibilityRole="button" onPress={() => router.push(item.path)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={item.icon} size={21} color={colors.accent.primary} />
      <View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>{item.label}</Text><Text style={{ color: colors.text.muted, fontSize: 13 }}>{item.detail}</Text></View>
      <Ionicons name="chevron-forward" size={17} color={colors.text.muted} />
    </Pressable>)}
  </ScrollView></Screen>;
}
