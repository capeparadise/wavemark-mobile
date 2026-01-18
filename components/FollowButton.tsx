import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { followArtist, isFollowing, unfollowArtist } from '../lib/follow';
import { H } from './haptics';
import { ui } from '../constants/ui';
import { useTheme } from '../theme/useTheme';

export default function FollowButton({ artistId, artistName, spotifyUrl }: { artistId: string; artistName: string; spotifyUrl?: string | null }) {
  const { colors } = useTheme();
  const [following, setFollowing] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => setFollowing(await isFollowing(artistId)))(); }, [artistId]);

  const onToggle = async () => {
    if (busy) return;
    setBusy(true);
    if (!following) {
      const r = await followArtist({ artistId, artistName, spotifyUrl });
  if (r.ok) { setFollowing(true); H.success(); } else Alert.alert(r.message || 'Failed to follow');
    } else {
      const r = await unfollowArtist(artistId);
  if (r.ok) { setFollowing(false); H.tap(); } else Alert.alert(r.message || 'Failed to unfollow');
    }
    setBusy(false);
  };

  return (
    <Pressable onPress={onToggle}
      style={{
        borderWidth: 1, borderColor: following ? colors.accent.primary : colors.border.subtle,
        backgroundColor: following ? colors.accent.primary : colors.bg.primary,
        paddingHorizontal: 12, paddingVertical: 8, borderRadius: ui.radius.lg
      }}>
      <Text style={{ color: following ? colors.text.inverted : colors.text.secondary, fontWeight: '700' }}>
        {following ? 'Following' : 'Follow'}
      </Text>
    </Pressable>
  );
}
