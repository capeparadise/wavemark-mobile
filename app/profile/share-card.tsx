import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Share, Text, View } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import Avatar from '../../components/Avatar';
import Snackbar from '../../components/Snackbar';
import Screen from '../../components/StackScreen';
import { fetchProfileSnapshot, loadCachedProfileSnapshot, type ProfileSnapshot } from '../../lib/stats';
import { ensureMyProfile, type PublicProfile } from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Share Card' };

export default function ShareCardScreen() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [snap, setSnap] = useState<ProfileSnapshot | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [cachedOnly, setCachedOnly] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setInviteError(false);
    try {
      let p = await ensureMyProfile();
      if (p && !p.public_id) p = await ensureMyProfile();
      setProfile(p);
      setInviteError(!p?.public_id);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const cached = await loadCachedProfileSnapshot();
      if (cached) setSnap(cached);
      try {
        const fresh = await fetchProfileSnapshot();
        setSnap(fresh);
        setCachedOnly(false);
      } catch {
        setCachedOnly(true);
      }
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile().catch(() => {});
    loadStats().catch(() => {});
  }, [loadProfile, loadStats]);

  const inviteUrl = useMemo(() => {
    if (!profile?.public_id) return null;
    // Dev-only: use an Expo link so this can be tested between devices without TestFlight.
    // Production builds will use the `rppl://` scheme.
    if (__DEV__) return ExpoLinking.createURL(`add-friend/${profile.public_id}`);
    return `rppl://add-friend/${profile.public_id}`;
  }, [profile?.public_id]);

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
    return { current, next, progress, total };
  }, [snap?.uniqueCount]);

  const top3Rated = useMemo(() => {
    const items = (snap?.topRated ?? []).slice().sort((a, b) => {
      const ra = Number(a.rating ?? 0);
      const rb = Number(b.rating ?? 0);
      if (rb !== ra) return rb - ra;
      const ta = a.rated_at ? Date.parse(a.rated_at) : (a.done_at ? Date.parse(a.done_at) : 0);
      const tb = b.rated_at ? Date.parse(b.rated_at) : (b.done_at ? Date.parse(b.done_at) : 0);
      return tb - ta;
    });
    return items
      .filter((it) => !!it.artwork_url)
      .slice(0, 3);
  }, [snap?.topRated]);

  const onShare = async () => {
    if (busy) return;
    if (!inviteUrl) {
      setInviteError(true);
      return;
    }
    try {
      setBusy(true);
      try {
        await Share.share({ message: `Send me a merge request on Wavemark: ${inviteUrl}` });
      } catch {
        await (async () => {
          try {
            // Optional dependency; prefer Expo Clipboard when installed.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Clipboard = require('expo-clipboard');
            if (Clipboard?.setStringAsync) {
              await Clipboard.setStringAsync(inviteUrl);
              return;
            }
          } catch {}
          try {
            const nav = (globalThis as any)?.navigator;
            if (nav?.clipboard?.writeText) {
              await nav.clipboard.writeText(inviteUrl);
              return;
            }
          } catch {}
        })();
        setSnack({ visible: true, message: 'Merge request link copied' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      {profileLoading && !profile ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={{ paddingTop: 10, gap: 14 }}>
          <View style={{ padding: 16, borderRadius: 20, backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.strong, gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '700' }}>SHARE CARD</Text>
              {cachedOnly && <Text style={{ color: colors.accent.subtle, fontSize: 12 }}>Offline cache</Text>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar uri={profile?.avatar_url ?? null} size={58} borderColor={colors.border.strong} backgroundColor={colors.bg.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text.inverted, fontSize: 22, fontWeight: '800' }} numberOfLines={1}>
                  {profile?.display_name || 'Listener'}
                </Text>
                <Text style={{ color: colors.text.subtle, marginTop: 4 }}>{level.current.name} · {level.total} listened</Text>
              </View>
            </View>

            <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.overlay.softLight, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, Math.round(level.progress * 100))}%`, height: '100%', backgroundColor: colors.accent.primary }} />
            </View>
            <Text style={{ color: colors.text.subtle, fontSize: 12 }}>Next: {level.next.name} at {level.next.threshold}</Text>

            <View style={{ marginTop: 4 }}>
              <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>TOP RATED</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                {top3Rated.length === 0 ? (
                  <Text style={{ color: colors.text.subtle }}>{statsLoading ? 'Loading…' : 'Rate 3 items to showcase your top picks'}</Text>
                ) : (
                  top3Rated.map((r) => (
                    <View key={r.id} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: colors.border.strong, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <Image source={{ uri: r.artwork_url as string }} style={{ width: 64, height: 64 }} />
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>

          <Pressable
            onPress={onShare}
            disabled={profileLoading}
            style={({ pressed }) => ({
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: colors.accent.primary,
              opacity: profileLoading ? 0.6 : pressed ? 0.9 : 1,
              alignItems: 'center',
            })}
          >
            <Text style={{ color: colors.text.inverted, fontWeight: '800' }}>{busy ? 'Sharing…' : 'Share merge request link'}</Text>
          </Pressable>

          {inviteError && !profileLoading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
              <Text style={{ color: colors.text.muted, fontSize: 12 }}>Merge request link unavailable. Try again.</Text>
              <Pressable
                onPress={() => loadProfile().catch(() => {})}
                style={({ pressed }) => ({
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 10,
                  backgroundColor: colors.bg.muted,
                  borderWidth: 1,
                  borderColor: colors.border.subtle,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 12 }}>Retry</Text>
              </Pressable>
            </View>
          )}

          <View style={{ paddingHorizontal: 2 }}>
            <Text style={{ color: colors.text.muted, fontSize: 12, lineHeight: 16 }}>
              Ripples never see internal IDs in the app. Your merge request link opens a Merge Ripples screen.
            </Text>
          </View>
        </View>
      )}
      <Snackbar
        visible={snack.visible}
        message={snack.message}
        onTimeout={() => setSnack({ visible: false, message: '' })}
      />
    </Screen>
  );
}
