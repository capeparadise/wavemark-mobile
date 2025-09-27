// app/settings.tsx
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, Text, View } from 'react-native';
import { getDefaultPlayer, setDefaultPlayer, type DefaultPlayer } from '../lib/queries';

export default function SettingsScreen() {
  const [current, setCurrent] = useState<DefaultPlayer>('apple');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getDefaultPlayer();
      setCurrent(p);
    })();
  }, []);

  const save = async (p: DefaultPlayer) => {
    if (saving) return;
    setSaving(true);
    const res = await setDefaultPlayer(p);
    setSaving(false);
    if (!res.ok) {
      Alert.alert('Could not save preference', res.message ?? 'Unknown error');
      return;
    }
    setCurrent(p);
  };

  const Btn = ({ value, label }: { value: DefaultPlayer; label: string }) => (
    <Pressable
      onPress={() => save(value)}
      style={{
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: current === value ? '#e7f0ff' : '#eef0f3',
        marginRight: 12,
      }}
    >
      <Text style={{ color: '#2563eb', fontWeight: '600' }}>
        {label} {current === value ? '✓' : ''}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 32, fontWeight: '800', marginBottom: 16 }}>
          Settings
        </Text>

        <Text style={{ fontSize: 18, marginBottom: 12 }}>Default player</Text>
        <View style={{ flexDirection: 'row' }}>
          <Btn value="apple" label="Apple Music" />
          <Btn value="spotify" label="Spotify" />
        </View>
      </View>
    </SafeAreaView>
  );
}
