import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import { AppState, Image, Pressable, Text, View } from 'react-native';
import { fetchWeeklyTopFive, weeklyWindow } from '../lib/weeklyTopFive';
import type { ListenSummary } from '../lib/stats';
import { goToRelease } from '../lib/navigation';
import { RELEASE_LONG_PRESS_MS } from '../hooks/useReleaseActions';
import { useTheme } from '../theme/useTheme';

export default function WeeklyTopFive({ userId, onOptions }: {
  userId: string; onOptions: (item: ListenSummary) => void;
}) {
  const { colors } = useTheme();
  const [rows, setRows] = useState<ListenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [week, setWeek] = useState(() => +weeklyWindow().start);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    const now = new Date();
    setWeek(+weeklyWindow(now).start);
    setLoading(true);
    setError(false);
    try {
      const result = await fetchWeeklyTopFive(userId, now);
      if (request === generation.current) setRows(result);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    void load();
    let currentWeek = +weeklyWindow().start;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void load();
    });
    const timer = setInterval(() => {
      const next = +weeklyWindow().start;
      if (next !== currentWeek) { currentWeek = next; void load(); }
    }, 60_000);
    return () => { ++generation.current; subscription.remove(); clearInterval(timer); };
  }, [load]));

  return <View style={{ gap: 8 }}>
    <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary }}>Your weekly Top 5</Text>
    <Text style={{ fontSize: 13, lineHeight: 19, color: colors.text.muted }}>
      Week of {new Date(week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · Only you
    </Text>
    <Text style={{ fontSize: 13, lineHeight: 19, color: colors.text.muted }}>
      Songs logged since Monday, ranked by your overall rating.
    </Text>
    {loading ? <Text style={{ color: colors.text.muted, paddingVertical: 12 }}>Updating your week…</Text> : error ?
      <Pressable accessibilityRole="button" onPress={() => void load()} style={{ paddingVertical: 12 }}>
        <Text style={{ color: colors.accent.primary }}>Couldn’t load this week. Tap to retry.</Text>
      </Pressable> : rows.length === 0 ?
      <Text style={{ color: colors.text.muted, lineHeight: 21, paddingVertical: 12 }}>Log and rate a song this week to start your Top 5. Albums aren’t included.</Text> : rows.map((item, index) =>
      <Pressable key={item.id} accessibilityRole="button"
        accessibilityLabel={`${index + 1}. ${item.title}, ${item.artist_name || 'Unknown artist'}, overall ${item.rating} out of 10`}
        accessibilityHint="Tap to open. Hold for release options."
        onPress={() => goToRelease(item.id)} onLongPress={() => onOptions(item)} delayLongPress={RELEASE_LONG_PRESS_MS}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ width: 18, color: colors.text.muted, fontWeight: '700' }}>{index + 1}</Text>
        {item.artwork_url ? <Image source={{ uri: item.artwork_url }} style={{ width: 44, height: 44, borderRadius: 8 }} /> :
          <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-note" size={22} color={colors.text.muted} /></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 14 }}>{item.title}</Text>
          <Text numberOfLines={1} style={{ color: colors.text.muted, fontSize: 12 }}>{item.artist_name || 'Unknown artist'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>{item.rating}/10</Text>
          <Text style={{ color: colors.text.muted, fontSize: 11 }}>Overall</Text>
        </View>
      </Pressable>)}
  </View>;
}
