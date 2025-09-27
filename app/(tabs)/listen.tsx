// app/(tabs)/listen.tsx
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
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
  markDone,
  openRowWith,
  removeListen,
  type ListenRow,
} from '../lib/listen';

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchListenList();
    setRows(data);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleDone = async (row: ListenRow) => {
    const ok = await markDone(row.id, !row.done_at);
    if (!ok.ok) Alert.alert('Could not update item', ok.message);
    await load();
  };

  const removeItem = async (row: ListenRow) => {
    const ok = await removeListen(row.id);
    if (!ok.ok) Alert.alert('Could not remove item', ok.message);
    await load();
  };

  const open = async (row: ListenRow) => {
    // For now, always use Apple (your Settings screen can pass the chosen player to this)
    const worked = await openRowWith(row, 'apple');
    if (!worked) Alert.alert('Could not open this item');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={{ padding: 20 }}>
              <Text style={{ fontSize: 22, fontWeight: '600' }}>Your Listen List</Text>
              <Text style={{ marginTop: 8, color: '#666' }}>
                Nothing here yet. Find an artist in Search and tap “Add to Listen List”.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={{
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: '#eee',
                gap: 6,
              }}
            >
              <Text style={{ fontWeight: '600' }}>{item.title}</Text>
              <Text style={{ color: '#666' }}>{item.artist_name}</Text>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                <Pressable onPress={() => open(item)}>
                  <Text style={{ color: '#2f6' }}>Open</Text>
                </Pressable>
                <Pressable onPress={() => toggleDone(item)}>
                  <Text style={{ color: '#06f' }}>
                    {item.done_at ? 'Mark not done' : 'Mark done'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => removeItem(item)}>
                  <Text style={{ color: '#f33' }}>Remove</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
