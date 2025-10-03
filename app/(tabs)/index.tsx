// app/(tabs)/listen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    Pressable,
    RefreshControl,
    SafeAreaView,
    Text,
    View
} from 'react-native';
import {
    fetchListenList,
    markDone,
    openInAppleMusic,
    openInSpotify,
    removeListen,
    type ListenRow,
} from '../../lib/listen';
import { getDefaultPlayer } from '../../lib/user';

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [defaultPlayer, setDefaultPlayer] = useState<'apple' | 'spotify'>('apple');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchListenList();
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const p = await getDefaultPlayer();
      setDefaultPlayer(p);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleDone = async (row: ListenRow) => {
    const ok = await markDone(row.id, !row.done_at);
    if (!ok) Alert.alert('Could not update item');
    await load();
  };

  const onRemove = async (row: ListenRow) => {
    Alert.alert('Remove from Listen List', row.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const ok = await removeListen(row.id);
          if (!ok) Alert.alert('Could not remove item');
          await load();
        },
      },
    ]);
  };

  const openDefault = async (row: ListenRow) => {
    if (defaultPlayer === 'spotify') {
      await openInSpotify(row);
    } else {
      await openInAppleMusic(row);
    }
  };

  const openChooser = async (row: ListenRow) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: row.title,
      message: row.artist_name ?? undefined,
          options: ['Open in Apple Music', 'Open in Spotify', 'Cancel'],
          cancelButtonIndex: 2,
        },
        async (index) => {
          if (index === 0) await openInAppleMusic(row);
          if (index === 1) await openInSpotify(row);
        }
      );
    } else {
      Alert.alert(
        row.title,
          row.artist_name ?? undefined,
        [
          { text: 'Apple Music', onPress: () => openInAppleMusic(row) },
          { text: 'Spotify', onPress: () => openInSpotify(row) },
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true }
      );
    }
  };

  const renderRow = ({ item }: { item: ListenRow }) => {
    const when =
      item.release_date ? new Date(item.release_date).toLocaleDateString() : '—';

    return (
      <View
        style={{
          padding: 12,
          marginHorizontal: 16,
          marginVertical: 8,
          borderRadius: 12,
          backgroundColor: '#fff',
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
        <Text style={{ color: '#555', marginTop: 2 }}>{item.artist_name}</Text>
        <Text style={{ color: '#888', marginTop: 2 }}>
          {item.item_type.toUpperCase()} · {when}
        </Text>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable
            onPress={() => openDefault(item)}
            onLongPress={() => openChooser(item)}
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: pressed ? '#e8f0ff' : '#eef4ff',
            })}
          >
            <Text style={{ color: '#1b5cff', fontWeight: '600' }}>
              Open ({defaultPlayer})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => toggleDone(item)}
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: pressed ? '#e8ffe8' : '#efffed',
            })}
          >
            <Text style={{ color: '#15803d', fontWeight: '600' }}>
              {item.done_at ? 'Mark undone' : 'Mark done'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => onRemove(item)}
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: pressed ? '#ffe8e8' : '#ffefef',
              marginLeft: 'auto',
            })}
          >
            <Text style={{ color: '#b91c1c', fontWeight: '600' }}>Remove</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f7f7f7' }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontSize: 22, fontWeight: '800' }}>Listen</Text>
        <Text style={{ color: '#666' }}>
          Tip: long-press “Open” to choose Apple/Spotify per item.
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
            Your Listen List
          </Text>
          <Text style={{ color: '#666' }}>
            Nothing here yet. Find an artist in Search / Artist and tap “Add to
            Listen List”.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </SafeAreaView>
  );
}
