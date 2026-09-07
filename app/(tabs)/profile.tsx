/* ========================================================================
   File: app/(tabs)/profile.tsx
   PURPOSE: User summary: quick stats + links to History, Ratings, Settings.
   ======================================================================== */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Avatar from '../../components/Avatar';
import Screen from '../../components/Screen';
import { computeAchievements } from '../../lib/achievements';
import { fetchProfileSnapshot, loadCachedProfileSnapshot, type ProfileSnapshot } from '../../lib/stats';
import { getUiColors, ui, icon } from '../../constants/ui';
import { countIncomingPendingRequests, ensureMyProfile, uploadMyAvatar } from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';
import GlassCard from '../../components/GlassCard';
import { goToRelease } from '../../lib/navigation';

export default function ProfileTab() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, avgRating: 0, week: 0, month: 0, streak: 0 });
  const [displayName, setDisplayName] = useState<string>('Listener');
  const [username, setUsername] = useState<string | null>(null);
  const [profileSetupCompleted, setProfileSetupCompleted] = useState(false);
  const [profileIsPrivate, setProfileIsPrivate] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [achievements, setAchievements] = useState<{ id: string; title: string; unlocked: boolean }[]>([]);
  const [topRated, setTopRated] = useState<ProfileSnapshot['topRated']>([]);
  const [recentListening, setRecentListening] = useState<ProfileSnapshot['listened']>([]);
  const [requestsHasDot, setRequestsHasDot] = useState(false);

  const load = useCallback(async () => {
      const profile = await ensureMyProfile();
      setDisplayName(profile?.display_name || 'Listener');
      setUsername(profile?.username ?? null);
      setProfileSetupCompleted(profile?.profile_setup_completed === true);
      setProfileIsPrivate(profile?.is_private !== false);
      setAvatarUrl(profile?.avatar_url ?? null);

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
        setRecentListening(cached.listened || []);
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
      setRecentListening(snap.listened || []);
      setAchievements(computeAchievements(snap).map(a => ({ id: a.id, title: a.title, unlocked: a.unlocked })));
      setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const checkFriendAcceptedNotice = useCallback(async () => {
    const count = await countIncomingPendingRequests();
    setRequestsHasDot(count > 0);
  }, []);
  useFocusEffect(useCallback(() => {
    load();
    checkFriendAcceptedNotice().catch(() => {});
  }, [checkFriendAcceptedNotice, load]));
  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => { load(); checkFriendAcceptedNotice().catch(() => {}); });
    return unsub;
  }, [navigation, checkFriendAcceptedNotice, load]);

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

  const uiColors = useMemo(() => getUiColors(colors), [colors]);

  const goSettings = () => { try { router.push('/profile/settings'); } catch {} };

  const changeAvatar = async () => {
    try {
      setAvatarBusy(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const asset = res.assets[0];
      const up = await uploadMyAvatar({ uri: asset.uri, contentType: (asset as any).mimeType ?? null });
      if (up.ok && up.url) setAvatarUrl(up.url);
      else Alert.alert('Could not update photo', up.message || 'Please try again.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <GlassCard style={{ flex: 1, minWidth: 150, padding: ui.spacing.lg }}>
      <Text style={{ color: uiColors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>{label}</Text>
      <Text style={{ color: uiColors.text, fontSize: 24, fontWeight: '800', marginTop: 6 }}>{value}</Text>
      {sub ? <Text style={{ color: uiColors.muted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
    </GlassCard>
  );

  const QuickButton = ({
    label,
    icon,
    onPress,
    dot,
  }: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    dot?: boolean;
  }) => (
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
          position: 'relative',
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
        {dot ? (
          <View
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 10,
              height: 10,
              borderRadius: 999,
              backgroundColor: '#ff3b30',
              borderWidth: 2,
              borderColor: colors.bg.secondary,
            }}
          />
        ) : null}
        <Ionicons name={icon} size={22} color={uiColors.text} />
        <Text style={{ fontWeight: '700', color: uiColors.text, fontSize: 12 }} numberOfLines={1}>{label}</Text>
      </Pressable>
    </GlassCard>
  );

  const avgRatingDisplay = stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '—';
  const MusicPreview = ({ title, items, onViewAll, empty }: {
    title: string; items: ProfileSnapshot['listened']; onViewAll: () => void; empty: string;
  }) => (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text.secondary }}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`View all ${title.toLowerCase()}`} onPress={onViewAll} hitSlop={8} style={{ paddingVertical: 8 }}>
          <Text style={{ color: colors.accent.primary, fontWeight: '700' }}>View all</Text>
        </Pressable>
      </View>
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {items.slice(0, 6).map(item => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.artist_name || 'Unknown artist'}`} onPress={() => goToRelease(item.id)} style={{ width: 112, gap: 5 }}>
              {item.artwork_url ? (
                <Image source={{ uri: item.artwork_url }} style={{ width: 112, height: 112, borderRadius: ui.radius.lg }} />
              ) : (
                <View style={{ width: 112, height: 112, borderRadius: ui.radius.lg, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="musical-notes-outline" size={32} color={colors.text.muted} />
                </View>
              )}
              <Text numberOfLines={1} style={{ color: colors.text.secondary, fontWeight: '700' }}>{item.title}</Text>
              <Text numberOfLines={1} style={{ color: colors.text.muted, fontSize: 12 }}>{item.artist_name || 'Unknown artist'}</Text>
              {typeof item.rating === 'number' ? <Text style={{ color: colors.accent.primary, fontSize: 12, fontWeight: '700' }}>{item.rating}/10</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : <GlassCard><Text style={{ color: colors.text.muted }}>{empty}</Text></GlassCard>}
    </View>
  );
  const streakLabel = stats.streak ? `${stats.streak} days` : '—';
  const levelProgressPct = Math.min(100, Math.round(level.progress * 100));

  return (
    <Screen style={{ paddingHorizontal: 18, paddingTop: 64, paddingBottom: 0 }}>
      <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 124 }}>
        <GlassCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={changeAvatar} disabled={avatarBusy} style={({ pressed }) => ({ opacity: avatarBusy ? 0.6 : pressed ? 0.85 : 1 })}>
                <Avatar uri={avatarUrl} size={52} borderColor={colors.border.muted} backgroundColor={colors.bg.muted} />
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text.secondary }}>{displayName}</Text>
                <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text style={{ color: colors.text.muted }} numberOfLines={1}>
                    {avatarBusy ? 'Updating photo…' : username ? `@${username}` : 'Your life in music'}
                  </Text>
                  {username && profileIsPrivate ? <Ionicons name="lock-closed" size={11} color={colors.text.muted} /> : null}
                </View>
              </View>
            </View>
            <Pressable onPress={goSettings} hitSlop={8} style={{ width: icon.button, height: icon.button, borderRadius: ui.radius.lg, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="settings-outline" size={20} color={colors.text.secondary} />
            </Pressable>
          </View>
        </GlassCard>

        {!profileSetupCompleted || !username ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/profile/setup')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 15,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.accent.primary,
              backgroundColor: colors.accent.primary + '12',
              opacity: pressed ? 0.84 : 1,
            })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary + '22' }}>
              <Ionicons name="at" size={20} color={colors.accent.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text.secondary, fontSize: 15, fontWeight: '900' }}>Choose your @username</Text>
              <Text style={{ marginTop: 3, color: colors.text.muted }}>Let other music fans find and follow you.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
          </Pressable>
        ) : null}

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
            <MusicPreview title="Recently listened" items={recentListening} onViewAll={() => router.push('/profile/history')} empty="Your listening story starts here. Mark a release as listened to see it on your profile." />
            <MusicPreview title="Top rated" items={topRated} onViewAll={() => router.push('/profile/top-rated')} empty="Rate music you’ve listened to and your favourites will appear here." />
            {/* Stats row */}
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <StatCard label="Unique listens" value={String(stats.total)} />
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
                <QuickButton label="Ratings" icon="star-outline" onPress={() => router.push('/profile/ratings')} />
                <QuickButton label="To rate" icon="alert-circle-outline" onPress={() => router.push('/profile/pending')} />
                <QuickButton label="Reviews" icon="chatbubble-ellipses-outline" onPress={() => Alert.alert('Reviews', 'Coming soon')} />
                <QuickButton label="Insights" icon="stats-chart-outline" onPress={() => router.push('/profile/insights')} />
                <QuickButton
                  label="People"
                  icon="people-outline"
                  dot={requestsHasDot}
                  onPress={() => router.push('/profile/people')}
                />
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

          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
