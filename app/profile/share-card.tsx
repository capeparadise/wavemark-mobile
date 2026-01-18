import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import { fetchProfileSnapshot, loadCachedProfileSnapshot, type ProfileSnapshot } from '../../lib/stats';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Share Card' };

export default function ShareCardScreen() {
  const { colors } = useTheme();
  const [snap, setSnap] = useState<ProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [cachedOnly, setCachedOnly] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cached = await loadCachedProfileSnapshot();
        if (cached && mounted) setSnap(cached);
        try {
          const fresh = await fetchProfileSnapshot();
          if (mounted && fresh) { setSnap(fresh); setCachedOnly(false); }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log('[share-card] fallback to cached only', err);
          if (mounted) setCachedOnly(true);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const level = useMemo(() => {
    const LEVELS = [
      { name: 'Listener', threshold: 0 },
      { name: 'Explorer', threshold: 10 },
      { name: 'Collector', threshold: 25 },
      { name: 'Curator', threshold: 50 },
      { name: 'Aficionado', threshold: 75 },
      { name: 'Connoisseur', threshold: 100 },
      { name: 'Insider', threshold: 150 },
      { name: 'Maestro', threshold: 200 },
      { name: 'Virtuoso', threshold: 300 },
      { name: 'Legend', threshold: 500 },
    ];
    const total = snap?.uniqueCount ?? 0;
    const current = LEVELS.reduce((acc: { name: string; threshold: number; idx: number }, lvl, idx) => (
      total >= lvl.threshold ? { ...lvl, idx } : acc
    ), { ...LEVELS[0], idx: 0 });
    const next = LEVELS[Math.min((current as any).idx + 1, LEVELS.length - 1)];
    const fromCurrent = Math.max(0, total - current.threshold);
    const span = Math.max(1, next.threshold - current.threshold);
    const progress = Math.min(1, fromCurrent / span);
    return { current, next, progress };
  }, [snap]);

  const topRatedNormalized = useMemo(() => {
    const items = (snap?.topRated ?? []).slice().sort((a, b) => {
      const ra = Number(a.rating ?? 0);
      const rb = Number(b.rating ?? 0);
      if (rb !== ra) return rb - ra;
      const ta = a.rated_at ? Date.parse(a.rated_at) : (a.done_at ? Date.parse(a.done_at) : 0);
      const tb = b.rated_at ? Date.parse(b.rated_at) : (b.done_at ? Date.parse(b.done_at) : 0);
      return tb - ta;
    });
    return items.map(it => ({
      ...it,
      artwork_url: it.artwork_url ?? (it as any).artworkUrl ?? null,
    }));
  }, [snap]);
  const top3 = useMemo(() => {
    return topRatedNormalized.filter(it => !!it.artwork_url).slice(0, 3);
  }, [topRatedNormalized]);
  const ratingAvg = useMemo(() => {
    if (!snap) return '—';
    const rated = (snap.ratings || []).filter(r => typeof r.rating === 'number' && !Number.isNaN(r.rating));
    if (!rated.length) return '—';
    const avg = rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
    return avg.toFixed(1);
  }, [snap]);
  const isLoading = loading || !snap;

  return (
    <Screen edges={['left', 'right']}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={{ padding: 16, borderRadius: 20, backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.strong, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '700' }}>SHARE CARD</Text>
          {cachedOnly && <Text style={{ color: colors.accent.subtle, fontSize: 12 }}>Offline cache</Text>}
        </View>
        <Text style={{ color: colors.text.inverted, fontSize: 24, fontWeight: '800' }}>{level.current.name}</Text>
        <Text style={{ color: colors.text.subtle }}>{snap?.uniqueCount ?? 0} listened · Avg {ratingAvg}</Text>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.overlay.softLight, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(100, Math.round(level.progress * 100))}%`, height: '100%', backgroundColor: colors.accent.primary }} />
        </View>
        <Text style={{ color: colors.text.subtle, fontSize: 12 }}>Next: {level.next.name} at {level.next.threshold}</Text>
        {/* Debug: ensure topRated has enough items and artwork */}
        {(() => {
          // eslint-disable-next-line no-console
          console.log('[share-card] topRated', (snap?.topRated || []).length, (snap?.topRated || []).slice(0, 5).map((r) => ({
            id: r.id,
            title: r.title,
            rating: r.rating,
            rated_at: (r as any).rated_at,
            artwork_url: (r as any).artwork_url,
            spotify_url: (r as any).spotify_url,
            item_type: (r as any).item_type,
          })));
          return null;
        })()}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          {top3.length === 0 ? (
            <Text style={{ color: colors.text.subtle }}>Rate 3 releases to showcase your top picks</Text>
          ) : (
            top3.map((r) => (
              <View key={r.id} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: colors.border.strong, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <Image source={{ uri: r.artwork_url as string }} style={{ width: 64, height: 64, borderRadius: 10 }} />
              </View>
            ))
          )}
        </View>
        </View>
      )}
      <Pressable
        onPress={() => Alert.alert('Share', 'Sharing coming soon')}
        style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: colors.text.secondary, alignItems: 'center', opacity: 0.7 }}
      >
        <Text style={{ color: colors.text.inverted, fontWeight: '800' }}>Sharing coming soon</Text>
      </Pressable>
    </Screen>
  );
}
