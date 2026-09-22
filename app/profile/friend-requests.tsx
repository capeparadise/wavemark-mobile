import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Avatar from '../../components/Avatar';
import ListenerFollowButton from '../../components/ListenerFollowButton';
import Screen from '../../components/StackScreen';
import {
  ensureMyProfile,
  listAcceptedRelationships,
  listIncomingFriendRequests,
  listMyFollowersProfiles,
  listMyFollowingProfiles,
  listMyFollowRequests,
  removeMyFollower,
  respondToFollowRequest,
  respondToFriendRequest,
  type FollowRelationshipStatus,
} from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';

type RequestItem = {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  legacy: boolean;
};

type FollowingItem = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: 'following' | 'requested';
};

type FollowerItem = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: FollowRelationshipStatus;
};

export default function FriendRequestsScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const requestedTab = params.tab === 'requests' ? 'requests' : params.tab === 'followers' ? 'followers' : params.tab === 'following' ? 'following' : null;
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [following, setFollowing] = useState<FollowingItem[]>([]);
  const [followers, setFollowers] = useState<FollowerItem[]>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'requests' | 'following' | 'followers'>(requestedTab || 'following');
  const [didPickTab, setDidPickTab] = useState(!!requestedTab);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureMyProfile();
      try {
        const [modernRequests, modernFollowing, modernFollowers] = await Promise.all([
          listMyFollowRequests(),
          listMyFollowingProfiles(),
          listMyFollowersProfiles(),
        ]);
        setRequests(modernRequests.map((row) => ({
          id: row.user_id,
          userId: row.user_id,
          displayName: row.display_name,
          username: row.username,
          avatarUrl: row.avatar_url,
          legacy: false,
        })));
        setFollowing(modernFollowing.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          username: row.username,
          avatarUrl: row.avatar_url,
          status: row.relationship_status,
        })));
        setFollowers(modernFollowers.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          username: row.username,
          avatarUrl: row.avatar_url,
          status: row.relationship_status,
        })));
      } catch {
        const [legacyRequests, legacyConnections] = await Promise.all([
          listIncomingFriendRequests(),
          listAcceptedRelationships(),
        ]);
        setRequests(legacyRequests.map(({ req, requester }) => ({
          id: req.id,
          userId: req.requester_id,
          displayName: requester?.display_name || 'Listener',
          username: requester?.username ?? null,
          avatarUrl: requester?.avatar_url ?? null,
          legacy: true,
        })));
        setFollowing(legacyConnections.map(({ connection, connectionId }) => ({
          userId: connectionId,
          displayName: connection?.display_name || 'Listener',
          username: connection?.username ?? null,
          avatarUrl: connection?.avatar_url ?? null,
          status: 'following',
        })));
        setFollowers([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (loading || didPickTab) return;
    setActiveTab(requests.length > 0 ? 'requests' : 'following');
  }, [didPickTab, loading, requests.length]);

  const respond = async (request: RequestItem, accept: boolean) => {
    try {
      setBusyRequestId(request.id);
      const result = request.legacy
        ? await respondToFriendRequest(request.id, accept ? 'accepted' : 'declined')
        : await respondToFollowRequest(request.userId, accept);
      if (result.ok) {
        await load();
        if (accept && !request.legacy) {
          setActiveTab('followers');
          setDidPickTab(true);
        }
      }
    } finally {
      setBusyRequestId(null);
    }
  };

  const confirmRemoveFollower = (person: FollowerItem) => {
    const name = person.username ? `@${person.username}` : person.displayName;
    Alert.alert(
      `Remove ${name}?`,
      'They will no longer follow you or see listening activity limited to your followers. They won’t be notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove follower',
          style: 'destructive',
          onPress: async () => {
            const result = await removeMyFollower(person.userId);
            if (!result.ok) {
              Alert.alert('Could not remove follower', result.message || 'Please try again.');
              return;
            }
            setFollowers((current) => current.filter((row) => row.userId !== person.userId));
          },
        },
      ],
    );
  };

  const openListener = (username: string | null) => {
    if (!username) return;
    router.push({ pathname: '/profile/listener/[username]', params: { username } });
  };

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ paddingTop: 10, paddingBottom: 34, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 25, fontWeight: '900' }}>Your people</Text>
            <Text style={{ marginTop: 3, color: colors.text.muted }}>Manage requests, followers and the listeners you follow.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Find people" onPress={() => router.push('/profile/people')} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent.primary, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.84 : 1 })}>
            <Ionicons name="person-add-outline" size={20} color={colors.text.inverted as any} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
          {([
            { key: 'requests', label: requests.length ? `Requests (${requests.length})` : 'Requests' },
            { key: 'following', label: 'Following' },
            { key: 'followers', label: 'Followers' },
          ] as const).map(({ key, label }) => {
            const selected = activeTab === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => { setActiveTab(key); setDidPickTab(true); }}
                style={({ pressed }) => ({ flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: selected ? 2 : 0, borderBottomColor: colors.accent.primary, opacity: pressed ? 0.82 : 1 })}
              >
                <Text style={{ color: selected ? colors.accent.primary : colors.text.muted, fontWeight: '800' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View style={{ paddingVertical: 34, alignItems: 'center' }}><ActivityIndicator /></View>
        ) : activeTab === 'requests' ? (
          requests.length === 0 ? (
            <View style={{ paddingVertical: 42, alignItems: 'center', gap: 8 }}>
              <Ionicons name="checkmark-circle-outline" size={32} color={colors.text.muted as any} />
              <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>No follow requests</Text>
              <Text style={{ color: colors.text.muted }}>You’re all caught up.</Text>
            </View>
          ) : requests.map((request) => {
            const busy = busyRequestId === request.id;
            return (
              <View key={request.id} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, gap: 12 }}>
                <Pressable onPress={() => openListener(request.username)} disabled={!request.username} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.84 : 1 })}>
                  <Avatar uri={request.avatarUrl} size={48} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>{request.displayName}</Text>
                    <Text style={{ marginTop: 3, color: colors.text.muted }}>{request.username ? `@${request.username}` : 'Wants to follow you'}</Text>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 10, marginLeft: 60 }}>
                  <Pressable disabled={busy} onPress={() => { void respond(request, false); }} style={({ pressed }) => ({ flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle, opacity: busy ? 0.5 : pressed ? 0.82 : 1 })}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Decline</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => { void respond(request, true); }} style={({ pressed }) => ({ flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center', backgroundColor: colors.accent.primary, opacity: busy ? 0.5 : pressed ? 0.82 : 1 })}>
                    <Text style={{ color: colors.text.inverted, fontWeight: '800' }}>{busy ? 'Working…' : 'Accept'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        ) : activeTab === 'following' ? (following.length === 0 ? (
          <View style={{ paddingVertical: 42, alignItems: 'center', gap: 9 }}>
            <Ionicons name="people-outline" size={32} color={colors.text.muted as any} />
            <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>You aren’t following anyone yet</Text>
            <Pressable onPress={() => router.push('/profile/people')} style={({ pressed }) => ({ marginTop: 5, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.accent.primary, opacity: pressed ? 0.84 : 1 })}>
              <Text style={{ color: colors.text.inverted, fontWeight: '900' }}>Find people</Text>
            </Pressable>
          </View>
        ) : following.map((person) => (
          <Pressable
            key={person.userId}
            onPress={() => openListener(person.username)}
            disabled={!person.username}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, opacity: pressed ? 0.84 : 1 })}
          >
            <Avatar uri={person.avatarUrl} size={48} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '900' }} numberOfLines={1}>{person.displayName}</Text>
              {person.username ? (
                <Text style={{ marginTop: 3, color: colors.text.muted }} numberOfLines={1}>@{person.username}</Text>
              ) : null}
            </View>
            <ListenerFollowButton
              compact
              userId={person.userId}
              username={person.username}
              initialStatus={person.status as FollowRelationshipStatus}
              onChanged={(status) => {
                if (status === 'none') setFollowing((current) => current.filter((row) => row.userId !== person.userId));
                else setFollowing((current) => current.map((row) => row.userId === person.userId ? { ...row, status: status === 'following' ? 'following' : 'requested' } : row));
              }}
            />
          </Pressable>
        ))) : followers.length === 0 ? (
          <View style={{ paddingVertical: 42, alignItems: 'center', gap: 8 }}>
            <Ionicons name="people-outline" size={32} color={colors.text.muted as any} />
            <Text style={{ color: colors.text.secondary, fontWeight: '900' }}>No followers yet</Text>
            <Text style={{ color: colors.text.muted, textAlign: 'center' }}>People who follow you will appear here.</Text>
          </View>
        ) : followers.map((person) => (
          <Pressable
            key={person.userId}
            onPress={() => openListener(person.username)}
            disabled={!person.username}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, opacity: pressed ? 0.84 : 1 })}
          >
            <Avatar uri={person.avatarUrl} size={48} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '900' }} numberOfLines={1}>{person.displayName}</Text>
              <Text style={{ marginTop: 3, color: colors.text.muted }} numberOfLines={1}>
                {person.username ? `@${person.username}` : 'Follows you'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ListenerFollowButton
                compact
                userId={person.userId}
                username={person.username}
                initialStatus={person.status}
                followsYou
                onChanged={(status) => {
                  setFollowers((current) => current.map((row) => row.userId === person.userId ? { ...row, status } : row));
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${person.displayName} as a follower`}
                onPress={(event) => { event.stopPropagation(); confirmRemoveFollower(person); }}
                hitSlop={6}
                style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.text.muted as any} />
              </Pressable>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
