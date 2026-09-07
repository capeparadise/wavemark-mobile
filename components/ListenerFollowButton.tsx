import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { H } from './haptics';
import { followListener, type FollowRelationshipStatus, unfollowListener } from '../lib/profileSocial';
import { useTheme } from '../theme/useTheme';

export default function ListenerFollowButton({
  userId,
  username,
  initialStatus,
  followsYou = false,
  compact = false,
  onChanged,
}: {
  userId: string;
  username?: string | null;
  initialStatus: FollowRelationshipStatus;
  followsYou?: boolean;
  compact?: boolean;
  onChanged?: (status: FollowRelationshipStatus) => void;
}) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<FollowRelationshipStatus>(initialStatus);
  const [busy, setBusy] = useState(false);

  useEffect(() => setStatus(initialStatus), [initialStatus]);
  if (status === 'self') return null;

  const update = (next: FollowRelationshipStatus) => {
    setStatus(next);
    onChanged?.(next);
  };

  const startFollow = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const result = await followListener(userId);
      if (!result.ok || !result.status) {
        Alert.alert('Could not follow', result.message || 'Please try again.');
        return;
      }
      const next = result.status === 'following' ? 'following' : 'requested';
      update(next);
      H.success();
    } finally {
      setBusy(false);
    }
  };

  const stopFollow = () => {
    if (busy) return;
    const name = username ? `@${username}` : 'this listener';
    Alert.alert(
      status === 'requested' ? 'Cancel follow request?' : `Unfollow ${name}?`,
      status === 'requested' ? `Your request to ${name} will be removed.` : 'Their listening updates will no longer appear in your Feed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: status === 'requested' ? 'Cancel request' : 'Unfollow',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              const result = await unfollowListener(userId);
              if (!result.ok) {
                Alert.alert('Could not update follow', result.message || 'Please try again.');
                return;
              }
              update('none');
              H.tap();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const active = status === 'following' || status === 'requested';
  const label = busy ? 'Working…' : status === 'following' ? 'Following' : status === 'requested' ? 'Requested' : followsYou ? 'Follow back' : 'Follow';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={(event) => {
        event.stopPropagation();
        if (active) stopFollow();
        else void startFollow();
      }}
      style={({ pressed }) => ({
        minHeight: compact ? 34 : 42,
        minWidth: compact ? 82 : 104,
        paddingHorizontal: compact ? 13 : 18,
        paddingVertical: compact ? 7 : 10,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? colors.bg.muted : colors.accent.primary,
        borderWidth: active ? 1 : 0,
        borderColor: colors.border.subtle,
        opacity: busy ? 0.55 : pressed ? 0.82 : 1,
      })}
    >
      <Text style={{ color: active ? colors.text.secondary : colors.text.inverted, fontWeight: '800', fontSize: compact ? 12 : 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}
