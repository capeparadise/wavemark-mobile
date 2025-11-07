/* ========================================================================
   File: app/history.tsx
   PURPOSE: Show all listened items (done_at != null), newest first.
   ======================================================================== */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import type { ListenRow } from '../lib/listen';
import { fetchHistory } from '../lib/listen';

export default function HistoryTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ListenRow[]>([]);

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
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
      }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>History</Text>
        <Text style={{ marginTop: 6, color: '#666' }}>
          Everything you’ve marked as listened, most recent first.
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 20 }}>
              <Text style={{ fontSize: 16, color: '#666' }}>No listened items yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 6 }}>
              <Text style={{ fontWeight: '600' }} numberOfLines={2}>{item.title}</Text>
              <Text style={{ color: '#666' }} numberOfLines={1}>{item.artist_name}</Text>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' }}>
                <Text style={{ opacity: 0.7 }}>
                  {item.rating ? `★ ${item.rating}` : 'Not rated'}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
