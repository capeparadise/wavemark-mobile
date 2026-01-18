/* ========================================================================
   File: app/(tabs)/profile.tsx
   PURPOSE: User summary: quick stats + links to History, Ratings, Settings.
   ======================================================================== */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import { supabase } from '../../lib/supabase';
import { computeAchievements } from '../../lib/achievements';
import { fetchProfileSnapshot, loadCachedProfileSnapshot, type ProfileSnapshot } from '../../lib/stats';
import { getUiColors, ui, icon } from '../../constants/ui';
import { useTheme } from '../../theme/useTheme';
import GlassCard from '../../components/GlassCard';

export default function ProfileTab() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, avgRating: 0, week: 0, month: 0, streak: 0 });
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('Listener');
  const [achievements, setAchievements] = useState<{ id: string; title: string; unlocked: boolean }[]>([]);
  const [topRated, setTopRated] = useState<ProfileSnapshot['topRated']>([]);

  const load = useCallback(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);
      const name = (user as any)?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : 'Listener');
      setDisplayName(name || 'Listener');

      const cached = await loadCachedProfileSnapshot();
      if (cached) {
    const ratedCached = (cached.ratings || []).filter(r => typeof r.rating === 'number' && !!r.done_at);
        const avgCached = ratedCached.length ? ratedCached.reduce((s,r)=> s + (r.rating ?? 0), 0) / ratedCached.length : 0;
        setStats({
          total: cached.uniqueCount,
          avgRating: avgCached,
          week: cached.weekCount,
          month: cached.monthCount,
          streak: cached.streak,
        });
        setTopRated(cached.topRated || []);
        setAchievements(computeAchievements(cached).map(a => ({ id: a.id, title: a.title, unlocked: a.unlocked })));
      }

      const snap = await fetchProfileSnapshot();
      const rated = (snap.ratings || []).filter(r => typeof r.rating === 'number' && !!r.done_at);
      const avg = rated.length
        ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
        : 0;
      setStats({
        total: snap.uniqueCount,
        avgRating: avg,
        week: snap.weekCount,
        month: snap.monthCount,
        streak: snap.streak,
      });
      setTopRated(snap.topRated || []);
      setAchievements(computeAchievements(snap).map(a => ({ id: a.id, title: a.title, unlocked: a.unlocked })));
      setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => { load(); });
    return unsub;
  }, [navigation, load]);

  const LEVELS = useMemo(() => ([
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
  ]), []);

  const level = useMemo(() => {
    const current = LEVELS.reduce((acc: { name: string; threshold: number; idx: number }, lvl, idx) => (
      stats.total >= lvl.threshold ? { ...lvl, idx } : acc
    ), { ...LEVELS[0], idx: 0 });
    const next = LEVELS[Math.min((current as any).idx + 1, LEVELS.length - 1)];
    const toNext = Math.max(0, next.threshold - stats.total);
    const fromCurrent = Math.max(0, stats.total - current.threshold);
    const span = Math.max(1, next.threshold - current.threshold);
    const progress = Math.min(1, fromCurrent / span);
    return { current, next, toNext, progress };
  }, [LEVELS, stats.total]);

  const initials = useMemo(() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [displayName]);

  const uiColors = useMemo(() => getUiColors(colors), [colors]);

  const goSettings = () => { try { router.push('/profile/settings'); } catch {} };

  const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <GlassCard style={{ flex: 1, minWidth: 150, padding: ui.spacing.lg }}>
      <Text style={{ color: uiColors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>{label}</Text>
      <Text style={{ color: uiColors.text, fontSize: 24, fontWeight: '800', marginTop: 6 }}>{value}</Text>
      {sub ? <Text style={{ color: uiColors.muted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
    </GlassCard>
  );

  const QuickButton = ({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) => (
    <GlassCard
      asChild
      style={{
        flexBasis: '48%',
        maxWidth: '48%',
        minHeight: 48,
        borderRadius: ui.radius.sm,
      }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: Math.max(ui.spacing.md, 12),
          paddingVertical: Math.max(ui.spacing.sm, 8),
          minHeight: 48,
          width: '100%',
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <Ionicons name={icon} size={22} color={uiColors.text} />
        <Text style={{ fontWeight: '700', color: uiColors.text, fontSize: 12 }} numberOfLines={1}>{label}</Text>
      </Pressable>
    </GlassCard>
  );

  const avgRatingDisplay = stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '—';
  const streakLabel = stats.streak ? `${stats.streak} days` : '—';
  const levelProgressPct = Math.min(100, Math.round(level.progress * 100));

  return (
    <Screen style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28 }}>
      <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 32 }}>
        <GlassCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.muted }}>
                <Text style={{ fontWeight: '800', color: colors.text.secondary, fontSize: 18 }}>{initials}</Text>
              </View>
              <View>
                <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary }}>{displayName}</Text>
                {userEmail && <Text style={{ color: colors.text.muted, marginTop: 2 }}>{userEmail}</Text>}
              </View>
            </View>
            <Pressable onPress={goSettings} hitSlop={8} style={{ width: icon.button, height: icon.button, borderRadius: ui.radius.lg, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="settings-outline" size={20} color={colors.text.secondary} />
            </Pressable>
          </View>
        </GlassCard>

        {loading ? (
          <View style={{ gap: 14, paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <View key={i} style={{ flex: 1, minWidth: 150, height: 90, borderRadius: ui.radius.lg, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }} />
              ))}
            </View>
            <View style={{ height: 140, borderRadius: ui.radius.lg, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }} />
          </View>
        ) : (
          <View style={{ gap: 18 }}>
            {/* Stats row */}
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <StatCard label="Unique listens" value={String(stats.total)} />
              <StatCard label="This week" value={String(stats.week)} />
              <StatCard label="30 days" value={String(stats.month)} />
              <StatCard label="Streak" value={streakLabel} />
              <StatCard label="Avg rating" value={avgRatingDisplay} sub="from listened items" />
            </View>

            {/* Level module */}
            <GlassCard style={{ gap: 10 }}>
              <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>LEVEL</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text.inverted, fontSize: 22, fontWeight: '800' }}>{level.current.name}</Text>
                  <Text style={{ color: colors.text.subtle, marginTop: 4 }}>
                    {stats.total} / {level.next.threshold} unique listens
                  </Text>
                </View>
                <Text style={{ color: colors.text.subtle, fontSize: 12 }}>Next: {level.next.name}</Text>
              </View>
            <View style={{ height: 4, borderRadius: 999, backgroundColor: colors.text.subtle, overflow: 'hidden' }}>
              <View style={{ width: `${levelProgressPct}%`, height: '100%', backgroundColor: colors.accent.primary }} />
            </View>
            <View style={{ marginTop: 16, marginBottom: 18, gap: 12 }}>
              {[
                { label: 'This week', value: `${stats.week} ${stats.week === 1 ? 'listen' : 'listens'}` },
                { label: 'Last 30 days', value: `${stats.month} ${stats.month === 1 ? 'listen' : 'listens'}` },
                { label: 'Current streak', value: streakLabel },
              ].map((row) => (
                <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text.subtle, opacity: 0.9, fontSize: 13, fontWeight: '500', lineHeight: 18 }}>
                    {row.label}
                  </Text>
                  <Text style={{ color: colors.text.inverted, fontSize: 13, fontWeight: '700', lineHeight: 18, letterSpacing: -0.1 }}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
              <Pressable
                onPress={() => Alert.alert('Levels', 'Levels are based on unique listened items. Repeat listens do not increase level.')}
                style={{ alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}
              >
                <Text style={{ color: uiColors.text, fontWeight: '700' }}>Learn more</Text>
              </Pressable>
            </GlassCard>

            {/* Quick actions */}
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text.secondary, paddingHorizontal: 0 }}>Quick actions</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 12 }}>
                <QuickButton label="History" icon="time-outline" onPress={() => router.push('/profile/history')} />
                <QuickButton label="Ratings" icon="star-outline" onPress={() => router.push('/profile/ratings')} />
                <QuickButton label="To rate" icon="alert-circle-outline" onPress={() => router.push('/profile/pending')} />
                <QuickButton label="Top rated" icon="trophy-outline" onPress={() => router.push('/profile/top-rated')} />
                <QuickButton label="Insights" icon="stats-chart-outline" onPress={() => router.push('/profile/insights')} />
                <QuickButton label="Share" icon="share-outline" onPress={() => router.push('/profile/share-card')} />
              </View>
            </View>

            {/* Achievements preview */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text.secondary }}>Achievements</Text>
                <Pressable onPress={() => router.push('/profile/achievements')} hitSlop={8}>
                  <Text style={{ color: colors.accent.primary, fontWeight: '700' }}>View all</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {(achievements.slice(0,4)).map((a) => (
                  <View key={a.id} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: a.unlocked ? colors.accent.success + '1a' : colors.bg.muted, borderWidth: 1, borderColor: a.unlocked ? colors.accent.success : colors.border.subtle }}>
                    <Text style={{ color: a.unlocked ? colors.accent.success : colors.text.muted, fontWeight: '700' }}>{a.title}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Library */}
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text.secondary }}>Library</Text>
              {[
                { label: 'Listening history', href: '/profile/history', icon: 'time-outline' as const },
                { label: 'Ratings', href: '/profile/ratings', icon: 'star-outline' as const },
                { label: 'Reviews', href: null, icon: 'chatbubble-ellipses-outline' as const },
              ].map((row) => (
                <Link key={row.label} href={(row.href || '') as any} asChild>
                  <Pressable
                    onPress={() => { if (!row.href) Alert.alert('Reviews', 'Coming soon'); }}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12, backgroundColor: uiColors.card, borderWidth: 1, borderColor: uiColors.border }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name={row.icon} size={18} color={colors.text.secondary} />
                      <Text style={{ fontWeight: '700', color: colors.text.secondary }}>{row.label}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.accent.subtle} />
                  </Pressable>
                </Link>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
