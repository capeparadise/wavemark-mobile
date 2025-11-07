/* ========================================================================
   File: components/PlayerToggle.tsx
   PURPOSE: Quick toggle between Apple ↔ Spotify using lib/listen helpers.
   ======================================================================== */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#dbeafe',
          backgroundColor: '#eef2ff',
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: '700' }}>
          {player === 'apple' ? ' Music' : 'Spotify'}
        </Text>
        <Text style={{ fontSize: 12, opacity: 0.7 }}>(tap to switch)</Text>
      </View>
    </Pressable>
  );
}
