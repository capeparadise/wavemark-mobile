import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';

type ReleaseType = 'album' | 'ep' | 'single' | 'track';

export default function AddReleaseScreen() {
  const [artistName, setArtistName] = useState('');
  const [title, setTitle] = useState('');
  const [releaseType, setReleaseType] = useState<ReleaseType>('album'); // fixed options
  const [releaseDate, setReleaseDate] = useState(''); // YYYY-MM-DD (optional)
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!artistName.trim() || !title.trim()) {
      Alert.alert('Missing info', 'Please enter artist and title.');
      return;
    }

    setSaving(true);

    // 1) Ensure artist exists (unique on artists.name)
    const { data: artistRow, error: artistErr } = await supabase
      .from('artists')
      .upsert({ name: artistName.trim() }, { onConflict: 'name' })
      .select('id')
      .single();

    if (artistErr || !artistRow) {
      setSaving(false);
      Alert.alert('Error', artistErr?.message ?? 'Could not upsert artist');
      return;
    }

    // 2) Insert release (force lowercase to satisfy DB check)
    const payload = {
      artist_id: artistRow.id,
      title: title.trim(),
      release_type: (releaseType as string).toLowerCase() as ReleaseType,
      release_date: releaseDate.trim() ? releaseDate.trim() : null,
    };

    const { error: relErr } = await supabase.from('releases').insert(payload);

    setSaving(false);

    if (relErr) {
      Alert.alert('Error', relErr.message);
      return;
    }

    Alert.alert('Saved', 'Release added.', [
      { text: 'OK', onPress: () => router.replace('/upcoming') },
    ]);
  };

  const TypeChip = ({ value, label }: { value: ReleaseType; label: string }) => {
    const selected = releaseType === value;
    return (
      <Pressable
        onPress={() => setReleaseType(value)}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: selected ? '#007AFF' : '#ddd',
          backgroundColor: selected ? '#E8F1FF' : 'white',
          borderRadius: 10,
          marginRight: 8,
        }}
      >
        <Text style={{ color: selected ? '#007AFF' : '#111' }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 12 }}>Add release</Text>

        <Text style={{ marginBottom: 6 }}>Artist</Text>
        <TextInput
          value={artistName}
          onChangeText={setArtistName}
          placeholder="e.g. Kendrick Lamar"
          style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 14 }}
        />

        <Text style={{ marginBottom: 6 }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. DAMN"
          style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 14 }}
        />

        <Text style={{ marginBottom: 6 }}>Type</Text>
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          <TypeChip value="album" label="Album" />
          <TypeChip value="ep" label="EP" />
          <TypeChip value="single" label="Single" />
          <TypeChip value="track" label="Track" />
        </View>

        <Text style={{ marginBottom: 6 }}>Release date (YYYY-MM-DD, optional)</Text>
        <TextInput
          value={releaseDate}
          onChangeText={setReleaseDate}
          placeholder="2025-12-05"
          autoCapitalize="none"
          style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 20 }}
        />

        <Pressable
          onPress={save}
          disabled={saving}
          style={{
            backgroundColor: saving ? '#A0CFFF' : '#007AFF',
            padding: 14,
            borderRadius: 12,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
