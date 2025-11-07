import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, Text, View } from 'react-native';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import { formatDate } from '../../lib/date';
import { addToListFromSearch } from '../../lib/listen';
import { getNewReleasesByGenre, type SimpleAlbum } from '../../lib/recommend';

export default function NewReleasesByGenre() {
  const { genre } = useLocalSearchParams<{ genre: string }>();
  const [rows, setRows] = useState<SimpleAlbum[]>([]);

  useEffect(() => {
    (async () => {
      const key = String(genre || '').toLowerCase();
      const buckets = await getNewReleasesByGenre({ genres: [key], days: 28, strict: true });
      let list: any[] = (buckets as any)[key] ?? [];
      if (!Array.isArray(list) || list.length === 0) {
        const looser = await getNewReleasesByGenre({ genres: [key], days: 28, strict: false });
        list = (looser as any)[key] ?? [];
      }
      setRows(list as any);
    })();
  }, [genre]);

  return (
    <Screen>
      <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ paddingVertical: 4, paddingHorizontal: 8 }}>
          <Text style={{ fontWeight: '800' }}>{'<'}</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>New releases · {String(genre || '').toUpperCase()}</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(a) => `${genre}-${a.id}`}
        contentContainerStyle={{ padding: 12, gap: 12 }}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 72, height: 72, borderRadius: 6, backgroundColor: '#e5e7eb' }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{item.title}</Text>
              <Text style={{ color: '#666' }}>{item.artist}</Text>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                {!!item.type && (
                  <Text style={{ color: '#3730a3', fontSize: 10, fontWeight: '800' }}>{String(item.type).toUpperCase()}</Text>
                )}
                {!!item.releaseDate && <Text style={{ color: '#6b7280' }}>{formatDate(item.releaseDate)}</Text>}
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
                  if (res.ok) { H.success(); } else { H.error(); Alert.alert(res.message || 'Could not save'); }
                }}
                style={{ marginTop: 6 }}
              >
                <Text style={{ fontWeight: '700' }}>Add to Listen</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}
