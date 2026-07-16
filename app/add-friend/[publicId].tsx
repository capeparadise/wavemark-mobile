import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import Avatar from '../../components/Avatar';
import GlassCard from '../../components/GlassCard';
import Snackbar from '../../components/Snackbar';
import Screen from '../../components/StackScreen';
import { acceptConnectionInvite, ensureMyProfile, fetchShareCardTopRated, getConnectionInvitePreview, type PublicProfile, type ShareCardTopRatedItem } from '../../lib/profileSocial';
import { goToRelease } from '../../lib/navigation';
import { useSession } from '../../lib/session';
import { useTheme } from '../../theme/useTheme';

const POST_AUTH_REDIRECT_KEY = 'wavemark:post-auth-redirect';

type InviterPreview = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  publicId: string;
};

export default function AddFriendScreen() {
  const { colors } = useTheme();
  const { user, loading: sessionLoading } = useSession();
  const params = useLocalSearchParams<{ publicId?: string }>();
  const inviteToken = useMemo(() => (params.publicId ? String(params.publicId) : ''), [params.publicId]);

  const [loading, setLoading] = useState(true);
  const [inviter, setInviter] = useState<InviterPreview | null>(null);
  const [topRated, setTopRated] = useState<ShareCardTopRatedItem[]>([]);
  const [topRatedLoading, setTopRatedLoading] = useState(false);
  const [state, setState] = useState<
    | { kind: 'not_found' }
    | { kind: 'needs_auth' }
    | { kind: 'friends' }
    | { kind: 'ready'; inviter: InviterPreview }
  >({ kind: 'not_found' });
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

  useEffect(() => {
    if (sessionLoading) return;
    if (!user?.id) {
      (async () => {
        try {
          await AsyncStorage.setItem(POST_AUTH_REDIRECT_KEY, `/add-friend/${inviteToken}`);
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
        const preview = await getConnectionInvitePreview(inviteToken);
        if (!mounted) return;
        if (!preview.inviter || preview.status === 'invalid') { setInviter(null); setState({ kind: 'not_found' }); return; }
        const inviterProfile = preview.inviter as PublicProfile;
        const inviterUi = {
          userId: inviterProfile.user_id,
          displayName: inviterProfile.display_name || 'Listener',
          avatarUrl: inviterProfile.avatar_url ?? null,
          publicId: inviterProfile.public_id,
        };
        setInviter(inviterUi);
        setTopRatedLoading(true);
        fetchShareCardTopRated(inviterProfile.public_id, 3)
          .then((items) => { if (mounted) setTopRated(items); })
          .finally(() => { if (mounted) setTopRatedLoading(false); });
        if (preview.status === 'connected') { setState({ kind: 'friends' }); return; }
        setState({ kind: 'ready', inviter: inviterUi });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [inviteToken, sessionLoading, user?.id]);

  const title = (() => {
    if (state.kind === 'not_found') return 'Invite no longer available';
    if (state.kind === 'needs_auth') return 'Sign in required';
    if (state.kind === 'friends') return 'Ripples merged';
    return 'Merge Ripples';
  })();

  const body = (() => {
    if (state.kind === 'not_found') return 'Invite no longer available.';
    if (state.kind === 'needs_auth') return 'Sign in to confirm this merge.';
    if (state.kind === 'friends') return 'Ripples merged.';
    return 'Preview their profile card, then merge ripples.';
  })();

  const inviterDisplay = state.kind === 'ready'
    ? state.inviter
    : inviter;

  const onConfirm = async () => {
    if (state.kind !== 'ready') return;
    try {
      setBusy(true);
      const timeoutMs = 12000;
      const res = await Promise.race([
        acceptConnectionInvite(inviteToken),
        new Promise<{ ok: false; status: 'invalid'; message: string }>((resolve) => setTimeout(() => resolve({ ok: false, status: 'invalid', message: 'Timed out' }), timeoutMs)),
      ]);
      if (!res.ok) {
        if (__DEV__) console.log('[add-friend] confirm failed', res);
        const raw = String((res as any)?.message || '');
        const msg = raw === 'Timed out'
          ? 'Could not merge right now. Try again.'
          : raw.includes('function') ? 'Merge failed (database invite migration required).' : raw || 'Invite no longer available.';
        setSnack({ visible: true, message: msg });
        if ((res as any).status === 'invalid') setState({ kind: 'not_found' });
        return;
      }
      if (res.status === 'connected' || res.status === 'merged') {
        setState({ kind: 'friends' });
        setSnack({ visible: true, message: 'Ripples merged' });
        return;
      }
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    router.replace('/(tabs)/feed' as any);
  };

  const openItem = (t: ShareCardTopRatedItem) => {
    if (!t.id) return;
    goToRelease(t.id);
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
                        Ripple invite
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

                {state.kind === 'ready' && (
                  <View style={{ gap: 10 }}>
                    <Pressable
                      onPress={onConfirm}
                      disabled={busy}
                      style={({ pressed }) => ({
                        marginTop: 2,
                        paddingVertical: 13,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: colors.accent.primary,
                        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                        alignItems: 'center',
                      })}
                    >
                      <Text style={{ color: colors.text.inverted, fontWeight: '900', fontSize: 16 }}>
                        {busy ? 'Merging…' : 'Merge Ripples'}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {state.kind === 'friends' && (
                  <View style={{ gap: 10 }}>
                    <Pressable
                      onPress={dismiss}
                      style={({ pressed }) => ({
                        marginTop: 4,
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
                      <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>Ripples merged</Text>
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
