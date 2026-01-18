import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import Screen from '../components/Screen';
import { getDefaultPlayer, setDefaultPlayer } from '../lib/listen'; // <-- path must be ../lib/listen
import type { ThemeColors } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

type Player = 'apple' | 'spotify';

function RadioRow({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: colors.border.subtle,
      }}
      android_ripple={{ color: colors.bg.muted }}
    >
      <Text style={{ fontSize: 16, color: colors.text.secondary }}>{label}</Text>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? colors.accent.primary : colors.border.muted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: colors.accent.primary,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  console.log('[settings] screen mounted');
  const [player, setPlayer] = useState<Player>('apple');
  const { colors } = useTheme();

  useEffect(() => {
    (async () => {
      try {
        const p = await getDefaultPlayer();
        if (p === 'apple' || p === 'spotify') setPlayer(p);
      } catch {
        // ignore
      }
    })();
  }, []);

  const choose = async (p: Player) => {
    console.log('[settings] tap choose =', p);
    setPlayer(p); // instant UI update
    try {
      await setDefaultPlayer(p);                      // writes AsyncStorage
      const confirmed = await getDefaultPlayer();     // read-back to verify
      console.log('[settings] wrote =', p, 'confirmed =', confirmed);
    } catch (e: any) {
      Alert.alert('Could not save preference', String(e?.message ?? e));
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text.secondary }}>Settings</Text>
        <Text style={{ color: colors.text.muted, marginTop: 6 }}>Choose how Wavemark opens links.</Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontSize: 12, color: colors.text.muted, marginBottom: 8 }}>
          DEFAULT PLAYER
        </Text>
        <View style={{ borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.bg.secondary }}>
          <RadioRow
            label=" Music"
            selected={player === 'apple'}
            onPress={() => choose('apple')}
            colors={colors}
          />
          <RadioRow
            label="Spotify"
            selected={player === 'spotify'}
            onPress={() => choose('spotify')}
            colors={colors}
          />
        </View>
        <Text style={{ marginTop: 10, color: colors.text.muted }}>
          This applies instantly. The Listen tab will try your default first,
          then fall back to the other service if needed.
        </Text>
      </View>
    </Screen>
  );
}
