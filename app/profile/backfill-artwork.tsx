import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Screen from '../../components/StackScreen';
import { backfillArtworkMissing } from '../../lib/listen';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Backfill Artwork' };

export default function BackfillArtworkScreen() {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ checked: number; updated: number; errors: number } | null>(null);

  const runBackfill = async () => {
    setBusy(true);
    try {
      const res = await backfillArtworkMissing(25);
      setLastResult(res);
      Alert.alert('Backfill complete', `Checked ${res.checked}, updated ${res.updated}, errors ${res.errors}`);
    } catch (e: any) {
      Alert.alert('Backfill error', e?.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ gap: 12, paddingTop: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text.secondary }}>Backfill artwork</Text>
        <Text style={{ color: colors.text.muted }}>Runs a one-time fetch to fill missing artwork_url using provider IDs (Spotify only for now).</Text>
        <Pressable
          onPress={runBackfill}
          disabled={busy}
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: busy ? colors.bg.muted : colors.accent.primary,
            alignItems: 'center',
          }}
        >
          {busy ? <ActivityIndicator color={colors.text.inverted} /> : <Text style={{ color: colors.text.inverted, fontWeight: '800' }}>Run backfill</Text>}
        </Pressable>
        {lastResult ? (
          <Text style={{ color: colors.text.secondary }}>
            Last run: checked {lastResult.checked}, updated {lastResult.updated}, errors {lastResult.errors}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
