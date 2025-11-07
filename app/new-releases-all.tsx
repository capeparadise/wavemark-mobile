import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, Text, View } from 'react-native';
import Screen from '../components/Screen';
import { formatDate } from '../lib/date';
import { addToListFromSearch } from '../lib/listen';
import { getNewReleasesWide, type SimpleAlbum } from '../lib/recommend';

export default function NewReleasesAll() {
  const [rows, setRows] = useState<SimpleAlbum[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const list = await getNewReleasesWide(28, 400);
      setRows(list);
    } catch (e: any) {
      Alert.alert('Failed to load new releases');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <Screen>
  <Text style={{ fontSize: 20, fontWeight: '800', marginTop: 6, marginBottom: 8 }}>More new releases</Text>
      {busy && (
        <View style={{ paddingVertical: 8 }}>
          <ActivityIndicator />
        </View>
      )}
  <FlatList
        data={rows}
        keyExtractor={(a) => a.id}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={({ item }) => {
          const presave = !!(item.releaseDate && item.releaseDate > new Date().toISOString().slice(0,10));
          return (
            <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', gap: 12 }}>
              <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 60, height: 60, borderRadius: 6, backgroundColor: '#e5e7eb' }} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{item.title}</Text>
                  {!!item.type && (
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#3730a3', backgroundColor: '#eef2ff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      {item.type.toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text style={{ color: '#6b7280' }} numberOfLines={1}>{item.artist}</Text>
                {!!item.releaseDate && (
                  <Text style={{ color: presave ? '#0a7' : '#6b7280' }}>
                    {presave ? `Presave · ${formatDate(item.releaseDate)}` : `Released · ${formatDate(item.releaseDate)}`}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={async () => {
                  const res = await addToListFromSearch({
                    type: 'album',
                    title: item.title,
                    artist: item.artist,
                    releaseDate: item.releaseDate ?? null,
                    spotifyUrl: item.spotifyUrl ?? null,
                    appleUrl: null,
                  });
                  if (!res.ok) Alert.alert(res.message || 'Could not save');
                }}
                style={{ justifyContent: 'center' }}
              >
                <Text style={{ color: '#0a7', fontWeight: '700' }}>Save</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </Screen>
  );
}
