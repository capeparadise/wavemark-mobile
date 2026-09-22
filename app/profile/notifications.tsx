import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import Avatar from '../../components/Avatar';
import ListenerFollowButton from '../../components/ListenerFollowButton';
import Screen from '../../components/StackScreen';
import { formatDate } from '../../lib/date';
import { discoverReleaseDateTimestamp } from '../../lib/discoverFreshness';
import { fetchFeedForArtists, listFollowedArtists, type FeedItem } from '../../lib/follow';
import { goToRelease } from '../../lib/navigation';
import { listMyFollowersProfiles, listMyFollowRequests, type FollowerProfile, type IncomingFollowRequest } from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Notifications' };

const releaseIdentity = (item: FeedItem) => item.spotify_id || item.provider_id || item.spotify_url || item.id;

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const [requests, setRequests] = useState<IncomingFollowRequest[]>([]);
  const [followers, setFollowers] = useState<FollowerProfile[]>([]);
  const [releases, setReleases] = useState<FeedItem[]>([]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(false);
    const [requestResult, followerResult, artistResult] = await Promise.allSettled([
      listMyFollowRequests(),
      listMyFollowersProfiles(),
      listFollowedArtists(),
    ]);
    if (current !== generation.current) return;
    let failed = [requestResult, followerResult, artistResult].some(result => result.status === 'rejected');
    const artists = artistResult.status === 'fulfilled' ? artistResult.value : [];
    if (requestResult.status === 'fulfilled') setRequests(requestResult.value);
    if (followerResult.status === 'fulfilled') setFollowers(followerResult.value.slice(0, 4));
    if (artists.length) {
      try {
      const rows = await fetchFeedForArtists({ artistIds: artists.map((artist) => artist.id), limit: 80 });
      if (current !== generation.current) return;
      const now = Date.now();
      const earliest = now - 14 * 24 * 60 * 60 * 1000;
      const recent = rows
        .filter((item) => {
          const timestamp = discoverReleaseDateTimestamp(item.release_date);
          return timestamp >= earliest && timestamp <= now + 24 * 60 * 60 * 1000;
        })
        .sort((a, b) => discoverReleaseDateTimestamp(b.release_date) - discoverReleaseDateTimestamp(a.release_date));
      setReleases([...new Map(recent.map((item) => [releaseIdentity(item), item])).values()].slice(0, 6));
      } catch { failed = true; }
    } else if (artistResult.status === 'fulfilled') {
      setReleases([]);
    }
    if (current !== generation.current) return;
    setError(failed);
    setLoaded(true);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]));

  const recentFollowers = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return followers.filter((person) => !person.created_at || (Date.parse(person.created_at) || 0) >= cutoff);
  }, [followers]);

  const openRelease = (item: FeedItem) => {
    const spotifyId = item.spotify_id || item.provider_id || item.spotify_url?.match(/open\.spotify\.com\/(?:album|track)\/([A-Za-z0-9]+)/)?.[1] || null;
    goToRelease(spotifyId || item.id, {
      provider: 'spotify',
      spotifyId,
      spotifyUrl: item.spotify_url,
      appleUrl: item.apple_url,
      title: item.title,
      artistName: item.artist_name,
      imageUrl: item.artwork_url || item.image_url || null,
      releaseDate: item.release_date,
      type: item.item_type === 'album' || item.release_type === 'album' ? 'album' : 'track',
    });
  };

  if (loading && !loaded) {
    return <Screen><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View></Screen>;
  }

  const empty = requests.length === 0 && recentFollowers.length === 0 && releases.length === 0;
  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ paddingTop: 10, paddingBottom: 40, gap: 24 }}>
        <View>
          <Text style={{ color: colors.text.secondary, fontSize: 25, fontWeight: '900' }}>What’s new</Text>
          <Text style={{ marginTop: 4, color: colors.text.muted, lineHeight: 20 }}>Follow requests, new followers and releases from artists you follow.</Text>
        </View>

        {error ? (
          <View accessibilityRole="alert" style={{ gap: 8 }}>
            <Text style={{ color: colors.text.secondary }}>Some updates couldn’t load. Anything shown may be out of date.</Text>
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => void load()} hitSlop={8}>
              <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>{loading ? 'Retrying…' : 'Try again'}</Text>
            </Pressable>
          </View>
        ) : loading ? <ActivityIndicator /> : null}

        {requests.length ? (
          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text.secondary, fontSize: 17, fontWeight: '900' }}>Follow requests</Text>
              <Pressable onPress={() => router.push({ pathname: '/profile/friend-requests', params: { tab: 'requests' } })} hitSlop={8}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>Review</Text>
              </Pressable>
            </View>
            {requests.slice(0, 3).map((person) => (
              <Pressable key={person.user_id} onPress={() => router.push({ pathname: '/profile/friend-requests', params: { tab: 'requests' } })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.78 : 1 })}>
                <Avatar uri={person.avatar_url} size={44} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>{person.display_name}</Text>
                  <Text style={{ marginTop: 3, color: colors.text.muted }}>{person.username ? `@${person.username} wants to follow you` : 'Wants to follow you'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.text.muted as any} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {recentFollowers.length ? (
          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text.secondary, fontSize: 17, fontWeight: '900' }}>New followers</Text>
              <Pressable onPress={() => router.push({ pathname: '/profile/friend-requests', params: { tab: 'followers' } })} hitSlop={8}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>View all</Text>
              </Pressable>
            </View>
            {recentFollowers.slice(0, 3).map((person) => (
              <View key={person.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
                <Pressable onPress={() => person.username && router.push({ pathname: '/profile/listener/[username]', params: { username: person.username } })} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.78 : 1 })}>
                  <Avatar uri={person.avatar_url} size={44} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>{person.display_name}</Text>
                    <Text style={{ marginTop: 3, color: colors.text.muted }}>{person.username ? `@${person.username} follows you` : 'Follows you'}</Text>
                  </View>
                </Pressable>
                <ListenerFollowButton compact userId={person.user_id} username={person.username} initialStatus={person.relationship_status} followsYou />
              </View>
            ))}
          </View>
        ) : null}

        {releases.length ? (
          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text.secondary, fontSize: 17, fontWeight: '900' }}>New releases</Text>
                <Text style={{ marginTop: 3, color: colors.text.muted, fontSize: 12 }}>One quiet summary from the last two weeks</Text>
              </View>
              <Pressable onPress={() => router.push({ pathname: '/(tabs)/feed', params: { tab: 'releases' } })} hitSlop={8}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>Open Feed</Text>
              </Pressable>
            </View>
            {releases.slice(0, 4).map((item) => (
              <Pressable key={releaseIdentity(item)} onPress={() => openRelease(item)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, opacity: pressed ? 0.78 : 1 })}>
                {item.artwork_url || item.image_url ? (
                  <Image source={{ uri: item.artwork_url || item.image_url || undefined }} style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.bg.muted }} />
                ) : (
                  <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.bg.muted, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-notes-outline" size={20} color={colors.text.muted as any} /></View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text.secondary, fontWeight: '900' }} numberOfLines={1}>{item.title}</Text>
                  <Text style={{ marginTop: 3, color: colors.text.muted }} numberOfLines={1}>{item.artist_name || 'Unknown artist'}{item.release_date ? ` · ${formatDate(item.release_date)}` : ''}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {empty && !error && !loading ? (
          <View style={{ paddingVertical: 60, alignItems: 'center', gap: 9 }}>
            <Ionicons name="notifications-outline" size={34} color={colors.text.muted as any} />
            <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>You’re all caught up</Text>
            <Text style={{ color: colors.text.muted, textAlign: 'center', lineHeight: 20 }}>Important people and artist updates will appear here—routine listens and ratings won’t.</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
