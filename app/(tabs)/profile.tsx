/* ========================================================================
   File: app/(tabs)/profile.tsx
   PURPOSE: User summary: quick stats + links to History, Ratings, Settings.
   ======================================================================== */
import { Link } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import type { ListenRow } from '../../lib/listen';
import { supabase } from '../../lib/supabase';

export default function ProfileTab() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, avgRating: 0 });
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);

      const { data, error } = await supabase
        .from('listen_list')
        .select('rating,done_at')
        .not('done_at', 'is', null);

      if (!error && data) {
        const listened = data as ListenRow[];
        const rated = listened.filter(r => r.rating);
        const avg = rated.length
          ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
          : 0;
        setStats({ total: listened.length, avgRating: avg });
      }
      setLoading(false);
    };
    load();
  }, []);

  return (
    <Screen>
      <View style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        marginBottom: 12,
      }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Profile</Text>
        {userEmail && <Text style={{ color: '#666', marginTop: 4 }}>{userEmail}</Text>}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>Stats</Text>
            <Text style={{ color: '#111827', marginTop: 4 }}>
              Total songs listened: <Text style={{ fontWeight: '700' }}>{stats.total}</Text>
            </Text>
            <Text style={{ color: '#111827' }}>
              Average rating: <Text style={{ fontWeight: '700' }}>{stats.avgRating.toFixed(1)}</Text>
            </Text>
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Your Library</Text>
            <Link href="/history" asChild>
              <Pressable>
                <Text style={{ fontWeight: '700', color: '#2563eb' }}>View Listening History →</Text>
              </Pressable>
            </Link>
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Settings</Text>
            <Pressable onPress={() => supabase.auth.signOut()}>
              <Text style={{ color: '#ef4444', fontWeight: '700' }}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}
