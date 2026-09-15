import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Screen from '../../components/Screen';
import { parseRecoveryCallback, passwordValidationMessage } from '../../lib/authRecovery';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme/useTheme';

type RecoveryState = 'checking' | 'ready' | 'invalid' | 'saved';

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const linkUrl = Linking.useLinkingURL();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    code?: string;
    type?: string;
    error?: string;
    error_description?: string;
  }>();
  const [state, setState] = useState<RecoveryState>('checking');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumedRef = useRef<string | null>(null);

  const parameterUrl = useMemo(() => {
    const query = new URLSearchParams();
    for (const key of ['access_token', 'refresh_token', 'code', 'type', 'error', 'error_description'] as const) {
      const value = params[key];
      if (typeof value === 'string' && value) query.set(key, value);
    }
    return query.size ? `rppl://reset-password?${query.toString()}` : null;
  }, [params]);

  const activate = useCallback(async (url: string | null) => {
    if (!url || consumedRef.current === url) return false;
    const callback = parseRecoveryCallback(url);
    if (!callback.accessToken && !callback.refreshToken && !callback.code && !callback.errorMessage) return false;
    consumedRef.current = url;
    setState('checking');
    setError(null);
    if (callback.errorMessage) {
      setError('This reset link has expired or has already been used. Request a new one.');
      setState('invalid');
      return true;
    }
    if (callback.type && callback.type !== 'recovery') {
      setError('This is not a password reset link. Request a new one from the sign-in screen.');
      setState('invalid');
      return true;
    }
    try {
      if (callback.code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(callback.code);
        if (exchangeError) throw exchangeError;
      } else if (callback.accessToken && callback.refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
        });
        if (sessionError) throw sessionError;
      } else {
        throw new Error('Incomplete recovery link');
      }
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) throw userError || new Error('Invalid recovery session');
      setState('ready');
    } catch {
      setError('This reset link has expired or has already been used. Request a new one.');
      setState('invalid');
    }
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    const candidate = parameterUrl || linkUrl;
    void activate(candidate).then((handled) => {
      if (active && !handled && candidate) setState('invalid');
    });
    const fallback = setTimeout(() => {
      if (active && !candidate) {
        setError('This reset link is incomplete. Request a new one from the sign-in screen.');
        setState('invalid');
      }
    }, 800);
    return () => { active = false; clearTimeout(fallback); };
  }, [activate, linkUrl, parameterUrl]);

  const validationMessage = passwordValidationMessage(password, confirmation);
  const savePassword = async () => {
    if (validationMessage || busy || state !== 'ready') {
      setError(validationMessage);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setPassword('');
      setConfirmation('');
      setState('saved');
    } catch (updateError: any) {
      const message = String(updateError?.message || '');
      setError(/different|same password/i.test(message)
        ? 'Choose a password you haven’t used for this account.'
        : /network|fetch|offline|connection/i.test(message)
          ? 'Check your connection and try again.'
          : 'Could not update your password. Request a new reset link and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking') {
    return <Screen><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}><ActivityIndicator /><Text style={{ color: colors.text.muted }}>Checking your reset link…</Text></View></Screen>;
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: 30, paddingBottom: 36 }}>
          {state === 'saved' ? (
            <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
              <View style={{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent.success}20` }}>
                <Ionicons name="checkmark" size={28} color={colors.accent.success} />
              </View>
              <Text style={{ color: colors.text.secondary, fontSize: 30, fontWeight: '900' }}>Password updated</Text>
              <Text style={{ color: colors.text.muted, fontSize: 16, lineHeight: 23 }}>Your new password is ready. Sign in again to continue.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={({ pressed }) => ({ marginTop: 8, minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary, opacity: pressed ? 0.78 : 1 })}>
                <Text style={{ color: colors.text.inverted, fontWeight: '800', fontSize: 16 }}>Return to sign in</Text>
              </Pressable>
            </View>
          ) : state === 'invalid' ? (
            <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
              <View style={{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff6b6b18' }}>
                <Ionicons name="link-outline" size={25} color="#ff6b6b" />
              </View>
              <Text style={{ color: colors.text.secondary, fontSize: 28, fontWeight: '900' }}>Reset link unavailable</Text>
              <Text accessibilityRole="alert" style={{ color: colors.text.muted, fontSize: 16, lineHeight: 23 }}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/forgot-password')} style={({ pressed }) => ({ marginTop: 8, minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary, opacity: pressed ? 0.78 : 1 })}>
                <Text style={{ color: colors.text.inverted, fontWeight: '800', fontSize: 16 }}>Request a new link</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={{ color: colors.text.secondary, fontSize: 30, fontWeight: '900' }}>Choose a new password</Text>
              <Text style={{ marginTop: 10, color: colors.text.muted, fontSize: 16, lineHeight: 23 }}>Use at least 8 characters. You’ll sign in again after saving it.</Text>
              <View style={{ marginTop: 30, gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary }}>
                  <TextInput accessibilityLabel="New password" autoCapitalize="none" autoComplete="new-password" secureTextEntry={!showPassword} placeholder="New password" placeholderTextColor={colors.text.muted} value={password} onChangeText={(value) => { setPassword(value); setError(null); }} style={{ flex: 1, minHeight: 52, paddingHorizontal: 14, color: colors.text.secondary, fontSize: 16 }} />
                  <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(value => !value)} hitSlop={8} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.text.muted} />
                  </Pressable>
                </View>
                <TextInput accessibilityLabel="Confirm new password" autoCapitalize="none" autoComplete="new-password" secureTextEntry={!showPassword} placeholder="Confirm new password" placeholderTextColor={colors.text.muted} value={confirmation} onChangeText={(value) => { setConfirmation(value); setError(null); }} onSubmitEditing={() => { void savePassword(); }} style={{ minHeight: 52, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary, color: colors.text.secondary, fontSize: 16 }} />
                {error ? <Text accessibilityRole="alert" style={{ color: '#ff6b6b', lineHeight: 20 }}>{error}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void savePassword(); }} style={({ pressed }) => ({ minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent.primary, opacity: busy ? 0.55 : pressed ? 0.78 : 1 })}>
                  {busy ? <ActivityIndicator color={colors.text.inverted} /> : <Text style={{ color: colors.text.inverted, fontWeight: '800', fontSize: 16 }}>Save new password</Text>}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
