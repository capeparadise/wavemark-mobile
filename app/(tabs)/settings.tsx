// app/(tabs)/settings.tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, Text, View } from 'react-native';
import { getDefaultPlayer, setDefaultPlayer } from '../lib/user';

export default function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<'apple' | 'spotify'>('apple');

  useEffect(() => {
    (async () => {
      const p = await getDefaultPlayer();
      setCurrent(p);
      setLoading(false);
    })();
  }, []);

  const pick = async (p: 'apple' | 'spotify') => {
    const ok = await setDefaultPlayer(p);
    if (!ok) {
      Alert.alert('Could not save preference');
      return;
    }
    setCurrent(p);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 16 }}>Settings</Text>
      <Text style={{ fontSize: 16, marginBottom: 12 }}>Default player</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => pick('apple')}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 10,
            backgroundColor: current === 'apple' ? '#e8f0ff' : '#f1f5f9',
          }}
        >
          <Text style={{ fontWeight: '700', color: '#1b5cff' }}>
            Apple Music {current === 'apple' ? '✓' : ''}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => pick('spotify')}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 10,
            backgroundColor: current === 'spotify' ? '#e8f0ff' : '#f1f5f9',
          }}
        >
          <Text style={{ fontWeight: '700', color: '#1b5cff' }}>
            Spotify {current === 'spotify' ? '✓' : ''}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
