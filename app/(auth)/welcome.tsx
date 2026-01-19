import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import { supabase } from '../../lib/supabase';
import type { ThemeColors } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

WebBrowser.maybeCompleteAuthSession();

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

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const continueWithGoogle = async () => {
    try {
      setBusy(true);
      const useProxy = Constants.appOwnership === 'expo';
      const redirectTo = AuthSession.makeRedirectUri({ useProxy, path: 'session' });
      console.log('Google OAuth redirectTo:', redirectTo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Missing OAuth URL');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) {
        setBusy(false);
        return;
      }

      const parsed = Linking.parse(result.url);
      const qp = (parsed.queryParams ?? {}) as Record<string, string | string[] | undefined>;
      const errorDescription = (qp.error_description ?? qp.error) as string | undefined;
      if (errorDescription) throw new Error(errorDescription);

      const code = qp.code as string | undefined;
      if (!code) throw new Error('Missing OAuth code');

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ paddingTop: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text.secondary }}>Welcome</Text>
        <Text style={{ marginTop: 8, color: colors.text.muted }}>
          Sign in to sync your listens across devices.
        </Text>

        <View style={{ marginTop: 18 }}>
          <Button
            title="Continue with Email"
            onPress={() => router.push('/(auth)/login')}
            disabled={busy}
            colors={colors}
          />
          <Button
            title={busy ? 'Opening Google…' : 'Continue with Google'}
            onPress={continueWithGoogle}
            disabled={busy}
            colors={colors}
          />
        </View>
      </View>
    </Screen>
  );
}
