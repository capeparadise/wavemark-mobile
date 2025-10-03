import React, { useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, Text, View } from 'react-native';
import { getDefaultPlayer, setDefaultPlayer } from '../lib/listen';

type Player = 'apple' | 'spotify';

function RadioRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
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
        borderBottomColor: '#eee',
      }}
      android_ripple={{ color: '#e5e7eb' }}
    >
      <Text style={{ fontSize: 16 }}>{label}</Text>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? '#22c55e' : '#cbd5e1',
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
              backgroundColor: '#22c55e',
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const [player, setPlayer] = useState<Player>('apple');

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
    setPlayer(p); // instant UI update
    try {
      await setDefaultPlayer(p);
      // Optional UX note:
      // Alert.alert('Saved', `Default player set to ${p === 'apple' ? 'Apple Music' : 'Spotify'}.`);
    } catch (e: any) {
      Alert.alert('Could not save preference', String(e?.message ?? e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Settings</Text>
      </View>

      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          DEFAULT PLAYER
        </Text>
        <View style={{ borderWidth: 1, borderColor: '#eee', borderRadius: 12, overflow: 'hidden' }}>
          <RadioRow
            label=" Music"
            selected={player === 'apple'}
            onPress={() => choose('apple')}
          />
          <RadioRow
            label="Spotify"
            selected={player === 'spotify'}
            onPress={() => choose('spotify')}
          />
        </View>
        <Text style={{ marginTop: 10, color: '#64748b' }}>
          This applies instantly. The Listen tab will try your default first,
          then fall back to the other service if needed.
        </Text>
      </View>
    </SafeAreaView>
  );
}
