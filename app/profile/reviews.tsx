import ReviewText from '../../components/ReviewText';
import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import ReleaseActionSheet from '../../components/ReleaseActionSheet';
import Screen from '../../components/StackScreen';
import { formatDate } from '../../lib/date';
import type { ListenRow } from '../../lib/listen';
import { goToRelease } from '../../lib/navigation';
import { ratingLabel } from '../../lib/ratingDisplay';
import { supabase } from '../../lib/supabase';
import { useAdvancedRatingsEnabled } from '../../lib/user';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Notes' };

export default function ReviewsScreen() {
  const { colors } = useTheme();
  const [advancedRatings] = useAdvancedRatingsEnabled();
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuRow, setMenuRow] = useState<ListenRow | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(false);
    try {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (current !== generation.current) return;
    if (!auth.user) {
      setRows([]);
      return;
    }
    const { data, error: queryError } = await supabase
      .from('listen_list')
      .select('id,item_type,provider,provider_id,title,artist_name,artwork_url,release_date,done_at,spotify_url,apple_url,spotify_id,apple_id,rating,rated_at,rating_details,review')
      .eq('user_id', auth.user.id)
      .not('review', 'is', null)
      .order('rated_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (current !== generation.current) return;
    if (queryError) {
      setError(true);
    } else {
      setRows(((data || []) as ListenRow[]).filter((item) => !!item.review?.trim()));
    }
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load();
  };

  return (
    <Screen edges={['left', 'right']}>
      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: 36 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={(
            <View style={{ marginBottom: 14 }}>
              {error ? (
                <View accessibilityRole="alert" style={{ marginBottom: 12, gap: 8 }}>
                  <Text style={{ color: colors.text.secondary }}>Notes couldn’t refresh. Please try again.</Text>
                  <Pressable accessibilityRole="button" onPress={() => void refresh()} disabled={refreshing} hitSlop={8}>
                    <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}
              <Text style={{ color: colors.text.secondary, fontSize: 24, fontWeight: '900' }}>Your notes</Text>
              <Text style={{ marginTop: 4, color: colors.text.muted }}>Thoughts you saved alongside your ratings.</Text>
            </View>
          )}
          ListEmptyComponent={(
            <View style={{ paddingVertical: 58, alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 17 }}>{error ? 'Notes could not load' : 'No notes yet'}</Text>
              <Text style={{ color: colors.text.muted, textAlign: 'center', lineHeight: 20 }}>
                {error ? 'Pull down to try again.' : 'Add an optional note when rating music and it will appear here.'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.artist_name ? ` by ${item.artist_name}` : ''}. Note: ${item.review}`}
              onPress={() => goToRelease(item.id)}
              onLongPress={() => setMenuRow(item)}
              delayLongPress={250}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border.subtle,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              {item.artwork_url ? (
                <Image source={{ uri: item.artwork_url }} style={{ width: 54, height: 54, borderRadius: 11, backgroundColor: colors.bg.muted }} />
              ) : (
                <View style={{ width: 54, height: 54, borderRadius: 11, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.text.muted, fontWeight: '900' }}>{item.title.slice(0, 1)}</Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ marginTop: 2, color: colors.text.muted }} numberOfLines={1}>{item.artist_name || 'Unknown artist'}</Text>
                {typeof item.rating === 'number' ? (
                  <Text style={{ marginTop: 4, color: colors.accent.primary, fontSize: 12, fontWeight: '800' }}>
                    {ratingLabel(item.rating, item.rating_details, advancedRatings)}{item.rated_at ? ` · ${formatDate(item.rated_at)}` : ''}
                  </Text>
                ) : null}
                <ReviewText key={item.review} text={item.review || ''} />
              </View>
            </Pressable>
          )}
        />
      )}
      <ReleaseActionSheet
        row={menuRow}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={() => { setMenuRow(null); void load(); }}
      />
    </Screen>
  );
}
