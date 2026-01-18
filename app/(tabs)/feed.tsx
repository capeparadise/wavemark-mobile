import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Pressable, ScrollView, SectionList, Text, View } from 'react-native';
import { H } from '../../components/haptics';
import Screen from '../../components/Screen';
import Snackbar from '../../components/Snackbar';
import GlassCard from '../../components/GlassCard';
import StatusMenu from '../../components/StatusMenu';
import { formatDate } from '../../lib/date';
import { off, on } from '../../lib/events';
import { fetchFeed } from '../../lib/follow';
import { addToListFromSearch, fetchListenList, removeListen } from '../../lib/listen';
import { RELEASE_LONG_PRESS_MS } from '../../hooks/useReleaseActions';
import { useTheme } from '../../theme/useTheme';

type Item = Awaited<ReturnType<typeof fetchFeed>>[number];

const hashString = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return Math.abs(h);
};

export default function FeedTab() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<'all' | 'album' | 'single' | 'ep' | 'new'>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [doneKeys, setDoneKeys] = useState<string[]>([]);
  const [inListKeys, setInListKeys] = useState<string[]>([]);
  const [menuRow, setMenuRow] = useState<any | null>(null);
  const [snack, setSnack] = useState<{ visible: boolean; message: string; listenId?: string | null; feedId?: string | null }>({ visible: false, message: '', listenId: null, feedId: null });
  const accentSoft = colors.accent.primary + '1a';
  const successSoft = colors.accent.success + '1a';
  const palette = useMemo(() => ([
    { bg: colors.bg.secondary, border: colors.border.subtle, text: colors.text.secondary },
    { bg: colors.bg.muted, border: colors.border.subtle, text: colors.text.secondary },
    { bg: accentSoft, border: colors.accent.primary, text: colors.text.secondary },
    { bg: successSoft, border: colors.accent.success, text: colors.text.secondary },
  ]), [accentSoft, colors, successSoft]);

  const load = async () => {
    setLoading(true);
    try {
      const [data, listenRows] = await Promise.all([fetchFeed(), fetchListenList().catch(() => [])]);
      const done = new Set<string>();
      const inList = new Set<string>();
      listenRows.filter(r => !!r.done_at).forEach((r) => {
        if (r.spotify_url) done.add(r.spotify_url);
        if (r.apple_url) done.add(r.apple_url);
        if (r.title && r.artist_name) done.add(`${r.title}__${r.artist_name}`);
      });
      (listenRows || []).forEach((r) => {
        if (r.spotify_url) inList.add(r.spotify_url);
        if (r.apple_url) inList.add(r.apple_url);
        if (r.provider_id) inList.add(String(r.provider_id));
        if ((r as any).spotify_id) inList.add(String((r as any).spotify_id));
        if (r.title && r.artist_name) inList.add(`${r.title}__${r.artist_name}`);
      });
      setDoneKeys(Array.from(done));
      setInListKeys(Array.from(inList));
      setRows(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  // Auto-refresh whenever the tab gains focus
  useFocusEffect(useCallback(() => { load(); }, []));
  useEffect(() => {
    const handler = () => load();
    on('feed:refresh', handler);
    return () => off('feed:refresh', handler);
  }, []);
  // Helpers
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isNew = (d?: string | null) => {
    if (!d) return false;
    const ts = Date.parse(d);
    if (Number.isNaN(ts)) return false;
    const ms = Date.now() - ts;
    const days = ms / (24 * 60 * 60 * 1000);
    return days >= 0 && days < 7;
  };
  const labelForDate = (d?: string | null) => {
    if (!d) return 'Unknown date';
    if (d === todayStr) return 'Today';
    if (d === yesterdayStr) return 'Yesterday';
    return formatDate(d);
  };
  const itemTypeOf = (r: Item): 'album' | 'single' | null => {
    const raw = (r as any).item_type ?? (r as any).release_type ?? null;
    const t = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (t === 'album') return 'album';
    if (t === 'single') return 'single';
    return null;
  };
  const filteredRows = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'new') return isNew(r.release_date);
    return itemTypeOf(r) === filter;
  }), [rows, filter]);
  const doneSet = useMemo(() => new Set(doneKeys), [doneKeys]);
  const inListSet = useMemo(() => new Set(inListKeys), [inListKeys]);
  const remainingCount = useMemo(() => filteredRows.filter((r) => {
    const key = r.spotify_url ?? (r.title && r.artist_name ? `${r.title}__${r.artist_name}` : null);
    if (!key) return true;
    return !doneSet.has(key);
  }).length, [filteredRows, doneSet]);
  const sections = useMemo(() => {
    const byDay = new Map<string, Item[]>();
    for (const r of filteredRows) {
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
  }, [filteredRows]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runCheckerNow();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onAdd = async (r: Item) => {
    const itemType = itemTypeOf(r);
    const res = await addToListFromSearch({
      // Store singles as tracks to satisfy DB constraint on item_type
      type: itemType === 'album' ? 'album' : 'track',
      title: r.title,
      artist: r.artist_name ?? null,
      releaseDate: r.release_date ?? null,
      spotifyUrl: r.spotify_url ?? null,
      appleUrl: r.apple_url ?? null,
      artworkUrl: r.artwork_url ?? null,
      providerId: (r as any).provider_id ?? r.spotify_id ?? (r as any).apple_id ?? (r as any).external_id ?? null,
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
      await fetch(`${base}/check-new-releases`);
      H.success();
    } catch (e) {
      Alert.alert('Failed to run checker');
      H.error();
    }
  };

  const newCount = useMemo(() => filteredRows.filter(r => isNew(r.release_date)).length, [filteredRows]);
  const heroDate = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), []);
  const avatarStack = useMemo(() => filteredRows.filter(r => !!r.image_url).slice(0, 5), [filteredRows]);

  const filterOptions = [
    { key: 'all', label: 'All' },
    { key: 'album', label: 'Albums' },
    { key: 'single', label: 'Singles' },
    { key: 'ep', label: 'EPs' },
    { key: 'new', label: 'New this week' },
  ];

  return (
    <Screen>
      <View style={{ marginHorizontal: -8, marginBottom: 10, paddingTop: 4 }}>
        <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: 'transparent' }}>
          <View style={{ position: 'absolute', top: -40, right: -10, width: 120, height: 120, backgroundColor: colors.accent.primary, opacity: 0.2, borderRadius: 999 }} />
          <View style={{ position: 'absolute', bottom: -30, left: -14, width: 110, height: 110, backgroundColor: colors.accent.success, opacity: 0.2, borderRadius: 999 }} />
          <BlurView intensity={20} tint="dark" style={{ padding: 16, borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '700' }}>{heroDate}</Text>
                <Text style={{ color: colors.text.inverted, fontSize: 26, fontWeight: '800', marginTop: 4 }}>Feed</Text>
                <Text style={{ color: colors.text.subtle, marginTop: 6 }}>New releases from artists you follow</Text>
            {newCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: accentSoft, borderWidth: 1, borderColor: colors.accent.primary }}>
                  <Text style={{ color: colors.accent.primary, fontWeight: '800', letterSpacing: 0.3 }}>{newCount} new this week</Text>
                </View>
              </View>
            )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={{ flexDirection: 'row' }}>
                  {avatarStack.map((r, idx) => (
                    <Image key={r.id} source={{ uri: r.image_url! }} style={{ width: 34, height: 34, borderRadius: 999, borderWidth: 2, borderColor: colors.border.strong, marginLeft: idx === 0 ? 0 : -10, backgroundColor: colors.bg.elevated }} />
                  ))}
                  {avatarStack.length === 0 && (
                    <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.strong }}>
                      <Text style={{ color: colors.text.muted, fontWeight: '800' }}>?</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </BlurView>
        </View>
      </View>

      <View style={{ marginBottom: 8 }}>
        <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 10,
          paddingHorizontal: 4,
          paddingVertical: 6,
          maxHeight: filtersExpanded ? undefined : 52,
          overflow: 'hidden',
        }}>
          {filterOptions.map(({ key, label }) => {
            const selected = filter === key;
            return (
              <Pressable key={key} onPress={() => setFilter(key as any)}>
                <View style={{
                  paddingHorizontal: 16,
                paddingVertical: 12,
                borderRadius: 20,
                backgroundColor: selected ? colors.accent.primary : colors.bg.muted,
                minHeight: 40,
                borderWidth: selected ? 0 : 1,
                borderColor: selected ? colors.accent.primary : colors.border.subtle,
                shadowColor: colors.shadow.light,
                shadowOpacity: selected ? 0.12 : 0.04,
                shadowRadius: selected ? 8 : 4,
                shadowOffset: { width: 0, height: 2 },
              }}>
                <Text style={{ color: selected ? colors.text.inverted : colors.text.secondary, fontWeight: '800', lineHeight: 18 }}>{label}</Text>
              </View>
            </Pressable>
          );
          })}
        </View>
        <Pressable
          onPress={() => setFiltersExpanded(v => !v)}
          style={{ alignSelf: 'flex-start', marginLeft: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.bg.muted }}
        >
          <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>{filtersExpanded ? 'Collapse filters' : 'Show all filters'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ marginTop: 8, gap: 12 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ height: 110, borderRadius: 16, backgroundColor: colors.bg.secondary, overflow: 'hidden', padding: 12, borderWidth: 1, borderColor: colors.border.subtle }}>
              <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: colors.bg.muted, opacity: 0.5 }} />
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: colors.bg.muted }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.bg.muted, width: '70%' }} />
                  <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '40%' }} />
                  <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.bg.muted, width: '55%' }} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <View style={{ height: 32, borderRadius: 8, backgroundColor: colors.bg.muted, flex: 1 }} />
                <View style={{ height: 32, borderRadius: 8, backgroundColor: colors.bg.muted, flex: 1 }} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}
          ListEmptyComponent={(
            <View style={{ marginTop: 16, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14, padding: 16, backgroundColor: colors.bg.secondary }}>
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: accentSoft, borderWidth: 1, borderColor: colors.accent.primary }}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>Nothing yet</Text>
              </View>
              <Text style={{ marginTop: 12, color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>Follow some artists to get release updates.</Text>
              <Text style={{ marginTop: 6, color: colors.text.muted }}>Head to Discover and add a few favourites. We will pull in new drops automatically.</Text>
              <Pressable onPress={() => router.push('/(tabs)/discover' as any)} style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accent.primary }}>
                <Text style={{ color: colors.text.inverted, fontWeight: '800', textAlign: 'center' }}>Go to Discover</Text>
              </Pressable>
            </View>
          )}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderSectionHeader={({ section: { title } }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6 }}>
              <View style={{ width: 18, alignItems: 'center' }}>
                <View style={{ width: 2, height: 18, backgroundColor: colors.bg.muted }} />
                <View style={{ width: 10, height: 10, borderRadius: 8, backgroundColor: colors.accent.primary, borderWidth: 2, borderColor: colors.border.subtle, marginTop: -6 }} />
              </View>
              <Text style={{ marginLeft: 8, color: colors.text.secondary, fontSize: 12, fontWeight: '800' }}>
                {(() => {
                  if (title === 'Unknown date') return 'Earlier';
                  const ts = Date.parse(title);
                  if (!Number.isNaN(ts)) {
                    const days = (Date.now() - ts) / (24 * 60 * 60 * 1000);
                    if (days < 7) return `This week · ${title}`;
                  }
                  return title;
                })()}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            // derive album id from spotify_url to fetch artwork via /lookup if desired
            // quick-and-dirty thumb from open.spotify.com image CDN is not public; prefer lookup later
            const onOpen = () => {
              if (item.spotify_url) Linking.openURL(item.spotify_url).catch(() => {});
            };
            const key = item.spotify_url ?? (item.title && item.artist_name ? `${item.title}__${item.artist_name}` : null);
            const isDone = !!(key && doneSet.has(key));
            const isInList = !!(key && inListSet.has(key));
            const providerId =
              (item as any).provider_id ??
              item.spotify_id ??
              (item as any).apple_id ??
              (item as any).external_id ??
              null;
            const rowId = providerId || item.spotify_url || item.apple_url || key || item.id;
            const menuPayload = {
              id: rowId,
              item_type: itemTypeOf(item) === 'album' ? 'album' : 'track',
              provider: item.spotify_url ? 'spotify' : 'apple',
              provider_id: providerId || rowId,
              title: item.title,
              artist_name: item.artist_name ?? null,
              release_date: item.release_date ?? null,
              spotify_url: item.spotify_url ?? null,
              apple_url: item.apple_url ?? null,
              artwork_url: item.artwork_url ?? item.image_url ?? null,
              done_at: isDone ? new Date().toISOString() : null,
              rating: null,
              created_at: null,
              artist_id: item.artist_id ?? null,
              in_list: isInList || !!added[item.id],
            } as any;
            // Prefetch cover if present
            if (item.image_url) {
              Image.prefetch(item.image_url).catch(() => {});
            }
            const accent = palette[hashString(item.id) % palette.length];
            const waveHeights = (() => {
              const base = hashString(item.id + (item.title || ''));
              return [base % 8 + 4, (base >> 2) % 10 + 3, (base >> 4) % 8 + 5, (base >> 6) % 9 + 4, (base >> 8) % 7 + 6];
            })();
          return (
            <GlassCard asChild style={{ padding: 0 }}>
              <Pressable
                style={({ pressed }) => ({
                  marginHorizontal: 2,
                  marginVertical: 6,
                  padding: 14,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                })}
                onPress={onOpen}
                onLongPress={() => setMenuRow(menuPayload)}
                delayLongPress={RELEASE_LONG_PRESS_MS}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Artwork */}
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={{ width: 62, height: 62, borderRadius: 12, backgroundColor: colors.bg.muted, marginRight: 12 }} />
                  ) : (
                    <View style={{ width: 62, height: 62, borderRadius: 12, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.artist_name ?? '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontWeight: '800', flexShrink: 1, color: colors.text.secondary, fontSize: 16 }} numberOfLines={1}>{item.title}</Text>
                      {isNew(item.release_date) && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: accentSoft, borderRadius: 999 }}>
                          <Text style={{ color: colors.accent.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>NEW</Text>
                        </View>
                      )}
                      {!!itemTypeOf(item) && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: accentSoft, borderRadius: 999, borderWidth: 1, borderColor: colors.accent.primary }}>
                          <Text style={{ color: colors.accent.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}>{itemTypeOf(item)!.toUpperCase()}</Text>
                        </View>
                      )}
                    </View>
                    {!!item.artist_name && <Text style={{ color: colors.text.secondary }} numberOfLines={1}>{item.artist_name}</Text>}
                    {!!item.release_date && <Text style={{ color: colors.text.muted, marginTop: 2 }}>{formatDate(item.release_date)}</Text>}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, justifyContent: 'space-between' }}>
                  <Pressable onPress={onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Open</Text>
                  </Pressable>
                  <Pressable onPress={() => setMenuRow(menuPayload)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.bg.muted }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>•••</Text>
                  </Pressable>
                </View>
              </Pressable>
            </GlassCard>
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
      <StatusMenu
        row={menuRow as any}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={() => { load(); }}
      />
    </Screen>
  );
}
