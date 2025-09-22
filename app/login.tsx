import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { useSession } from './lib/session';
import { supabase } from './lib/supabaseClient';

const Button = ({
  title, onPress, variant = 'primary', disabled = false,
}: { title: string; onPress: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => ({
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: variant === 'primary' ? '#2563eb' : 'transparent',
      borderWidth: variant === 'ghost' ? 1 : 0,
      borderColor: '#e5e7eb',
      opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      alignItems: 'center',
      marginTop: 10,
    })}
  >
    <Text style={{ color: variant === 'primary' ? 'white' : '#111827', fontWeight: '600' }}>{title}</Text>
  </Pressable>
);

export default function LoginScreen() {
  const { user } = useSession();
  const router = useRouter();

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
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: '700' }}>Account</Text>
      </View>

      <View style={{ padding: 16 }}>
        {user ? (
          <>
            <Text style={{ fontSize: 16, marginBottom: 4 }}>Signed in as</Text>
            <Text style={{ fontWeight: '600', marginBottom: 12 }}>{user.email ?? user.id}</Text>
            <Button title={busy ? 'Signing out…' : 'Sign out'} onPress={signOut} />
          </>
        ) : (
          <>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }}
            />
            <TextInput
              autoCapitalize="none"
              placeholder="password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }}
            />

            {mode === 'signin' ? (
              <>
                <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={signIn} disabled={busy} />
                <Button variant="ghost" title="Create an account" onPress={() => setMode('signup')} />
              </>
            ) : (
              <>
                <Button title={busy ? 'Creating…' : 'Create account'} onPress={signUp} disabled={busy} />
                <Button variant="ghost" title="Back to sign in" onPress={() => setMode('signin')} />
              </>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
