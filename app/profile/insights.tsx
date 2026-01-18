import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import Screen from '../../components/Screen';
import { fetchProfileSnapshot, loadCachedProfileSnapshot, type ProfileSnapshot } from '../../lib/stats';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Insights' };

type InsightData = {
  avgRating: number;
  ratingDist: Record<number, number>;
  albumCount: number;
  singleCount: number;
  mostListenedArtist: string | null;
  mostRatedArtist: string | null;
};

export default function InsightsScreen() {
  const { colors } = useTheme();
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const cached = await loadCachedProfileSnapshot();
      if (cached && mounted) setSnapshot(cached);
      const snap = await fetchProfileSnapshot();
      if (mounted) { setSnapshot(snap); setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const data: InsightData | null = useMemo(() => {
    if (!snapshot) return null;
    const ratingDist: Record<number, number> = {};
    for (let i = 1; i <= 10; i++) ratingDist[i] = 0;
    snapshot.ratings.forEach(r => {
      if (typeof r.rating === 'number') {
        const key = Math.round(r.rating);
        ratingDist[key] = (ratingDist[key] ?? 0) + 1;
      }
    });
    const ratedVals = snapshot.ratings.filter(r => typeof r.rating === 'number').map(r => r.rating as number);
    const avgRating = ratedVals.length ? ratedVals.reduce((a,b) => a + b, 0) / ratedVals.length : 0;
    const albumCount = snapshot.listened.filter(r => r.item_type === 'album').length;
    const singleCount = snapshot.listened.filter(r => r.item_type !== 'album').length;
    const listenedByArtist = snapshot.listened.reduce<Record<string, number>>((acc, r) => {
      if (!r.artist_name) return acc;
      acc[r.artist_name] = (acc[r.artist_name] ?? 0) + 1;
      return acc;
    }, {});
    const ratedByArtist = snapshot.ratings.reduce<Record<string, number>>((acc, r) => {
      if (!r.artist_name) return acc;
      acc[r.artist_name] = (acc[r.artist_name] ?? 0) + 1;
      return acc;
    }, {});
    const mostListenedArtist = Object.entries(listenedByArtist).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;
    const mostRatedArtist = Object.entries(ratedByArtist).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;
    return { avgRating, ratingDist, albumCount, singleCount, mostListenedArtist, mostRatedArtist };
  }, [snapshot]);

  const RatingBars = () => {
    if (!data) return null;
    const max = Math.max(...Object.values(data.ratingDist));
    return (
      <View style={{ gap: 4, marginTop: 6 }}>
        {Object.entries(data.ratingDist).map(([k, v]) => {
          const width = max > 0 ? Math.max(6, (v / max) * 100) : 6;
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ width: 18, color: colors.text.muted }}>{k}</Text>
              <View style={{ height: 8, flex: 1, backgroundColor: colors.bg.muted, borderRadius: 999 }}>
                <View style={{ width: `${width}%`, height: '100%', backgroundColor: colors.accent.primary, borderRadius: 999 }} />
              </View>
              <Text style={{ color: colors.text.muted, width: 24, textAlign: 'right' }}>{v}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  if (loading || !data) {
    return (
      <Screen edges={['left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ gap: 16 }}>
        <View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary }}>Insights</Text>
          <Text style={{ color: colors.text.muted, marginTop: 2 }}>Your listening and rating trends</Text>
        </View>

        <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}>
          <Text style={{ fontWeight: '800', color: colors.text.secondary }}>Average rating</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text.secondary, marginTop: 4 }}>{data.avgRating.toFixed(1)}</Text>
        </View>

        <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}>
          <Text style={{ fontWeight: '800', color: colors.text.secondary }}>Rating distribution</Text>
          <RatingBars />
        </View>

        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 140, padding: 12, borderRadius: 12, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}>
            <Text style={{ color: colors.text.muted, fontWeight: '700' }}>Albums</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginTop: 4 }}>{data.albumCount}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 140, padding: 12, borderRadius: 12, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}>
            <Text style={{ color: colors.text.muted, fontWeight: '700' }}>Singles/Tracks</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary, marginTop: 4 }}>{data.singleCount}</Text>
          </View>
        </View>

        <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle, gap: 6 }}>
          <Text style={{ fontWeight: '800', color: colors.text.secondary }}>Artists</Text>
          <Text style={{ color: colors.text.muted }}>Most listened: <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>{data.mostListenedArtist ?? '—'}</Text></Text>
          <Text style={{ color: colors.text.muted }}>Most rated: <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>{data.mostRatedArtist ?? '—'}</Text></Text>
        </View>
      </View>
    </Screen>
  );
}
