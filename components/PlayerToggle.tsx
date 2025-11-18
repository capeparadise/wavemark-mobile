/* ========================================================================
   File: components/PlayerToggle.tsx
   PURPOSE: Quick toggle between Apple ↔ Spotify using lib/listen helpers.
   ======================================================================== */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getDefaultPlayer, setDefaultPlayer } from '../lib/listen';

type Player = 'apple' | 'spotify';

export default function PlayerToggle() {
  const [player, setPlayer] = useState<Player>('apple');

  useEffect(() => {
    (async () => {
      const p = await getDefaultPlayer();
      if (p === 'apple' || p === 'spotify') setPlayer(p);
    })();
  }, []);

  const onToggle = async () => {
    const next = player === 'apple' ? 'spotify' : 'apple';
    setPlayer(next);
    await setDefaultPlayer(next);
  };

  return (
    <Pressable onPress={onToggle}>
      <View
        style={{
          paddingHorizontal: 6,
          paddingVertical: 6,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#e5e7eb',
          backgroundColor: '#fff',
        }}
      >
        {player === 'apple' ? (
          <FontAwesome name="apple" size={22} color="#111827" accessibilityLabel="Apple Music" />
        ) : (
          <FontAwesome name="spotify" size={22} color="#1DB954" accessibilityLabel="Spotify" />
        )}
      </View>
    </Pressable>
  );
}
