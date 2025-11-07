import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';
import Screen from '../components/Screen';
import { formatDate } from '../lib/date';
import { getNewReleasesByGenre, type SimpleAlbum } from '../lib/recommend';

const GENRES = ['rap','rnb','pop','rock','latin','edm','country','kpop','afrobeats','jazz','indie','metal','punk','folk','ambient','jpop','desi'];

export default function NewReleasesAllGenres() {
  const [buckets, setBuckets] = useState<Record<string, SimpleAlbum[]>>({});

  useEffect(() => {
    (async () => {
      const data = await getNewReleasesByGenre({ genres: GENRES, days: 28, strict: false, mode: 'full' });
      setBuckets(data);
    })();
  }, []);

  const lanes = GENRES.filter((g) => Array.isArray(buckets[g]) && (buckets[g] as any).length > 0);

  return (
    <Screen>
      <Text style={{ fontSize: 20, fontWeight: '800', marginTop: 6, marginBottom: 4 }}>Genres · New releases</Text>
      <FlatList
        data={lanes}
        keyExtractor={(g) => g}
        renderItem={({ item: g }) => {
          const preview = (buckets[g] || []).slice(0, 12);
          return (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', textTransform: 'capitalize' }}>{g}</Text>
                <Pressable onPress={() => router.push(`/new-releases/${g}`)}>
                  <Text style={{ color: '#2563eb', fontWeight: '700' }}>See all</Text>
                </Pressable>
              </View>
              <FlatList
                data={preview}
                keyExtractor={(a) => `${g}-${a.id}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingRight: 8 }}
                renderItem={({ item }) => (
                  <View style={{ width: 140 }}>
                    <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 140, height: 140, borderRadius: 8, backgroundColor: '#e5e7eb' }} />
                    <Text style={{ fontWeight: '700', marginTop: 6 }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: '#666' }} numberOfLines={1}>{item.artist}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      {!!item.type && (
                        <Text style={{ color: '#3730a3', fontSize: 10, fontWeight: '800' }}>{String(item.type).toUpperCase()}</Text>
                      )}
                      {!!item.releaseDate && <Text style={{ color: '#6b7280' }}>{formatDate(item.releaseDate)}</Text>}
                    </View>
                  </View>
                )}
              />
            </View>
          );
        }}
      />
    </Screen>
  );
}
