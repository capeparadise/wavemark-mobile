import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import Avatar from '../../components/Avatar';
import GlassCard from '../../components/GlassCard';
import Snackbar from '../../components/Snackbar';
import Screen from '../../components/StackScreen';
import { ensureMyProfile, fetchShareCardTopRated, getProfileByPublicId, getRelationshipWith, sendFriendRequestTo, unmergeRippleWith, type ShareCardTopRatedItem } from '../../lib/profileSocial';
import { useSession } from '../../lib/session';
import { useTheme } from '../../theme/useTheme';

const POST_AUTH_REDIRECT_KEY = 'wavemark:post-auth-redirect';
export default function AddFriendScreen() {
  const { colors } = useTheme();
  const { user, loading: sessionLoading } = useSession();
  const params = useLocalSearchParams<{ publicId?: string }>();
  const publicId = useMemo(() => (params.publicId ? String(params.publicId) : ''), [params.publicId]);

  const [loading, setLoading] = useState(true);
  const [inviter, setInviter] = useState<{ userId: string; displayName: string; avatarUrl: string | null } | null>(null);
  const [topRated, setTopRated] = useState<ShareCardTopRatedItem[]>([]);
  const [topRatedLoading, setTopRatedLoading] = useState(false);
  const [state, setState] = useState<
    | { kind: 'not_found' }
    | { kind: 'needs_auth' }
    | { kind: 'self' }
    | { kind: 'friends' }
    | { kind: 'pending'; inviter: { userId: string; displayName: string; avatarUrl: string | null } }
    | { kind: 'ready'; inviter: { userId: string; displayName: string; avatarUrl: string | null } }
  >({ kind: 'not_found' });
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

  const loadTopRated = async () => {
    setTopRatedLoading(true);
    try {
      const items = await fetchShareCardTopRated(publicId, 3);
      setTopRated(items);
    } finally {
      setTopRatedLoading(false);
    }
  };

  useEffect(() => {
    if (sessionLoading) return;
    if (!user?.id) {
      (async () => {
        try {
          await AsyncStorage.setItem(POST_AUTH_REDIRECT_KEY, `/add-friend/${publicId}`);
        } catch {}
        router.replace('/session');
      })();
      setState({ kind: 'needs_auth' });
      setLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        await ensureMyProfile();
        const inviterProfile = await getProfileByPublicId(publicId);
        if (!mounted) return;
        if (!inviterProfile) { setInviter(null); setState({ kind: 'not_found' }); return; }
        const inviterUi = { userId: inviterProfile.user_id, displayName: inviterProfile.display_name || 'Listener', avatarUrl: inviterProfile.avatar_url ?? null };
        setInviter(inviterUi);
        loadTopRated().catch(() => {});

        const rel = await getRelationshipWith(inviterProfile.user_id);
        if (!mounted) return;
        if (rel.kind === 'self') { setState({ kind: 'self' }); return; }
        if (rel.kind === 'friends') { setState({ kind: 'friends' }); return; }
        if (rel.kind === 'pending') { setState({ kind: 'pending', inviter: inviterUi }); return; }
        setState({ kind: 'ready', inviter: inviterUi });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [publicId, sessionLoading, user?.id]);

  const title = (() => {
    if (state.kind === 'not_found') return 'Link not recognised';
    if (state.kind === 'needs_auth') return 'Sign in required';
    if (state.kind === 'self') return 'This is you';
    if (state.kind === 'friends') return 'Ripples already merged';
    if (state.kind === 'pending') return 'Merge request pending';
    return 'Merge ripples';
  })();

  const body = (() => {
    if (state.kind === 'not_found') return 'This merge request link doesn’t look valid.';
    if (state.kind === 'needs_auth') return 'Sign in to confirm this merge.';
    if (state.kind === 'self') return 'You opened your own merge request link.';
    if (state.kind === 'friends') return 'Ripples already merged.';
    if (state.kind === 'pending') return 'Your merge request is waiting for approval.';
    return 'Preview their profile card, then merge ripples.';
  })();

  const inviterDisplay = (state.kind === 'ready' || state.kind === 'pending')
    ? state.inviter
    : inviter;

  const onConfirm = async () => {
    if (state.kind !== 'ready') return;
    try {
      setBusy(true);
      const timeoutMs = 12000;
      const res = await Promise.race([
        sendFriendRequestTo(state.inviter.userId),
        new Promise<{ ok: false; message: string }>((resolve) => setTimeout(() => resolve({ ok: false, message: 'Timed out' }), timeoutMs)),
      ]);
      if (!res.ok) {
        if (__DEV__) console.log('[add-friend] confirm failed', res);
        const raw = String((res as any)?.message || '');
        const msg = raw === 'Timed out'
          ? 'Could not merge right now. Try again.'
          : raw.includes('row-level security') ? 'Merge failed (database permissions). Apply the friend_requests RLS migration and try again.' : raw || 'Could not send merge request. Try again.';
        setSnack({ visible: true, message: msg });
        return;
      }
      if ((res as any).alreadyFriends) {
        setState({ kind: 'friends' });
        return;
      }
      setState({ kind: 'pending', inviter: state.inviter });
      setSnack({ visible: true, message: 'Merge request sent' });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    // “Remove merge request” = do nothing (no decline write) and return to app.
    router.replace('/(tabs)/feed' as any);
  };

  const onUnmerge = async () => {
    if (state.kind !== 'friends' || !inviterDisplay) return;
    try {
      setBusy(true);
      const res = await unmergeRippleWith(inviterDisplay.userId);
      if (!res.ok) {
        setSnack({ visible: true, message: res.message || 'Could not unmerge ripple. Try again.' });
        return;
      }
      setState({ kind: 'ready', inviter: inviterDisplay });
      setSnack({ visible: true, message: 'Ripple unmerged' });
    } finally {
      setBusy(false);
    }
  };

  const openItem = (t: ShareCardTopRatedItem) => {
    const url = t.spotifyUrl || t.appleUrl;
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 }}>
        <View style={{ gap: 10 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: colors.text.secondary }}>{title}</Text>
            <Text style={{ color: colors.text.muted, lineHeight: 20 }}>{body}</Text>
          </View>

          <GlassCard style={{ padding: 16, gap: 14 }}>
            {loading ? (
              <View style={{ paddingVertical: 22, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator />
              </View>
            ) : (
              <>
                {inviterDisplay ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Avatar uri={inviterDisplay.avatarUrl} size={56} borderColor={colors.border.strong} backgroundColor={colors.bg.muted} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text.secondary, fontWeight: '900', fontSize: 18 }} numberOfLines={1}>
                        {inviterDisplay.displayName}
                      </Text>
                      <Text style={{ marginTop: 4, color: colors.text.muted }} numberOfLines={2}>
                        Merge request
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={{ color: colors.text.muted }}>—</Text>
                )}

                <View style={{ gap: 10 }}>
                  <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>TOP RATED</Text>

                  {topRatedLoading ? (
                    <View style={{ paddingVertical: 10 }}>
                      <ActivityIndicator />
                    </View>
                  ) : topRated.length === 0 ? (
                    <Text style={{ color: colors.text.muted }}>No top rated items to show yet.</Text>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
                      {topRated.slice(0, 3).map((t) => (
                        <Pressable
                          key={t.id}
                          onPress={() => openItem(t)}
                          disabled={!t.spotifyUrl && !t.appleUrl}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.9 : 1,
                            width: 76,
                            height: 76,
                            borderRadius: 14,
                            backgroundColor: colors.border.strong,
                            overflow: 'hidden',
                            borderWidth: 1,
                            borderColor: colors.border.subtle,
                          })}
                        >
                          {t.artworkUrl ? (
                            <Image source={{ uri: t.artworkUrl }} style={{ width: 76, height: 76 }} />
                          ) : (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.secondary }}>
                              <Text style={{ color: colors.text.muted, fontWeight: '900' }}>♪</Text>
                            </View>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {(state.kind === 'ready' || state.kind === 'pending') && (
                  <View style={{ gap: 10 }}>
                    <Pressable
                      onPress={onConfirm}
                      disabled={busy || state.kind !== 'ready'}
                      style={({ pressed }) => ({
                        marginTop: 2,
                        paddingVertical: 13,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: colors.accent.primary,
                        opacity: busy || state.kind !== 'ready' ? 0.6 : pressed ? 0.85 : 1,
                        alignItems: 'center',
                      })}
                    >
                      <Text style={{ color: colors.text.inverted, fontWeight: '900', fontSize: 16 }}>
                        {state.kind === 'pending' ? 'Merge request pending' : (busy ? 'Merging…' : 'Merge ripples')}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={dismiss}
                      style={({ pressed }) => ({
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: colors.bg.muted,
                        borderWidth: 1,
                        borderColor: colors.border.subtle,
                        opacity: pressed ? 0.85 : 1,
                        alignItems: 'center',
                      })}
                    >
                      <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>Remove merge request</Text>
                    </Pressable>
                  </View>
                )}

                {state.kind === 'friends' && (
                  <View style={{ gap: 10 }}>
                    <Pressable
                      onPress={onUnmerge}
                      disabled={busy}
                      style={({ pressed }) => ({
                        marginTop: 4,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: colors.bg.muted,
                        borderWidth: 1,
                        borderColor: colors.border.subtle,
                        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                        alignItems: 'center',
                      })}
                    >
                      <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>Unmerge ripple</Text>
                    </Pressable>
                    <Pressable
                      onPress={dismiss}
                      style={({ pressed }) => ({
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: colors.bg.muted,
                        borderWidth: 1,
                        borderColor: colors.border.subtle,
                        opacity: pressed ? 0.85 : 1,
                        alignItems: 'center',
                      })}
                    >
                      <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>Back to app</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </GlassCard>
        </View>
      </ScrollView>
      <Snackbar
        visible={snack.visible}
        message={snack.message}
        durationMs={1800}
        onTimeout={() => setSnack({ visible: false, message: '' })}
      />
    </Screen>
  );
}
