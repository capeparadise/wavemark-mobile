// app/(tabs)/listen.tsx
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, SafeAreaView, Text, View } from 'react-native';
import { fetchListenList, markDone, removeListen, type ListenRow } from '../lib/listen';

export default function ListenTab() {
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await fetchListenList();
    setRows(data);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

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

  const remove = async (row: ListenRow) => {
    const ok = await removeListen(row.id);
    if (!ok) Alert.alert('Could not remove item');
    await load();
  };

  const openInApple = (row: ListenRow) => {
    // Apple Music web URL form
    const url =
      row.item_type === 'track'
        ? `https://music.apple.com/gb/song/${row.provider_id}`
        : `https://music.apple.com/gb/album/${row.provider_id}`;
    Linking.openURL(url);
  };

  const openInSpotify = (row: ListenRow) => {
    // We don't have Spotify IDs yet; fall back to a web search using title + artist
    const q = encodeURIComponent(`${row.title} ${row.artist_name} site:open.spotify.com`);
    Linking.openURL(`https://www.google.com/search?q=${q}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Listen List</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <View style={{ padding: 16 }}>
            <Text>Your list is empty. Add tracks or albums from Search or Artist pages.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              borderWidth: 1,
              borderColor: '#e5e5e5',
              borderRadius: 12,
              padding: 12,
              gap: 6,
            }}
          >
            <Text style={{ fontWeight: '600' }}>{item.title}</Text>
            <Text style={{ opacity: 0.7 }}>{item.artist_name}</Text>
            <Text style={{ opacity: 0.6, fontSize: 12 }}>
              {item.item_type.toUpperCase()}
              {item.release_date ? ` • ${new Date(item.release_date).toLocaleDateString()}` : ''}
              {item.done_at ? ' • DONE' : ''}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <Pressable onPress={() => toggleDone(item)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8 }}>
                <Text>{item.done_at ? 'Mark as not done' : 'Mark done'}</Text>
              </Pressable>
              <Pressable onPress={() => openInApple(item)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8 }}>
                <Text>Open in Apple</Text>
              </Pressable>
              <Pressable onPress={() => openInSpotify(item)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8 }}>
                <Text>Open in Spotify</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Alert.alert('Remove', 'Remove this from your list?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => remove(item) },
                  ]);
                }}
                style={{ marginLeft: 'auto', paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8 }}
              >
                <Text>Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
