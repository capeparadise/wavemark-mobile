// app/(tabs)/listen.tsx
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  Text,
  View,
} from 'react-native';
import {
  fetchListenList,
  getDefaultPlayer,
  markDone,
  openRowWith,
  removeListen,
  type DefaultPlayer,
  type ListenRow,
} from '../lib/queries';

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pref, setPref] = useState<DefaultPlayer>('apple');

  // Load data + preference
  const load = useCallback(async () => {
    setLoading(true);
    const [data, p] = await Promise.all([fetchListenList(), getDefaultPlayer()]);
    setRows(data);
    setPref(p);
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Re-read preference whenever this tab/screen gains focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const p = await getDefaultPlayer();
        setPref(p);
      })();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleDone = async (row: ListenRow) => {
    const ok = await markDone(row.id, !row.done_at);
    if (!ok.ok) Alert.alert('Could not update item', ok.message ?? '');
    await load();
  };

  const onOpen = async (row: ListenRow) => {
    // Just-in-time read to ensure we use the *latest* chosen player
    const latest = await getDefaultPlayer();
    setPref(latest);

    const ok = await openRowWith(row, latest);
    if (!ok) {
      Alert.alert(
        'Could not open',
        'Your device could not open the URL. Long-press “Open” to choose a different app.'
      );
    }
  };

  const onRemove = async (row: ListenRow) => {
    const res = await removeListen(row.id);
    if (!res.ok) Alert.alert('Remove failed', res.message ?? '');
    await load();
  };

  const Row = ({ item }: { item: ListenRow }) => (
    <View
      style={{
        borderRadius: 12,
        padding: 12,
        backgroundColor: '#fff',
        marginBottom: 12,
        shadowOpacity: 0.05,
        shadowRadius: 6,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '700' }}>{item.title}</Text>
      <Text style={{ color: '#6b7280', marginBottom: 8 }}>{item.artist_name}</Text>
      <View style={{ flexDirection: 'row' }}>
        <Pressable
          onPress={() => onOpen(item)}
          onLongPress={() =>
            Alert.alert('Open with…', undefined, [
              { text: 'Apple Music', onPress: () => openRowWith(item, 'apple') },
              { text: 'Spotify', onPress: () => openRowWith(item, 'spotify') },
              { text: 'Cancel', style: 'cancel' },
            ])
          }
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: '#2563eb',
            borderRadius: 10,
            marginRight: 8,
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Open</Text>
        </Pressable>

        <Pressable
          onPress={() => toggleDone(item)}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: item.done_at ? '#10b981' : '#e5e7eb',
            borderRadius: 10,
            marginRight: 8,
          }}
        >
          <Text style={{ color: item.done_at ? 'white' : '#111827', fontWeight: '700' }}>
            {item.done_at ? 'Done' : 'Mark done'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onRemove(item)}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: '#f3f4f6',
            borderRadius: 10,
          }}
        >
          <Text style={{ color: '#b91c1c', fontWeight: '700' }}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, flex: 1 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', marginBottom: 12 }}>Listen</Text>

        {loading ? (
          <ActivityIndicator />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            renderItem={Row}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <Text style={{ color: '#6b7280' }}>
                Nothing here yet. Add something from an artist page.
              </Text>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
