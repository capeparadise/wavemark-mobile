import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { followArtist, isFollowing, unfollowArtist } from '../lib/follow';
import { H } from './haptics';

export default function FollowButton({ artistId, artistName, spotifyUrl }: { artistId: string; artistName: string; spotifyUrl?: string | null }) {
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
        borderWidth: 1, borderColor: following ? '#111827' : '#e5e7eb',
        backgroundColor: following ? '#111827' : '#fff',
        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999
      }}>
      <Text style={{ color: following ? '#fff' : '#111827', fontWeight: '700' }}>
        {following ? 'Following' : 'Follow'}
      </Text>
    </Pressable>
  );
}
