import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Avatar from '../../components/Avatar';
import Screen from '../../components/StackScreen';
import { emit } from '../../lib/events';
import { ensureMyProfile, listAcceptedRelationships, listIncomingFriendRequests, respondToFriendRequest, unmergeRippleWith } from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';

export default function FriendRequestsScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof listIncomingFriendRequests>>>([]);
  const [connections, setConnections] = useState<Awaited<ReturnType<typeof listAcceptedRelationships>>>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'requests' | 'connections'>('connections');
  const [didPickTab, setDidPickTab] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureMyProfile();
      const [pendingRows, acceptedRows] = await Promise.all([
        listIncomingFriendRequests(),
        listAcceptedRelationships(),
      ]);
      setRequests(pendingRows);
      setConnections(acceptedRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (loading || didPickTab) return;
    setActiveTab(requests.length > 0 ? 'requests' : 'connections');
  }, [didPickTab, loading, requests.length]);

  const act = async (id: string, next: 'accepted' | 'declined') => {
    try {
      setBusyRequestId(id);
      const res = await respondToFriendRequest(id, next);
      if (res.ok) await load();
    } finally {
      setBusyRequestId(null);
    }
  };

  const onUnmerge = async (connectionId: string) => {
    try {
      setBusyConnectionId(connectionId);
      const res = await unmergeRippleWith(connectionId);
      if (res.ok) {
        setConnections(prev => prev.filter((c) => c.connectionId !== connectionId));
        try { emit('feed:refresh'); } catch {}
      }
    } finally {
      setBusyConnectionId(null);
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ paddingTop: 10 }}>
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle, gap: 6 }}>
            {([
              { key: 'requests', label: 'Requests' },
              { key: 'connections', label: 'Connections' },
            ] as const).map(({ key, label }) => {
              const selected = activeTab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    setActiveTab(key);
                    setDidPickTab(true);
                  }}
                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
                >
                  <View style={{
                    paddingVertical: 10,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? colors.accent.primary : 'transparent',
                  }}>
                    <Text style={{ color: selected ? colors.text.inverted : colors.text.secondary, fontWeight: '800' }}>{label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 28, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : activeTab === 'requests' ? (
          requests.length === 0 ? (
            <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14, padding: 16, backgroundColor: colors.bg.secondary }}>
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>All caught up</Text>
              </View>
              <Text style={{ marginTop: 12, color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>No pending merge requests.</Text>
              <Text style={{ marginTop: 6, color: colors.text.muted }}>Share your merge request link to let people merge ripples.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {requests.map(({ req, requester }) => {
                const displayName = requester?.display_name || 'Listener';
                const avatarUrl = requester?.avatar_url ?? null;
                const busy = busyRequestId === req.id;
                return (
                  <View key={req.id} style={{ padding: 14, borderRadius: 16, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Avatar uri={avatarUrl} size={46} borderColor={colors.border.strong} backgroundColor={colors.bg.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text.secondary, fontWeight: '800' }} numberOfLines={1}>{`${displayName} wants to merge ripples`}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <Pressable
                        onPress={() => act(req.id, 'declined')}
                        disabled={busy}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 12,
                          backgroundColor: colors.bg.muted,
                          borderWidth: 1,
                          borderColor: colors.border.subtle,
                          opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                          alignItems: 'center',
                        })}
                      >
                        <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Decline merge</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => act(req.id, 'accepted')}
                        disabled={busy}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 12,
                          backgroundColor: colors.accent.primary,
                          opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                          alignItems: 'center',
                        })}
                      >
                        <Text style={{ color: colors.text.inverted, fontWeight: '800' }}>{busy ? 'Working…' : 'Merge'}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )
        ) : (
          <View>
            {connections.length === 0 ? (
              <View style={{ borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14, padding: 16, backgroundColor: colors.bg.secondary }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>No connections yet.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {connections.map(({ req, connection, connectionId }) => {
                  const displayName = connection?.display_name || 'Listener';
                  const avatarUrl = connection?.avatar_url ?? null;
                  const busy = busyConnectionId === connectionId;
                  return (
                    <View key={req.id} style={{ padding: 14, borderRadius: 16, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.subtle }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Avatar uri={avatarUrl} size={46} borderColor={colors.border.strong} backgroundColor={colors.bg.muted} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text.secondary, fontWeight: '800' }} numberOfLines={1}>{displayName}</Text>
                        </View>
                        <Pressable
                          onPress={() => onUnmerge(connectionId)}
                          disabled={busy}
                          style={({ pressed }) => ({
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 999,
                            backgroundColor: colors.bg.muted,
                            borderWidth: 1,
                            borderColor: colors.border.subtle,
                            opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                          })}
                        >
                          <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Unmerge ripple</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </View>
    </Screen>
  );
}
