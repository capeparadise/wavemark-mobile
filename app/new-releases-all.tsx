import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, Text, View, Modal } from 'react-native';
import Screen from '../components/Screen';
import { formatDate } from '../lib/date';
import { addToListFromSearch } from '../lib/listen';
import { getNewReleasesWide, type SimpleAlbum } from '../lib/recommend';
import { filterReleasesByGenres, loadIncludedGenres, saveIncludedGenres, type CanonicalGenre } from '../lib/styleFilters';
import GlassCard from '../components/GlassCard';
import Chip from '../components/Chip';
import { useTheme } from '../theme/useTheme';
import Ionicons from '@expo/vector-icons/Ionicons';

const GENRE_OPTIONS: { key: CanonicalGenre | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'hiphop', label: 'Hip-Hop' },
  { key: 'rnb', label: 'R&B' },
  { key: 'pop', label: 'Pop' },
  { key: 'rock', label: 'Rock' },
  { key: 'indie', label: 'Indie' },
  { key: 'electronic', label: 'Electronic' },
  { key: 'afrobeats', label: 'Afrobeats' },
  { key: 'latin', label: 'Latin' },
  { key: 'country', label: 'Country' },
  { key: 'jazz', label: 'Jazz' },
  { key: 'classical', label: 'Classical' },
  { key: 'metal', label: 'Metal' },
  { key: 'gospel', label: 'Gospel' },
];

export default function NewReleasesAll() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<SimpleAlbum[]>([]);
  const [filtered, setFiltered] = useState<SimpleAlbum[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<Set<CanonicalGenre>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);
  const [draftGenres, setDraftGenres] = useState<Set<string>>(new Set(['all']));
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [list, genres] = await Promise.all([getNewReleasesWide(28, 400), loadIncludedGenres()]);
      setSelectedGenres(genres);
      setDraftGenres(genres.size ? new Set(genres) : new Set(['all']));
      setRows(list);
      const filteredList = await filterReleasesByGenres(list, genres);
      setFiltered(filteredList);
    } catch (e: any) {
      Alert.alert('Failed to load new releases');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setDraftGenres(selectedGenres.size ? new Set(selectedGenres) : new Set(['all']));
  }, [selectedGenres]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    (async () => {
      const filteredList = await filterReleasesByGenres(rows, selectedGenres);
      setFiltered(filteredList);
    })();
  }, [rows, selectedGenres]);

  const toggleDraftGenre = (key: CanonicalGenre | 'all') => {
    setDraftGenres((prev) => {
      const next = new Set(prev);
      if (key === 'all') {
        return new Set(['all']);
      }
      next.delete('all');
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add('all');
      return next;
    });
  };

  const applyGenres = async () => {
    const next = draftGenres.has('all') ? new Set<CanonicalGenre>() : new Set(Array.from(draftGenres) as CanonicalGenre[]);
    setSelectedGenres(next);
    await saveIncludedGenres(next);
    setModalVisible(false);
  };

  const clearGenres = async () => {
    setDraftGenres(new Set(['all']));
    const empty = new Set<CanonicalGenre>();
    setSelectedGenres(empty);
    await saveIncludedGenres(empty);
  };

  const renderRow = useCallback(({ item }: { item: SimpleAlbum }) => {
    const presave = !!(item.releaseDate && item.releaseDate > new Date().toISOString().slice(0,10));
    return (
      <GlassCard asChild style={{ marginVertical: 4, padding: 0 }}>
        <View style={{ paddingVertical: 10, paddingHorizontal: 8, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Image source={{ uri: item.imageUrl ?? undefined }} style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: colors.bg.muted }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', flexShrink: 1, color: colors.text.secondary }} numberOfLines={1}>{item.title}</Text>
              {!!item.type && (
                <Text style={{ fontSize: 10, fontWeight: '800', color: colors.accent.primary, backgroundColor: colors.accent.primary + '1a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  {item.type.toUpperCase()}
                </Text>
              )}
            </View>
            <Text style={{ color: colors.text.muted }} numberOfLines={1}>{item.artist}</Text>
            {!!item.releaseDate && (
              <Text style={{ color: presave ? colors.accent.success : colors.text.muted }}>
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
            <Text style={{ color: colors.accent.success, fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>
      </GlassCard>
    );
  }, [colors]);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary }}>More new releases</Text>
        <Pressable onPress={() => setModalVisible(true)} hitSlop={8} style={{ padding: 10, borderRadius: 10, backgroundColor: colors.bg.muted }}>
          <Ionicons name="options-outline" size={20} color={colors.text.secondary} />
        </Pressable>
      </View>
      {busy && (
        <View style={{ paddingVertical: 8 }}>
          <ActivityIndicator />
        </View>
      )}
  <FlatList
        data={filtered}
        keyExtractor={(a) => a.id}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={renderRow}
      />
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setModalVisible(false)} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 }}>
          <GlassCard style={{ padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary, marginBottom: 10 }}>Filter by genre</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {GENRE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.key}
                  label={opt.label}
                  selected={draftGenres.has(opt.key)}
                  onPress={() => toggleDraftGenre(opt.key)}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
              <Pressable onPress={clearGenres} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.bg.muted }}>
                <Text style={{ textAlign: 'center', fontWeight: '700', color: colors.text.secondary }}>Clear filters</Text>
              </Pressable>
              <Pressable onPress={applyGenres} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent.primary }}>
                <Text style={{ textAlign: 'center', fontWeight: '800', color: colors.text.inverted }}>Apply</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>
    </Screen>
  );
}
