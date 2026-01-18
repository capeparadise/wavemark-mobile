// app/artist/[id].tsx
import { Image } from 'expo-image';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import {
    AppleArtist,
    fetchAlbumsByType,
    fetchArtistById,
    fetchTopTracks,
} from '../../lib/apple';
import { addToListenList, type AppleAlbum, type AppleTrack } from '../../lib/listen';
import { toast } from '../../lib/toast';
import Screen from '../../components/Screen';
import { useTheme } from '../../theme/useTheme';

export default function ArtistScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [artist, setArtist] = useState<AppleArtist | null>(null);
  const [tracks, setTracks] = useState<AppleTrack[]>([]);
  const [albums, setAlbums] = useState<AppleAlbum[]>([]);
  const [eps, setEps] = useState<AppleAlbum[]>([]);

  // normalize: prefer artist.artistName, fall back to artist.name, then route param
  const displayName =
    (artist as any)?.artistName ??
    (artist as any)?.name ??
    params.name ??
    'Artist';

  type SectionProps<T> = {
    title: string;
    data: T[];
    renderItem: ({ item }: { item: T }) => React.ReactElement;
    seeAllHref: any; // keep loose to avoid strict Link typing complaints
  };

  const pill = {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.secondary,
  } as const;

  const card = {
    width: 220,
    marginRight: 12,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.secondary,
  } as const;

  function Section<T>({ title, data, renderItem, seeAllHref }: SectionProps<T>) {
    return (
      <View style={{ marginTop: 18 }}>
        <View style={{ paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text.secondary }}>{title}</Text>
          <Link href={seeAllHref} style={{ color: colors.accent.primary, fontWeight: '700' }}>See all</Link>
        </View>
        <FlatList
          data={data}
          keyExtractor={(_, i) => String(i)}
          horizontal
          showsHorizontalScrollIndicator={false}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10 }}
        />
      </View>
    );
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const a = await fetchArtistById(Number(id));
        setArtist(a);
        const [tops, albumList, epList] = await Promise.all([
          fetchTopTracks(Number(id)),
          fetchAlbumsByType(Number(id), 'album'),
          fetchAlbumsByType(Number(id), 'ep'),
        ]);
  // cast incoming apple types to the listen shapes
  setTracks(tops as unknown as AppleTrack[]);
  setAlbums(albumList as unknown as AppleAlbum[]);
  setEps(epList as unknown as AppleAlbum[]);
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'Could not load artist.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onAddTrack = async (track: AppleTrack) => {
    const res = await addToListenList('track', track);
    if (!res.ok) {
      Alert.alert('Could not add', res.message ?? 'Please try again.');
      return;
    }
    toast('Added to Listen List');
  };

  const onAddAlbum = async (album: AppleAlbum) => {
    const res = await addToListenList('album', album);
    if (!res.ok) {
      Alert.alert('Could not add', res.message ?? 'Please try again.');
      return;
    }
    toast('Added to Listen List');
  };

  const header = useMemo(
    () => (
      <View style={{ paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={pill}>
          <Text style={{ fontWeight: '700', color: colors.text.secondary }}>{'‹'} Back</Text>
        </Pressable>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text.secondary }} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={{ width: 64 }} />
      </View>
    ),
    [colors.text.secondary, displayName, pill, router]
  );

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.text.muted} />
        </View>
      </Screen>
    );
  }

  if (!artist) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.text.muted }}>Artist not found.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
          <Text style={{ color: colors.text.muted }}>{(artist as any).primaryGenreName ?? ''}</Text>
        </View>

        {/* Top tracks */}
        <Section<AppleTrack>
          title="Top tracks"
          data={tracks.slice(0, 12)}
          seeAllHref={{ pathname: '/artist/[id]/discography', params: { id: String(id), name: displayName, tab: 'tracks' } }}
          renderItem={({ item }) => (
            <View style={card}>
              <Image source={{ uri: (item as any).artworkUrl ?? (item as any).artworkUrl100 ?? null }} style={{ width: 200, height: 200, borderRadius: 12, backgroundColor: colors.bg.muted }} contentFit="cover" />
              <Text style={{ marginTop: 8, fontSize: 16, fontWeight: '700', color: colors.text.secondary }} numberOfLines={2}>{item.trackName}</Text>
              <Text style={{ color: colors.text.muted }} numberOfLines={1}>{item.artistName}</Text>
              <Pressable onPress={() => onAddTrack(item)} style={[pill, { marginTop: 8, alignSelf: 'flex-start', backgroundColor: colors.accent.primary, borderColor: colors.accent.primary }]}>
                <Text style={{ fontWeight: '700', color: colors.text.inverted }}>Add to Listen List</Text>
              </Pressable>
            </View>
          )}
        />

        {/* Albums */}
        <Section<AppleAlbum>
          title="Albums"
          data={albums.slice(0, 12)}
          seeAllHref={{ pathname: '/artist/[id]/discography', params: { id: String(id), name: displayName, tab: 'albums' } }}
          renderItem={({ item }) => (
            <View style={card}>
              <Image source={{ uri: (item as any).artworkUrl ?? (item as any).artworkUrl100 ?? null }} style={{ width: 200, height: 200, borderRadius: 12, backgroundColor: colors.bg.muted }} contentFit="cover" />
              <Text style={{ marginTop: 8, fontSize: 16, fontWeight: '700', color: colors.text.secondary }} numberOfLines={2}>{item.collectionName}</Text>
              <Text style={{ color: colors.text.muted }} numberOfLines={1}>{item.artistName}</Text>
              <Pressable onPress={() => onAddAlbum(item)} style={[pill, { marginTop: 8, alignSelf: 'flex-start', backgroundColor: colors.accent.primary, borderColor: colors.accent.primary }]}>
                <Text style={{ fontWeight: '700', color: colors.text.inverted }}>Add to Listen List</Text>
              </Pressable>
            </View>
          )}
        />

        {/* EPs */}
        <Section<AppleAlbum>
          title="EPs"
          data={eps.slice(0, 12)}
          seeAllHref={{ pathname: '/artist/[id]/discography', params: { id: String(id), name: displayName, tab: 'eps' } }}
          renderItem={({ item }) => (
            <View style={card}>
              <Image source={{ uri: (item as any).artworkUrl ?? (item as any).artworkUrl100 ?? null }} style={{ width: 200, height: 200, borderRadius: 12, backgroundColor: colors.bg.muted }} contentFit="cover" />
              <Text style={{ marginTop: 8, fontSize: 16, fontWeight: '700', color: colors.text.secondary }} numberOfLines={2}>{item.collectionName}</Text>
              <Text style={{ color: colors.text.muted }} numberOfLines={1}>{item.artistName}</Text>
              <Pressable onPress={() => onAddAlbum(item)} style={[pill, { marginTop: 8, alignSelf: 'flex-start', backgroundColor: colors.accent.primary, borderColor: colors.accent.primary }]}>
                <Text style={{ fontWeight: '700', color: colors.text.inverted }}>Add to Listen List</Text>
              </Pressable>
            </View>
          )}
        />
      </ScrollView>
    </Screen>
  );
}
