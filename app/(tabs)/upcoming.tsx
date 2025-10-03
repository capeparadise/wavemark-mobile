// app/(tabs)/upcoming.tsx
import { Link } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    SafeAreaView,
    Text,
    View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

type Row = {
  id: string;
  title: string;
  release_type: string;
  release_date: string | null;
  artists: { name: string } | null;
};

export default function UpcomingScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('releases')
      .select('id,title,release_type,release_date,artists(name)')
      .order('release_date', { ascending: false, nullsFirst: false })
      .limit(100);

    if (!error && data) setRows(data as unknown as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading && rows.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View
        style={{
          padding: 16,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Upcoming</Text>
        <Link href="/add-release" style={{ fontSize: 16 }}>
          + Add
        </Link>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchData} />
        }
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View
            style={{
              borderWidth: 1,
              borderColor: '#eee',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Text style={{ fontWeight: '600' }}>
              {item.artists?.name ?? 'Unknown'} — {item.title}
            </Text>
            <Text style={{ opacity: 0.7 }}>
              {item.release_type}
              {item.release_date
                ? ` • ${new Date(item.release_date).toLocaleDateString()}`
                : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={{ padding: 16 }}>
              <Text>No releases yet.</Text>
              <Link href="/add-release" style={{ marginTop: 8 }}>
                Add one
              </Link>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
