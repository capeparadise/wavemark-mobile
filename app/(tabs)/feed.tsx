import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, SectionList, Text, View } from 'react-native';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import Snackbar from '../../components/Snackbar';
import { formatDate } from '../../lib/date';
import { off, on } from '../../lib/events';
import { fetchFeed } from '../../lib/follow';
import { addToListFromSearch, removeListen } from '../../lib/listen';

type Item = Awaited<ReturnType<typeof fetchFeed>>[number];

export default function FeedTab() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [checkerRunning, setCheckerRunning] = useState(false);
  const [snack, setSnack] = useState<{ visible: boolean; message: string; listenId?: string | null; feedId?: string | null }>({ visible: false, message: '', listenId: null, feedId: null });

  const load = async () => {
    setLoading(true);
    const data = await fetchFeed();
    setRows(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useFocusEffect(useCallback(() => { load(); }, []));
  useEffect(() => {
    const handler = () => load();
    on('feed:refresh', handler);
    return () => off('feed:refresh', handler);
  }, []);
  // Helpers
  const todayStr = new Date().toISOString().slice(0,10);
  const yesterdayStr = new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,10);
  const isNew = (d?: string | null) => {
    if (!d) return false;
    const ts = Date.parse(d);
    if (Number.isNaN(ts)) return false;
    const ms = Date.now() - ts;
    const days = ms / (24*60*60*1000);
    return days >= 0 && days < 7;
  };
  const labelForDate = (d?: string | null) => {
    if (!d) return 'Unknown date';
    if (d === todayStr) return 'Today';
    if (d === yesterdayStr) return 'Yesterday';
    return formatDate(d);
  };
  const sections = useMemo(() => {
    const byDay = new Map<string, Item[]>();
    for (const r of rows) {
      const key = r.release_date ?? 'Unknown date';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(r);
    }
    // sort section keys by date desc; unknown at end
    const keys = Array.from(byDay.keys());
    keys.sort((a, b) => {
      if (a === 'Unknown date') return 1;
      if (b === 'Unknown date') return -1;
      const ta = Date.parse(a);
      const tb = Date.parse(b);
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });
    return keys.map(k => ({ title: labelForDate(k === 'Unknown date' ? null : k), data: byDay.get(k)! }));
  }, [rows]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, []);

  const onAdd = async (r: Item) => {
    const res = await addToListFromSearch({
      type: 'album',
      title: r.title,
      artist: r.artist_name ?? null,
      releaseDate: r.release_date ?? null,
      spotifyUrl: r.spotify_url ?? null,
      appleUrl: null,
    });
    if (res.ok) {
      H.success();
      setAdded(prev => ({ ...prev, [r.id]: true }));
      setSnack({
        visible: true,
        message: `Added ${r.title}`,
        listenId: res.id ?? null,
        feedId: r.id,
      });
    } else {
      H.error();
      Alert.alert(res.message || 'Could not add');
    }
  };

  const runCheckerNow = async () => {
    const base = process.env.EXPO_PUBLIC_FN_BASE ?? '';
    if (!base) {
      Alert.alert('Missing function base URL');
      return;
    }
    try {
      setCheckerRunning(true);
      await fetch(`${base}/check-new-releases`);
      await load();
      H.success();
    } catch (e) {
      Alert.alert('Failed to run checker');
      H.error();
    } finally {
      setCheckerRunning(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 22, fontWeight: '700' }}>Feed</Text>
          <Text style={{ marginTop: 6, color: '#666' }}>New releases from artists you follow</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={onRefresh} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
            <Text style={{ fontWeight: '700', color: '#111827' }}>Refresh</Text>
          </Pressable>
          <Pressable onPress={runCheckerNow} disabled={checkerRunning} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: checkerRunning ? '#d1d5db' : '#111827' }}>
            <Text style={{ fontWeight: '700', color: checkerRunning ? '#374151' : 'white' }}>{checkerRunning ? 'Running…' : 'Run checker'}</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}
          ListEmptyComponent={<Text style={{ marginTop: 16, color: '#6b7280' }}>Follow some artists to get release updates.</Text>}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={{ marginTop: 12, marginBottom: 6, color: '#6b7280', fontSize: 12, fontWeight: '700' }}>
              {(() => {
                if (title === 'Unknown date') return 'Earlier';
                const ts = Date.parse(title);
                if (!Number.isNaN(ts)) {
                  const days = (Date.now() - ts) / (24*60*60*1000);
                  if (days < 7) return `This week · ${title}`;
                }
                return title;
              })()}
            </Text>
          )}
          renderItem={({ item }) => {
            // derive album id from spotify_url to fetch artwork via /lookup if desired
            // quick-and-dirty thumb from open.spotify.com image CDN is not public; prefer lookup later
            const onOpen = () => item.spotify_url && router.push(item.spotify_url as any);
            // Prefetch cover if present
            if (item.image_url) {
              Image.prefetch(item.image_url).catch(() => {});
            }
            return (
              <View style={{
                marginHorizontal: 2,
                marginVertical: 6,
                padding: 12,
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 12,
                backgroundColor: 'white',
                shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Artwork */}
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: '#f3f4f6', marginRight: 12 }} />
                  ) : (
                    <View style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Text style={{ color: '#9ca3af', fontWeight: '800' }}>{(item.artist_name ?? '?').slice(0,1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>{item.title}</Text>
                      {isNew(item.release_date) && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#fef3c7', borderRadius: 6, borderWidth: 1, borderColor: '#facc15' }}>
                          <Text style={{ color: '#92400e', fontSize: 10, fontWeight: '800' }}>NEW</Text>
                        </View>
                      )}
                      {!!item.release_type && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#eef2ff', borderRadius: 6, borderWidth: 1, borderColor: '#c7d2fe' }}>
                          <Text style={{ color: '#3730a3', fontSize: 10, fontWeight: '800' }}>{item.release_type.toUpperCase()}</Text>
                        </View>
                      )}
                    </View>
                    {!!item.artist_name && <Text style={{ color: '#6b7280' }} numberOfLines={1}>{item.artist_name}</Text>}
                    {!!item.release_date && <Text style={{ color: '#9ca3af', marginTop: 2 }}>{formatDate(item.release_date)}</Text>}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                  {!!item.spotify_url && (
                    <Pressable onPress={onOpen} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#111827' }}>
                      <Text style={{ color: 'white', fontWeight: '700' }}>Open</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => onAdd(item)}
                    disabled={!!added[item.id]}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: added[item.id] ? '#d1d5db' : '#0a7' }}
                  >
                    <Text style={{ color: added[item.id] ? '#374151' : 'white', fontWeight: '700' }}>
                      {added[item.id] ? 'Added' : 'Add to Listen'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
      <Snackbar
        visible={snack.visible}
        message={snack.message}
        onAction={snack.listenId ? async () => {
          try {
            if (snack.listenId) {
              const res = await removeListen(snack.listenId);
              if (!res.ok) throw new Error(res.message || 'Undo failed');
              if (snack.feedId) setAdded(prev => ({ ...prev, [snack.feedId!]: false }));
              H.success();
            }
          } catch (e) {
            H.error();
          } finally {
            setSnack({ visible: false, message: '', listenId: null, feedId: null });
          }
        } : undefined}
        onTimeout={() => setSnack({ visible: false, message: '', listenId: null, feedId: null })}
      />
    </Screen>
  );
}
