// app/(tabs)/listen.tsx
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from 'react-native';
import { fetchListenList, ListenRow, markDone, removeListen } from '../lib/queries';

export default function ListenScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ListenRow[]>([]);

  async function load() {
    setLoading(true);
    const data = await fetchListenList();
    setRows(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const onToggleDone = async (id: string, current: boolean) => {
    const ok = await markDone(id, !current);
    if (ok) {
      setRows(prev =>
        prev.map(r => (r.id === id ? { ...r, done_at: current ? null : new Date().toISOString() } : r))
      );
    } else {
      Alert.alert('Error', 'Could not update item.');
    }
  };

  const onRemove = async (id: string) => {
    const ok = await removeListen(id);
    if (ok) setRows(prev => prev.filter(r => r.id !== id));
    else Alert.alert('Error', 'Could not remove item.');
  };

  const renderItem = ({ item }: { item: ListenRow }) => {
    const isDone = !!item.done_at;
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 12,
          borderBottomWidth: 1,
          borderColor: '#eee',
          gap: 12,
        }}
      >
        {item.artwork_url ? (
          <Image
            source={{ uri: item.artwork_url }}
            style={{ width: 56, height: 56, borderRadius: 8 }}
          />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#ddd' }} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
          <Text style={{ color: '#666' }}>
            {item.artist_name} • {item.item_type}
          </Text>
          <Text style={{ color: '#999', fontSize: 12 }}>
            Added {new Date(item.created_at).toLocaleDateString()}
            {isDone ? ' • Done' : ''}
          </Text>
        </View>

        <Pressable
          onPress={() => onToggleDone(item.id, isDone)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: isDone ? '#eee' : '#2f6',
            marginRight: 8,
          }}
        >
          <Text style={{ fontWeight: '600' }}>{isDone ? 'Undo' : 'Done'}</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            Alert.alert('Remove', 'Remove this from your Listen List?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => onRemove(item.id) },
            ])
          }
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: '#fee',
          }}
        >
          <Text style={{ fontWeight: '600', color: '#900' }}>Remove</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', padding: 16 }}>Your Listen List</Text>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: '#555' }}>
            Nothing here yet. Find an artist in Search and tap “Add to Listen List”.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}
