/* ========================================================================
   File: components/PlayerToggle.tsx
   PURPOSE: Quick toggle between Apple ↔ Spotify using lib/listen helpers.
   ======================================================================== */
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { APPLE_ENABLED, getDefaultPlayer, setDefaultPlayer } from '../lib/listen';
import { useTheme } from '../theme/useTheme';
import { icon, ui } from '../constants/ui';

type Player = 'apple' | 'spotify';

type PlayerToggleProps = {
  value?: Player;
  onChange?: (player: Player) => void | Promise<void>;
};

export function getNextPlayer(player: Player): Player {
  return player === 'apple' ? 'spotify' : 'apple';
}

export default function PlayerToggle({ value, onChange }: PlayerToggleProps) {
  const { colors } = useTheme();
  const [localPlayer, setLocalPlayer] = useState<Player>(APPLE_ENABLED ? 'apple' : 'spotify');
  const player = useMemo(() => value ?? localPlayer, [localPlayer, value]);

  useEffect(() => {
    if (value) return;
    (async () => {
      const p = await getDefaultPlayer();
      if (p === 'apple' || p === 'spotify') setLocalPlayer(p);
    })();
  }, [value]);

  const onToggle = async () => {
    if (!APPLE_ENABLED) return; // ignore toggles when Apple is disabled globally
    const next = getNextPlayer(player);
    if (!value) setLocalPlayer(next);
    await onChange?.(next);
    if (!value) await setDefaultPlayer(next);
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
