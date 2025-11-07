import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Screen from '../components/Screen';
import { ALL_GENRES, DEFAULT_GENRES, formatGenreTitle, getPreferredGenres, setPreferredGenres } from '../lib/genres';

export default function ManageGenres() {
  const [selected, setSelected] = useState<string[]>(DEFAULT_GENRES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const init = await getPreferredGenres();
      setSelected(init);
    })();
  }, []);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const has = prev.includes(key);
      if (has) return prev.filter((g) => g !== key);
      // preserve canonical order
      const next = new Set([...prev, key]);
      return ALL_GENRES.filter((g) => next.has(g));
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await setPreferredGenres(selected);
      router.back();
    } finally { setSaving(false); }
  };

  return (
    <Screen>
      <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ fontWeight: '700' }}>Back</Text>
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>Manage genres</Text>
        <Pressable onPress={save} disabled={saving} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
          <Text style={{ fontWeight: '700' }}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => setSelected(ALL_GENRES.slice())} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ fontWeight: '700' }}>Select all</Text>
        </Pressable>
      </View>
      <FlatList
        data={ALL_GENRES}
        keyExtractor={(k) => k}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => {
          const on = selected.includes(item);
          return (
            <Pressable
              onPress={() => toggle(item)}
              style={{ paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600' }}>{formatGenreTitle(item)}</Text>
              <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: on ? '#0a7' : '#d1d5db', backgroundColor: on ? '#0a7' : 'transparent' }} />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
