import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import Screen from '../components/Screen';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import type { ThemeColors } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

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
    <Text style={{ color: variant === 'primary' ? colors.text.inverted : colors.text.secondary, fontWeight: '600' }}>{title}</Text>
  </Pressable>
);

export default function LoginScreen() {
  const { user } = useSession();
  const router = useRouter();
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  // If already signed in, bounce to tabs
  useEffect(() => {
    if (user) router.replace('/(tabs)');
  }, [user]);

  const signIn = async () => {
    if (!email || !password) return Alert.alert('Enter email and password');
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      Alert.alert('Sign in failed', error.message);
    } else {
      Alert.alert('Signed in', `Welcome ${data.user.email ?? ''}`);
      router.replace('/(tabs)');
    }
  };

  const signUp = async () => {
    if (!email || !password) return Alert.alert('Enter email and password');
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      Alert.alert('Sign up failed', error.message);
    } else {
      Alert.alert('Account created', 'You can now sign in.');
      setMode('signin');
    }
  };

  const signOut = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);
    if (error) Alert.alert('Error', error.message);
    else Alert.alert('Signed out');
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ paddingTop: 6, paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text.secondary }}>Account</Text>
        <Text style={{ marginTop: 6, color: colors.text.muted }}>Sign in to sync your listens.</Text>
      </View>

      <View style={{ padding: 16 }}>
        {user ? (
          <>
            <Text style={{ fontSize: 16, marginBottom: 4, color: colors.text.muted }}>Signed in as</Text>
            <Text style={{ fontWeight: '600', marginBottom: 12, color: colors.text.secondary }}>{user.email ?? user.id}</Text>
            <Button title={busy ? 'Signing out…' : 'Sign out'} onPress={signOut} colors={colors} />
          </>
        ) : (
          <>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              placeholderTextColor={colors.text.muted}
              style={{ borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, color: colors.text.secondary, backgroundColor: colors.bg.secondary }}
            />
            <TextInput
              autoCapitalize="none"
              placeholder="password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholderTextColor={colors.text.muted}
              style={{ borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, color: colors.text.secondary, backgroundColor: colors.bg.secondary }}
            />

            {mode === 'signin' ? (
              <>
                <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={signIn} disabled={busy} colors={colors} />
                <Button variant="ghost" title="Create an account" onPress={() => setMode('signup')} colors={colors} />
              </>
            ) : (
              <>
                <Button title={busy ? 'Creating…' : 'Create account'} onPress={signUp} disabled={busy} colors={colors} />
                <Button variant="ghost" title="Back to sign in" onPress={() => setMode('signin')} colors={colors} />
              </>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}
