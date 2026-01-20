import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import { markFirstLoginSeen } from '../../lib/firstLogin';
import { useSession } from '../../lib/session';
import type { ThemeColors } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

const Button = ({
  title, onPress, variant = 'primary', disabled = false,
  colors,
}: { title: string; onPress: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean; colors: ThemeColors }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => ({
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: variant === 'primary' ? colors.accent.primary : 'transparent',
      borderWidth: variant === 'ghost' ? 1 : 0,
      borderColor: colors.border.subtle,
      opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      alignItems: 'center',
      marginTop: 10,
    })}
  >
    <Text style={{ color: variant === 'primary' ? colors.text.inverted : colors.text.secondary, fontWeight: '600' }}>
      {title}
    </Text>
  </Pressable>
);

export default function FirstLoginWelcomeScreen() {
  const { colors } = useTheme();
  const { user } = useSession();
  const [busy, setBusy] = useState(false);

  const continueToApp = async () => {
    if (!user) return router.replace('/session');
    try {
      setBusy(true);
      await markFirstLoginSeen(user.id);
    } finally {
      setBusy(false);
      router.replace('/session');
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ paddingTop: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text.secondary }}>You’re in</Text>
        <Text style={{ marginTop: 8, color: colors.text.muted }}>
          Welcome to Wavemark. We’ll keep onboarding lightweight for now.
        </Text>

        <View style={{ marginTop: 18 }}>
          <Button title={busy ? 'Loading…' : 'Continue'} onPress={continueToApp} disabled={busy} colors={colors} />
        </View>
      </View>
    </Screen>
  );
}

