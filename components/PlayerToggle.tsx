/* ========================================================================
   File: components/PlayerToggle.tsx
   PURPOSE: Quick toggle between Apple ↔ Spotify using lib/listen helpers.
   ======================================================================== */
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { getDefaultPlayer, setDefaultPlayer } from '../lib/listen';
import { useTheme } from '../theme/useTheme';
import { icon, ui } from '../constants/ui';

type Player = 'apple' | 'spotify';

export default function PlayerToggle() {
  const { colors } = useTheme();
  const APPLE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_APPLE === 'true';
  const [player, setPlayer] = useState<Player>(APPLE_ENABLED ? 'apple' : 'spotify');

  useEffect(() => {
    (async () => {
      const p = await getDefaultPlayer();
      if (p === 'apple' || p === 'spotify') setPlayer(p);
    })();
  }, []);

  const onToggle = async () => {
    if (!APPLE_ENABLED) return; // ignore toggles when Apple is disabled globally
    const next = player === 'apple' ? 'spotify' : 'apple';
    setPlayer(next);
    await setDefaultPlayer(next);
  };

  return (
    <Pressable onPress={onToggle} disabled={!APPLE_ENABLED}>
      <View
        style={{
          width: icon.button,
          height: icon.button,
          borderRadius: ui.radius.lg,
          borderWidth: 1,
          borderColor: colors.border.subtle,
          backgroundColor: colors.bg.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {APPLE_ENABLED && player === 'apple' ? (
          <FontAwesome name="apple" size={22} color={colors.text.secondary} accessibilityLabel="Apple Music" />
        ) : (
          <FontAwesome name="spotify" size={22} color="#1DB954" accessibilityLabel={APPLE_ENABLED ? 'Spotify' : 'Spotify (only)'} />
        )}
      </View>
    </Pressable>
  );
}
