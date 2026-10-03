import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import Screen from '../../components/StackScreen';
import StatusMenu from '../../components/StatusMenu';
import RatingModal from '../../components/RatingModal';
import { formatDate } from '../../lib/date';
import type { ListenRow } from '../../lib/listen';
import { setRating, setRatingDetailed } from '../../lib/listen';
import { goToRelease } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { getUiColors, ui } from '../../constants/ui';
import { useTheme } from '../../theme/useTheme';
import { useAdvancedRatingsEnabled } from '../../lib/user';
import { useSession } from '../../lib/session';
import { useListenedActivity } from '../../hooks/useListenedActivity';
import { listenedActivityRevision, mergeListenedActivity, isListenedActivityPending } from '../../lib/listenedActivity';

export const options = { title: 'History' };

export default function HistoryScreen() {
  const { user } = useSession();
  return <HistoryContent key={user?.id ?? 'signed-out'} userId={user?.id} />;
}

function HistoryContent({ userId }: { userId?: string }) {
  const { colors } = useTheme();
  const [advancedRatings] = useAdvancedRatingsEnabled();
  const [rows, setRows] = useState<ListenRow[]>([]);
  useListenedActivity();
  const [activityRead, setActivityRead] = useState(-1);
  const visibleRows = mergeListenedActivity(userId, rows, 'history', activityRead);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuRow, setMenuRow] = useState<ListenRow | null>(null);
  const [ratingRow, setRatingRow] = useState<ListenRow | null>(null);
  const [ratingVisible, setRatingVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const CACHE_KEY = 'history_cache_v1';
  const uiColors = useMemo(() => getUiColors(colors), [colors]);

  const load = useCallback(async () => {
    const readRevision = listenedActivityRevision();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user || user.id !== userId) { setRows([]); setLoading(false); return; }
    // Show cached immediately
    try {
      const raw = await AsyncStorage.getItem(`${CACHE_KEY}_${user.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) { setRows(parsed as ListenRow[]); setActivityRead(-1); }
      }
    } catch {}
    setLoading(true);
    const { data, error } = await supabase
      .from('listen_list')
      .select('id,item_type,provider,provider_id,title,artist_name,artwork_url,release_date,done_at,spotify_url,apple_url,spotify_id,apple_id,rating,rated_at,rating_details,review')
      .eq('user_id', user.id)
      .not('done_at', 'is', null)
      .order('done_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      setError('Could not load history');
      // eslint-disable-next-line no-console
      console.log('[history] load error', error);
    } else if (data) {
      setRows(data as ListenRow[]);
      setActivityRead(readRevision);
      try { await AsyncStorage.setItem(`${CACHE_KEY}_${user.id}`, JSON.stringify(data)); } catch {}
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openRow = (row: ListenRow) => {
    goToRelease(row.id);
  };

  const renderRow = ({ item }: { item: ListenRow }) => {
    const art = item.artwork_url || (item as any).spotify_artwork || null;
    const placeholder = (
      <View style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.text.muted, fontWeight: '800' }}>{(item.title || '?').slice(0,1)}</Text>
      </View>
    );
    if (!art) {
      // eslint-disable-next-line no-console
      console.log('[history] placeholder artwork', {
        title: item.title,
        artwork_url: (item as any).artwork_url,
        image_url: (item as any).image_url,
        imageUrl: (item as any).imageUrl,
        spotify_artwork: (item as any).spotify_artwork,
      });
    }
    return (
      <Pressable
        disabled={isListenedActivityPending(userId, item)}
        onPress={() => openRow(item)}
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
        {art ? (
          <Image source={{ uri: art }} style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted }} />
        ) : placeholder}
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
        </View>
        <Pressable disabled={isListenedActivityPending(userId, item)} onPress={() => setMenuRow(item)} hitSlop={8} style={{ padding: 6 }}>
          <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
        </Pressable>
      </Pressable>
    );
  };

  const skeleton = (
    <View style={{ padding: 12, borderRadius: ui.radius.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: uiColors.border, marginBottom: 10, flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 60, height: 60, borderRadius: 10, backgroundColor: colors.bg.muted }} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 12, width: '70%', backgroundColor: colors.bg.muted, borderRadius: 6 }} />
        <View style={{ height: 10, width: '50%', backgroundColor: colors.bg.muted, borderRadius: 6 }} />
        <View style={{ height: 10, width: '40%', backgroundColor: colors.bg.muted, borderRadius: 6 }} />
      </View>
    </View>
  );

  return (
    <Screen edges={['left', 'right']}>
      {loading && visibleRows.length === 0 ? (
        <View style={{ flex: 1, paddingTop: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => <View key={i}>{skeleton}</View>)}
        </View>
      ) : (
        <FlatList
          data={visibleRows}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 20, color: colors.text.muted }}>{error ? 'Could not load history. Pull to retry.' : 'No listening history yet.'}</Text>}
          initialNumToRender={12}
          windowSize={8}
          removeClippedSubviews
        />
      )}

      <StatusMenu
        row={menuRow}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onRate={(row) => {
          // Hand rating off to the screen-level modal so the release-options
          // modal is fully unmounted before the rating modal opens. Keeping
          // both native modals mounted can leave an invisible layer blocking
          // History after the rating is saved.
          setMenuRow(null);
          setRatingRow(row);
          setRatingVisible(true);
        }}
        onChanged={(update) => {
          if (!update) { load(); return; }
          if (update.type === 'remove') {
            setRows(curr => curr.filter(r => r.id !== update.row.id));
            return;
          }
          if (update.type === 'mark') {
            if (update.done === false) {
              setRows(curr => curr.filter(r => r.id !== update.row.id));
              return;
            }
          }
          if (update.type === 'rate') {
            setRows(curr => curr.map(r => r.id === update.row.id ? { ...r, rating: update.row.rating } : r));
          }
          load();
        }}
      />

      <RatingModal
        visible={ratingVisible}
        title={ratingRow ? `Rate ${ratingRow.title}` : 'Rate'}
        initial={ratingRow?.rating ?? 0}
        initialDetails={ratingRow?.rating_details}
        initialReview={ratingRow?.review}
        itemType={ratingRow?.item_type}
        advanced={advancedRatings}
        onCancel={() => { setRatingVisible(false); setRatingRow(null); }}
        onSubmit={async (stars, details, review) => {
          if (!ratingRow) return;
          const res = details
            ? await setRatingDetailed(ratingRow.id, stars, details, review)
            : await setRating(ratingRow.id, stars, review);
          if (!res.ok) {
            Alert.alert('Could not save rating', res.message || 'Please try again.');
            return;
          }
          setRatingVisible(false);
          setRatingRow(null);
          if (res.ok) {
            setRows(curr => curr.map(r => r.id === ratingRow.id ? { ...r, ...res.row, rating: stars, rated_at: new Date().toISOString() } as any : r));
          }
        }}
      />
    </Screen>
  );
}
