import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Pressable, RefreshControl, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import StatusMenu from '../../components/StatusMenu';
import RatingModal from '../../components/RatingModal';
import { formatDate } from '../../lib/date';
import type { ListenRow } from '../../lib/listen';
import { setRating, setRatingDetailed } from '../../lib/listen';
import { supabase } from '../../lib/supabase';
import { getUiColors, ui } from '../../constants/ui';
import { useTheme } from '../../theme/useTheme';

type FilterKey = 'all' | 'hi' | 'mid' | 'low';
export const options = { title: 'Ratings' };

export default function RatingsScreen() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [menuRow, setMenuRow] = useState<ListenRow | null>(null);
  const [ratingRow, setRatingRow] = useState<ListenRow | null>(null);
  const [ratingVisible, setRatingVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const CACHE_KEY = 'ratings_cache_v1';
  const uiColors = useMemo(() => getUiColors(colors), [colors]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) { setRows([]); setLoading(false); return; }
    try {
      const raw = await AsyncStorage.getItem(`${CACHE_KEY}_${user.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRows(parsed as ListenRow[]);
      }
    } catch {}
    const { data, error } = await supabase
      .from('listen_list')
      .select('id,item_type,provider,provider_id,title,artist_name,artwork_url,release_date,done_at,spotify_url,apple_url,spotify_id,apple_id,rating,rated_at')
      .eq('user_id', user.id)
      .not('rating', 'is', null)
      .order('rated_at', { ascending: false, nullsFirst: false })
      .order('done_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      setError('Could not load ratings');
      // eslint-disable-next-line no-console
      console.log('[ratings] load error', error);
    } else if (data) {
      setRows(data as ListenRow[]);
      try { await AsyncStorage.setItem(`${CACHE_KEY}_${user.id}`, JSON.stringify(data)); } catch {}
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const val = typeof r.rating === 'number' ? r.rating : null;
      if (val == null) return false;
      if (filter === 'hi') return val >= 8;
      if (filter === 'mid') return val >= 6 && val < 8;
      if (filter === 'low') return val < 6;
      return true;
    });
  }, [rows, filter]);

  const openRow = (row: ListenRow) => {
    const url = row.spotify_url || row.apple_url;
    if (url) Linking.openURL(url).catch(() => {});
  };

  const renderRow = ({ item }: { item: ListenRow }) => (
    <Pressable
      onPress={() => { setRatingRow(item); setRatingVisible(true); }}
      style={{
        padding: 12,
        borderRadius: 14,
        backgroundColor: colors.bg.secondary,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        marginBottom: 10,
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <Pressable onPress={() => openRow(item)} hitSlop={8}>
        {(() => {
          const art = item.artwork_url || (item as any).spotify_artwork || null;
          if (art) {
            return <Image source={{ uri: art }} style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted }} />;
          }
          return (
            <View style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.title || '?').slice(0,1)}</Text>
            </View>
          );
        })()}
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontWeight: '700', fontSize: 16, flexShrink: 1, color: colors.text.secondary }} numberOfLines={1}>{item.title}</Text>
          {item.item_type ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
              <Text style={{ fontWeight: '700', color: colors.text.secondary, fontSize: 10 }}>{String(item.item_type).toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
        {!!item.artist_name && <Text style={{ color: colors.text.muted }} numberOfLines={1}>{item.artist_name}</Text>}
        <Text style={{ color: colors.text.muted, marginTop: 4 }}>Rated {item.rating?.toFixed?.(1) ?? item.rating}/10{item.rated_at ? ` · ${formatDate(item.rated_at)}` : ''}</Text>
      </View>
      <Pressable onPress={() => setMenuRow(item)} hitSlop={8} style={{ padding: 6 }}>
        <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
      </Pressable>
    </Pressable>
  );

  const filterChips: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'hi', label: '8–10' },
    { key: 'mid', label: '6–7.9' },
    { key: 'low', label: 'Below 6' },
  ];

  const skeleton = (
    <View style={{ padding: 12, borderRadius: ui.radius.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: uiColors.border, marginBottom: 10, flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted }} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 12, width: '70%', backgroundColor: colors.bg.muted, borderRadius: 6 }} />
        <View style={{ height: 10, width: '50%', backgroundColor: colors.bg.muted, borderRadius: 6 }} />
        <View style={{ height: 10, width: '30%', backgroundColor: colors.bg.muted, borderRadius: 6 }} />
      </View>
    </View>
  );

  return (
    <Screen edges={['left', 'right']}>
      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, paddingTop: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => <View key={i}>{skeleton}</View>)}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {filterChips.map(({ key, label }) => {
              const active = filter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setFilter(key)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: active ? colors.accent.primary : colors.bg.muted,
                    borderWidth: 1,
                    borderColor: active ? colors.accent.primary : colors.border.subtle,
                  }}
                >
                  <Text style={{ color: active ? colors.text.inverted : colors.text.secondary, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(r) => r.id}
            renderItem={renderRow}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 20, color: colors.text.muted }}>{error ? 'Could not load ratings. Pull to retry.' : 'No rated items yet.'}</Text>}
            initialNumToRender={12}
            windowSize={8}
            removeClippedSubviews
          />
        </View>
      )}

      <StatusMenu
        row={menuRow}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={(update) => {
          if (!update) { load(); return; }
          if (update.type === 'remove') {
            setRows(curr => curr.filter(r => r.id !== update.row.id));
            return;
          }
          if (update.type === 'mark' && update.done === false) {
            setRows(curr => curr.filter(r => r.id !== update.row.id));
            return;
          }
          if (update.type === 'rate') {
            setRows(curr => curr.map(r => r.id === update.row.id ? { ...r, rating: update.row.rating, rated_at: new Date().toISOString() } : r));
          }
          load();
        }}
      />

      <RatingModal
        visible={ratingVisible}
        title={ratingRow ? `Rate ${ratingRow.title}` : 'Rate'}
        initial={ratingRow?.rating ?? 0}
        onCancel={() => { setRatingVisible(false); setRatingRow(null); }}
        onSubmit={async (stars, details) => {
          if (!ratingRow) return;
          const res = details && Object.keys(details || {}).length
            ? await setRatingDetailed(ratingRow.id, stars, details)
            : await setRating(ratingRow.id, stars);
          setRatingVisible(false);
          setRatingRow(null);
          if ((res as any)?.ok) {
            setRows(curr => curr.map(r => r.id === ratingRow.id ? { ...r, rating: stars, rated_at: new Date().toISOString() } : r));
          }
        }}
      />
    </Screen>
  );
}
