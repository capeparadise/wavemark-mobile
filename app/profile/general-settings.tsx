import React, { useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import Screen from '../../components/StackScreen';
import PlayerToggle from '../../components/PlayerToggle';
import { isHapticsEnabled, setHapticsEnabled } from '../../components/haptics';
import { useTheme } from '../../theme/useTheme';

export default function GeneralSettings() {
  const { colors } = useTheme();
  const [haptics, setHaptics] = useState(isHapticsEnabled);
  const [saving, setSaving] = useState(false);
  return <Screen><ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40, gap: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
      <View style={{ flex: 1, gap: 5 }}><Text style={{ color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>Haptics</Text><Text style={{ color: colors.text.muted }}>Feel feedback when you interact.</Text></View>
      <Switch accessibilityLabel="Haptics" value={haptics} disabled={saving} trackColor={{ true: colors.accent.primary, false: colors.border.subtle }} onValueChange={async value => {
        if (saving) return;
        setSaving(true);
        try { await setHapticsEnabled(value); setHaptics(value); }
        catch { Alert.alert('Could not save preference', 'Please try again.'); }
        finally { setSaving(false); }
      }} />
    </View>
    {process.env.EXPO_PUBLIC_ENABLE_APPLE === 'true' ? <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>Default player</Text>
      <Text style={{ color: colors.text.muted }}>Choose where releases open.</Text>
      <PlayerToggle />
    </View> : null}
  </ScrollView></Screen>;
}
