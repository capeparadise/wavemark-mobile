/* ========================================================================
   File: app/(tabs)/calendar.tsx
   PURPOSE: Show upcoming releases saved by the user (presaves).
   ======================================================================== */
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import type { ListenRow } from '../../lib/listen';
import { fetchUpcoming, reconcileReleased } from '../../lib/listen';

export default function CalendarTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ListenRow[]>([]);

  const load = async () => {
    setLoading(true);
    await reconcileReleased(); // move released items into Listen list automatically
    const res = await fetchUpcoming();
    if (res.ok) setRows(res.rows);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const grouped = useMemo(() => {
    const map = new Map<string, ListenRow[]>();
    for (const r of rows) {
      const k = r.release_date || 'TBA';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    // sort keys
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <Screen>
      <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Calendar</Text>
        <Text style={{ marginTop: 6, color: '#666' }}>Upcoming releases you’ve saved.</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={([d]) => d}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item: [date, items] }) => (
            <View style={{ paddingVertical: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8 }}>
                {date === 'TBA' ? 'Date TBA' : date}
              </Text>
              {items.map(r => (
                <View key={r.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                  <Text style={{ fontWeight: '600' }}>{r.title}</Text>
                  <Text style={{ color: '#666' }}>{r.artist_name}</Text>
                </View>
              ))}
            </View>
          )}
        />
      )}
    </Screen>
  );
}
