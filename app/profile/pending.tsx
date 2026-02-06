import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Pressable, RefreshControl, Text, View } from 'react-native';
import Screen from '../../components/StackScreen';
import StatusMenu from '../../components/StatusMenu';
import RatingModal from '../../components/RatingModal';
import { formatDate } from '../../lib/date';
import type { ListenRow } from '../../lib/listen';
import { markDone, setRating, setRatingDetailed } from '../../lib/listen';
import { supabase } from '../../lib/supabase';
import { getUiColors, ui } from '../../constants/ui';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Pending Ratings' };

export default function PendingRatingsScreen() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ratingRow, setRatingRow] = useState<ListenRow | null>(null);
  const [ratingVisible, setRatingVisible] = useState(false);
  const [menuRow, setMenuRow] = useState<ListenRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const CACHE_KEY = 'pending_cache_v1';
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
      .not('done_at', 'is', null)
      .is('rating', null)
      .order('done_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      setError('Could not load pending');
      // eslint-disable-next-line no-console
      console.log('[pending] load error', error);
    } else if (data) {
      setRows(data as ListenRow[]);
      try { await AsyncStorage.setItem(`${CACHE_KEY}_${user.id}`, JSON.stringify(data)); } catch {}
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openRow = (row: ListenRow) => {
    const url = row.spotify_url || row.apple_url;
    if (url) Linking.openURL(url).catch(() => {});
  };

  const renderRow = ({ item }: { item: ListenRow }) => (
    <View
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
          if (art) return <Image source={{ uri: art }} style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted }} />;
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
        {!!item.done_at && <Text style={{ color: colors.text.muted, marginTop: 2 }}>Listened {formatDate(item.done_at)}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Pressable
            onPress={() => { setRatingRow(item); setRatingVisible(true); }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.accent.primary }}
          >
            <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Rate now</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await markDone(item.id, false);
              setRows(curr => curr.filter(r => r.id !== item.id));
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}
          >
            <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Add back</Text>
          </Pressable>
        </View>
      </View>
      <Pressable onPress={() => setMenuRow(item)} hitSlop={8} style={{ padding: 6 }}>
        <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
      </Pressable>
    </View>
  );

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
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 20, color: colors.text.muted }}>{error ? 'Could not load pending. Pull to retry.' : 'Nothing to rate right now.'}</Text>}
          initialNumToRender={12}
          windowSize={8}
          removeClippedSubviews
        />
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
            setRows(curr => curr.filter(r => r.id !== update.row.id));
            return;
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
            setRows(curr => curr.filter(r => r.id !== ratingRow.id));
          }
        }}
      />
    </Screen>
  );
}
