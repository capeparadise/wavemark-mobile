import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { getMarketOverride, initMarketOverride, setMarketOverride } from '../../lib/market';

export default function SettingsTab() {
  const [market, setMarket] = useState<string>('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      await initMarketOverride();
      const v = getMarketOverride();
      setMarket(v ?? '');
    })();
  }, []);

  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 1200);
      return () => clearTimeout(t);
    }
  }, [saved]);

  const onSave = async () => {
    const v = market.trim().toUpperCase();
    if (v && !/^[A-Z]{2}$/.test(v)) {
      Alert.alert('Market must be a 2-letter country code (e.g., GB, US)');
      return;
    }
    await setMarketOverride(v || null);
    setSaved(true);
  };

  const onClear = async () => {
    await setMarketOverride(null);
    setMarket('');
    setSaved(true);
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Settings</Text>
      <Text style={{ color: '#6b7280', marginBottom: 16 }}>Personalize how results are fetched.</Text>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6 }}>Market override</Text>
        <TextInput
          value={market}
          onChangeText={setMarket}
          placeholder="e.g., GB or US"
          autoCapitalize="characters"
          style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
        />
        <Text style={{ color: '#6b7280', marginTop: 6 }}>Leave blank to use device locale.</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Pressable onPress={onSave} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#111827' }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
          </Pressable>
          <Pressable onPress={onClear} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
            <Text style={{ color: '#111827', fontWeight: '700' }}>Clear</Text>
          </Pressable>
          {saved && <Text style={{ color: '#10b981', alignSelf: 'center' }}>Saved</Text>}
        </View>
      </View>
    </View>
  );
}
