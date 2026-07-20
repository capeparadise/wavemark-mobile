import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Screen from '../../components/Screen';
import { supabase } from '../../lib/supabase';
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
      justifyContent: 'center',
      minHeight: 48,
    })}
  >
    <Text style={{ color: variant === 'primary' ? colors.text.inverted : colors.text.secondary, fontWeight: '600' }}>{title}</Text>
  </Pressable>
);

export default function LoginScreen() {
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  const signIn = async () => {
    if (!email || !password) return Alert.alert('Enter email and password');
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      Alert.alert('Sign in failed', error.message);
    } else {
      Alert.alert('Signed in', `Welcome ${data.user.email ?? ''}`);
    }
  };

  const signUp = async () => {
    if (!email || !password) return Alert.alert('Enter email and password');
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      Alert.alert('Sign up failed', error.message);
    } else {
      if (data.session) {
        Alert.alert('Account created', 'Signing you in…');
      } else {
        Alert.alert('Account created', 'Check your email to confirm, then sign in.');
        setMode('signin');
      }
    }
  };

  return (
    <Screen style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ color: colors.text.muted, fontWeight: '600' }}>Back</Text>
            </Pressable>
            <View style={styles.titleBlock}>
              <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text.secondary }}>Account</Text>
              <Text style={{ marginTop: 10, color: colors.text.muted }}>
                {mode === 'signin' ? 'Sign in to your account.' : 'Create an account.'}
              </Text>
            </View>
          </View>

          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              placeholderTextColor={colors.text.muted}
              style={[styles.input, { borderColor: colors.border.subtle, color: colors.text.secondary, backgroundColor: colors.bg.secondary }]}
            />
            <TextInput
              autoCapitalize="none"
              placeholder="password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholderTextColor={colors.text.muted}
              style={[styles.input, { borderColor: colors.border.subtle, color: colors.text.secondary, backgroundColor: colors.bg.secondary }]}
            />

            {mode === 'signin' ? (
              <View style={styles.actions}>
                <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={signIn} disabled={busy} colors={colors} />
                <Button
                  variant="ghost"
                  title="Forgot password"
                  onPress={() => Alert.alert('Forgot password', 'Not implemented yet.')}
                  colors={colors}
                />
                <Button variant="ghost" title="Create an account" onPress={() => setMode('signup')} colors={colors} />
              </View>
            ) : (
              <View style={styles.actions}>
                <Button title={busy ? 'Creating…' : 'Create account'} onPress={signUp} disabled={busy} colors={colors} />
                <Button variant="ghost" title="Back to sign in" onPress={() => setMode('signin')} colors={colors} />
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: 0,
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingTop: 18,
    paddingBottom: 34,
  },
  header: {
    gap: 20,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
  },
  titleBlock: {
    gap: 0,
  },
  form: {
    gap: 14,
    marginTop: 28,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actions: {
    gap: 12,
    marginTop: 4,
  },
});
