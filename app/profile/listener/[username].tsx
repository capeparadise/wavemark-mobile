import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import Avatar from '../../../components/Avatar';
import ListenerFollowButton from '../../../components/ListenerFollowButton';
import Screen from '../../../components/StackScreen';
import { getListenerMusic, getListenerProfile, type FollowRelationshipStatus, type ListenerMusicItem, type ListenerProfile } from '../../../lib/profileSocial';
import { goToRelease } from '../../../lib/navigation';
import { parseSpotifyUrlOrId } from '../../../lib/spotify';
import { useTheme } from '../../../theme/useTheme';

const extractAppleId = (value?: string | null) => {
  if (!value) return null;
  if (/^\d+$/.test(value)) return value;
  try {
    const url = new URL(value);
    const trackId = url.searchParams.get('i');
    if (trackId && /^\d+$/.test(trackId)) return trackId;
    return url.pathname.match(/\/(?:album|song)\/[^/]+\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
};

export default function ListenerProfileScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ username?: string }>();
  const username = useMemo(() => String(params.username || '').replace(/^@+/, '').toLowerCase(), [params.username]);
  const [profile, setProfile] = useState<ListenerProfile | null>(null);
  const [music, setMusic] = useState<ListenerMusicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const nextProfile = await getListenerProfile(username);
      setProfile(nextProfile);
      if (!nextProfile) {
        setMusic([]);
        return;
      }
      const nextMusic = nextProfile.can_view_content ? await getListenerMusic(username) : [];
      setMusic(nextMusic);
    } catch (e: any) {
      setError(String(e?.message || 'Could not load listener'));
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { void load(); }, [load]);

  const recent = useMemo(() => music.filter((item) => item.section === 'recent'), [music]);
  const topRated = useMemo(() => music.filter((item) => item.section === 'top_rated'), [music]);

  const openMusicItem = (item: ListenerMusicItem) => {
    const spotifyId = item.spotify_id || parseSpotifyUrlOrId(item.spotify_url || '')?.id || (item.provider === 'spotify' ? item.provider_id : null);
    const appleId = item.apple_id || extractAppleId(item.apple_url) || (item.provider === 'apple' ? item.provider_id : null);
    const provider = item.provider || (appleId && !spotifyId ? 'apple' : 'spotify');
    const releaseId = provider === 'apple' ? appleId : spotifyId;
    goToRelease(releaseId || item.id, {
      provider,
      spotifyId,
      spotifyUrl: item.spotify_url,
      appleId,
      appleUrl: item.apple_url,
      title: item.title,
      artistName: item.artist_name,
      imageUrl: item.artwork_url,
      releaseDate: item.release_date,
      type: item.item_type,
    });
  };

  const onRelationshipChanged = async (status: FollowRelationshipStatus) => {
    setProfile((current) => {
      if (!current) return current;
      const canView = status === 'following' || status === 'self' || !current.is_private;
      return { ...current, relationship_status: status, can_view_content: canView };
    });
    if (status === 'following' || profile?.is_private === false) {
      const nextMusic = await getListenerMusic(username).catch(() => []);
      setMusic(nextMusic);
    } else if (profile?.is_private) {
      setMusic([]);
    }
  };

  const MusicRow = ({ title, items }: { title: string; items: ListenerMusicItem[] }) => (
    <View style={{ gap: 11 }}>
      <Text style={{ color: colors.text.secondary, fontSize: 18, fontWeight: '900' }}>{title}</Text>
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {items.slice(0, 12).map((item) => (
            <Pressable
              key={`${item.section}:${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${item.artist_name || 'Unknown artist'}`}
              onPress={() => openMusicItem(item)}
              style={({ pressed }) => ({ width: 116, opacity: pressed ? 0.84 : 1 })}
            >
              {item.artwork_url ? (
                <Image source={{ uri: item.artwork_url }} style={{ width: 116, height: 116, borderRadius: 14, backgroundColor: colors.bg.muted }} />
              ) : (
                <View style={{ width: 116, height: 116, borderRadius: 14, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="musical-notes-outline" size={29} color={colors.text.muted as any} />
                </View>
              )}
              <Text style={{ marginTop: 7, color: colors.text.secondary, fontWeight: '800' }} numberOfLines={1}>{item.title}</Text>
              <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 12 }} numberOfLines={1}>{item.artist_name || 'Unknown artist'}</Text>
              {typeof item.rating === 'number' ? <Text style={{ marginTop: 3, color: colors.accent.primary, fontSize: 12, fontWeight: '800' }}>{item.rating}/10</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={{ color: colors.text.muted }}>Nothing here yet.</Text>
      )}
    </View>
  );

  if (loading) {
    return <Screen><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View></Screen>;
  }

  if (error || !profile) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 50 }}>
          <Ionicons name="person-circle-outline" size={48} color={colors.text.muted as any} />
          <Text style={{ color: colors.text.secondary, fontSize: 20, fontWeight: '900' }}>Listener not found</Text>
          <Text style={{ color: colors.text.muted, textAlign: 'center' }}>{error || `@${username} isn’t available.`}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 38, gap: 25 }}>
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Avatar uri={profile.avatar_url} size={86} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.text.secondary, fontSize: 24, fontWeight: '900' }}>{profile.display_name}</Text>
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={{ color: colors.text.muted, fontSize: 15 }}>@{profile.username}</Text>
              {profile.is_private ? <Ionicons name="lock-closed" size={12} color={colors.text.muted as any} /> : null}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 34 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.text.secondary, fontSize: 17, fontWeight: '900' }}>{profile.followers_count}</Text>
              <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 12 }}>Followers</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.text.secondary, fontSize: 17, fontWeight: '900' }}>{profile.following_count}</Text>
              <Text style={{ marginTop: 2, color: colors.text.muted, fontSize: 12 }}>Following</Text>
            </View>
          </View>

          {profile.relationship_status === 'self' ? (
            <Pressable onPress={() => router.push('/profile/setup')} style={({ pressed }) => ({ minWidth: 130, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.muted, opacity: pressed ? 0.84 : 1 })}>
              <Text style={{ color: colors.text.secondary, textAlign: 'center', fontWeight: '800' }}>Edit profile</Text>
            </Pressable>
          ) : (
            <ListenerFollowButton
              userId={profile.user_id}
              username={profile.username}
              initialStatus={profile.relationship_status}
              followsYou={profile.follows_you}
              onChanged={(status) => { void onRelationshipChanged(status); }}
            />
          )}
        </View>

        {profile.can_view_content ? (
          <View style={{ gap: 25 }}>
            <MusicRow title="Recently listened" items={recent} />
            <MusicRow title="Top rated" items={topRated} />
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 9, paddingVertical: 34, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: colors.border.subtle }}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.text.muted as any} />
            <Text style={{ color: colors.text.secondary, fontSize: 17, fontWeight: '900' }}>This profile is private</Text>
            <Text style={{ color: colors.text.muted, textAlign: 'center', lineHeight: 20 }}>
              Follow @{profile.username} to see what they’ve been listening to and rating.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
