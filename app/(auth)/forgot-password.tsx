import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Screen from '../../components/Screen';
import { resetRequestErrorMessage } from '../../lib/authRecovery';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/useTheme';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestReset = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail) || busy) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const redirectTo = 'rppl://reset-password';
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
      const visibleError = resetRequestErrorMessage(requestError);
      if (visibleError) {
        setError(visibleError);
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: 18, paddingBottom: 36 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to sign in" onPress={() => router.back()} hitSlop={8} style={{ width: 44, height: 44, justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={24} color={colors.text.secondary} />
          </Pressable>

          <View style={{ marginTop: 26, gap: 10 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 30, fontWeight: '900' }}>Reset your password</Text>
            <Text style={{ color: colors.text.muted, fontSize: 16, lineHeight: 23 }}>
              Enter the email you use for RPPL and we’ll send you a secure reset link.
            </Text>
          </View>

          {sent ? (
            <View style={{ marginTop: 30, padding: 18, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent.primary}20` }}>
                <Ionicons name="mail-outline" size={22} color={colors.accent.primary} />
              </View>
              <Text style={{ color: colors.text.secondary, fontSize: 19, fontWeight: '800' }}>Check your email</Text>
              <Text style={{ color: colors.text.muted, lineHeight: 21 }}>
                If an account exists for that address, a reset link is on its way. Check spam or junk if it doesn’t arrive.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setSent(false)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>Send another link</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: 30, gap: 14 }}>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={colors.text.muted}
                value={email}
                onChangeText={(value) => { setEmail(value); setError(null); }}
                onSubmitEditing={() => { void requestReset(); }}
                style={{ minHeight: 52, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: error ? '#ff6b6b' : colors.border.subtle, backgroundColor: colors.bg.secondary, color: colors.text.secondary, fontSize: 16 }}
              />
              {error ? <Text accessibilityRole="alert" style={{ color: '#ff6b6b', lineHeight: 20 }}>{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => { void requestReset(); }}
                style={({ pressed }) => ({ minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary, opacity: busy ? 0.55 : pressed ? 0.78 : 1 })}
              >
                {busy ? <ActivityIndicator color={colors.text.inverted} /> : <Text style={{ color: colors.text.inverted, fontSize: 16, fontWeight: '800' }}>Send reset link</Text>}
              </Pressable>
            </View>
          )}

          <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={{ marginTop: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Back to sign in</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
