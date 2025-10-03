import { useFocusEffect } from '@react-navigation/native';
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
  openByDefaultPlayer,
  type ListenRow,
} from '../../lib/listen';

type Player = 'apple' | 'spotify';

function DefaultBadge({ player }: { player: Player }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#dbeafe',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700' }}>
        {player === 'apple' ? ' Music' : 'Spotify'}
      </Text>
    </View>
  );
}

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [defaultPlayer, setDefaultPlayer] = useState<Player>('apple');

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

  // Load default player on mount and after pull-to-refresh
  useEffect(() => {
    (async () => {
      try {
        const p = await getDefaultPlayer();
        if (p === 'apple' || p === 'spotify') setDefaultPlayer(p);
      } catch {
        /* noop */
      }
    })();
  }, [refreshing]);

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
    const { supabase } = await import('../../lib/supabase');
    const { error } = await supabase.from('listen_list').delete().eq('id', row.id);
    if (error) Alert.alert('Could not remove item', error.message);
    await load();
  };

  const onOpen = async (item: ListenRow) => {
    const ok = await openByDefaultPlayer(item);
    if (!ok) {
      const playerName = defaultPlayer === 'apple' ? 'Apple Music' : 'Spotify';
      Alert.alert(
        'Couldn’t open',
        `Tried ${playerName} first, then the fallback. Neither worked.\nTip: switch your default player in Settings and try again.`
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#eee',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700' }}>Your Listen List</Text>
            <DefaultBadge player={defaultPlayer} />
          </View>

          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 18, fontWeight: '600' }}>
                  Nothing here yet
                </Text>
                <Text style={{ marginTop: 8, color: '#666' }}>
                  Find an artist in Search and tap “Add to Listen List”.
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
                <Text style={{ fontWeight: '600' }} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={{ color: '#666' }} numberOfLines={1}>
                  {item.artist_name}
                </Text>

                <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                  <Pressable onPress={() => onOpen(item)}>
                    <Text style={{ color: '#22c55e', fontWeight: '700' }}>Open</Text>
                  </Pressable>
                  <Pressable onPress={() => toggleDone(item)}>
                    <Text style={{ color: '#2563eb' }}>
                      {item.done_at ? 'Mark not done' : 'Mark done'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removeItem(item)}>
                    <Text style={{ color: '#ef4444' }}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </>
      )}
    </SafeAreaView>
  );
}
