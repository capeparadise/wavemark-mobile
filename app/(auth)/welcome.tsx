import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import BrandLogo from '../../components/BrandLogo';
import Screen from '../../components/Screen';
import { supabase } from '../../lib/supabase';
import type { ThemeColors } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';

WebBrowser.maybeCompleteAuthSession();

function getExpoAuthProxyRedirectUrl() {
  const fullName =
    (Constants.expoConfig as any)?.originalFullName ||
    ((Constants.expoConfig as any)?.owner && (Constants.expoConfig as any)?.slug
      ? `@${(Constants.expoConfig as any).owner}/${(Constants.expoConfig as any).slug}`
      : null);
  if (!fullName) return null;
  const normalized = String(fullName).startsWith('@') ? String(fullName) : `@${fullName}`;
  return `https://auth.expo.io/${normalized}`;
}

function redactUrl(url: string) {
  try {
    const u = new URL(url);
    const redactParams = (params: URLSearchParams) => {
      for (const key of ['access_token', 'refresh_token', 'id_token', 'provider_token', 'token']) {
        if (params.has(key)) params.set(key, 'REDACTED');
      }
    };
    redactParams(u.searchParams);
    if (u.hash?.startsWith('#')) {
      const h = new URLSearchParams(u.hash.slice(1));
      redactParams(h);
      u.hash = `#${h.toString()}`;
    }
    return u.toString();
  } catch {
    return url.replace(/(access_token|refresh_token|id_token|provider_token)=([^&#]+)/g, '$1=REDACTED');
  }
}

function extractParamsFromUrl(url: string) {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : '';
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  return {
    queryParams: new URLSearchParams(query),
    hashParams: new URLSearchParams(hash),
  };
}

function formatAppleFullName(fullName: AppleAuthentication.AppleAuthenticationFullName | null) {
  if (!fullName) return null;
  const value = [
    fullName.namePrefix,
    fullName.givenName,
    fullName.middleName,
    fullName.familyName,
    fullName.nameSuffix,
  ]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return value || null;
}

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
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) setAppleAvailable(available);
      })
      .catch(() => {
        if (mounted) setAppleAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const continueWithGoogle = async () => {
    try {
      setBusy(true);
      const returnUrl = AuthSession.makeRedirectUri({ path: 'session' });
      const proxyRedirectTo = getExpoAuthProxyRedirectUrl();
      const redirectTo = Constants.appOwnership === 'expo' && proxyRedirectTo
        ? proxyRedirectTo
        : returnUrl;
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

      const authUrl = Constants.appOwnership === 'expo' && proxyRedirectTo
        ? `${proxyRedirectTo}/start?${new URLSearchParams({ authUrl: data.url, returnUrl }).toString()}`
        : data.url;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);
      if (result.type !== 'success' || !result.url) {
        setBusy(false);
        return;
      }

      console.log('Google OAuth returned URL:', redactUrl(result.url));

      const { queryParams, hashParams } = extractParamsFromUrl(result.url);
      const errorDescription = queryParams.get('error_description')
        ?? queryParams.get('error')
        ?? hashParams.get('error_description')
        ?? hashParams.get('error');
      if (errorDescription) throw new Error(errorDescription);

      const code = queryParams.get('code') ?? hashParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
        return;
      }

      const access_token = hashParams.get('access_token') ?? queryParams.get('access_token');
      const refresh_token = hashParams.get('refresh_token') ?? queryParams.get('refresh_token');
      if (access_token && refresh_token) {
        const { error: setSessionError } = await supabase.auth.setSession({ access_token, refresh_token });
        if (setSessionError) throw setSessionError;
        return;
      }

      console.error('Google OAuth missing code/tokens:', redactUrl(result.url));
      throw new Error('Missing OAuth code');
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const continueWithApple = async () => {
    try {
      setBusy(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const identityToken = credential.identityToken;
      if (!identityToken) {
        throw new Error('Apple did not return an identity token. Please try again.');
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
      });
      if (error) throw error;

      const fullName = formatAppleFullName(credential.fullName);
      if (fullName) {
        await supabase.auth.updateUser({ data: { full_name: fullName } }).catch(() => {});
      }
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple sign-in failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ paddingTop: 14 }}>
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <BrandLogo height={34} />
        </View>
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
          {appleAvailable ? (
            <View pointerEvents={busy ? 'none' : 'auto'} style={{ opacity: busy ? 0.5 : 1, marginTop: 10 }}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={10}
                style={{ width: '100%', height: 44 }}
                onPress={continueWithApple}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
