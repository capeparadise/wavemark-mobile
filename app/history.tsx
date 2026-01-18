/* ========================================================================
   File: app/history.tsx
   PURPOSE: Show all listened items (done_at != null), newest first.
   ======================================================================== */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View, Pressable } from 'react-native';
import type { ListenRow } from '../lib/listen';
import { fetchHistory } from '../lib/listen';
import StatusMenu from '../components/StatusMenu';
import Screen from '../components/Screen';
import { useTheme } from '../theme/useTheme';
import GlassCard from '../components/GlassCard';

export default function HistoryTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ListenRow[]>([]);
  const [menuRow, setMenuRow] = useState<ListenRow | null>(null);
  const { colors } = useTheme();

  const load = async () => {
    setLoading(true);
    const res = await fetchHistory();
    if (res.ok) setRows(res.rows);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const visible = useMemo(() => {
    const list = rows.slice();
    // already listened-only; order by rated_at/done_at desc
    list.sort((a, b) => {
      const getT = (r: any) =>
        (r.rated_at && Date.parse(r.rated_at)) ||
        (r.done_at && Date.parse(r.done_at)) ||
        (r.created_at && Date.parse(r.created_at)) || 0;
      return getT(b) - getT(a);
    });
    return list;
  }, [rows]);

  return (
    <Screen edges={['left', 'right']}>
      <View style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.subtle,
      }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text.secondary }}>History</Text>
        <Text style={{ marginTop: 6, color: colors.text.muted }}>
          Everything you’ve marked as listened, most recent first.
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.text.muted} /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text.muted} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 20 }}>
              <Text style={{ fontSize: 16, color: colors.text.muted }}>No listened items yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <GlassCard asChild style={{ marginVertical: 4, padding: 0 }}>
              <View style={{ padding: 12, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', color: colors.text.secondary }} numberOfLines={2}>{item.title}</Text>
                    <Text style={{ color: colors.text.muted }} numberOfLines={1}>{item.artist_name}</Text>
                  </View>
                  <Pressable onPress={() => setMenuRow(item)} hitSlop={8} style={{ paddingHorizontal: 6, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 18, color: colors.text.muted }}>⋯</Text>
                  </Pressable>
                </View>

                <View style={{ flexDirection: 'row', gap: 12, marginTop: 4, alignItems: 'center' }}>
                  <Text style={{ opacity: 0.8, color: colors.text.muted }}>
                    {item.rating ? `★ ${item.rating}` : 'Not rated'}
                  </Text>
                </View>
              </View>
            </GlassCard>
          )}
        />
      )}
      <StatusMenu
        row={menuRow}
        visible={!!menuRow}
        onClose={() => setMenuRow(null)}
        onChanged={(update) => {
          if (!update) return load();
          if (update.type === 'mark') {
            if (!update.done) {
              // Move back to Listen: remove from history list
              setRows(prev => prev.filter(r => r.id !== update.row.id));
              return;
            }
          }
          if (update.type === 'remove') {
            setRows(prev => prev.filter(r => r.id !== update.row.id));
            return;
          }
          if (update.type === 'rate') {
            setRows(prev => prev.map(r => r.id === update.row.id ? { ...r, rating: update.row.rating } : r));
            return;
          }
          load();
        }}
      />
    </Screen>
  );
}
