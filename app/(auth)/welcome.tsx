import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
}: { title: string; onPress: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; colors: ThemeColors }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    style={({ pressed }) => ({
      minHeight: 52,
      paddingVertical: 14,
      paddingHorizontal: 18,
      borderRadius: 14,
      backgroundColor: variant === 'primary' ? colors.text.primary : 'rgba(255,255,255,0.07)',
      borderWidth: 1,
      borderColor: variant === 'primary' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.13)',
      opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.shadow.light,
      shadowOpacity: variant === 'primary' ? 0.2 : 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
    })}
  >
    <Text style={{
      color: variant === 'primary' ? colors.bg.primary : colors.text.secondary,
      fontSize: 17,
      lineHeight: 20,
      fontWeight: '600',
    }}>
      {title}
    </Text>
  </Pressable>
);

export default function WelcomeScreen() {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
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
      const returnUrl = AuthSession.makeRedirectUri({ scheme: 'rppl', path: 'session' });
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

  const compact = height < 720;

  return (
    <Screen edges={['left', 'right']} style={styles.screen}>
      <View style={[styles.content, { paddingTop: compact ? 42 : 72, paddingBottom: compact ? 28 : 48 }]}>
        <View style={styles.brandArea}>
          <BrandLogo
            variant="dark"
            height={50}
            style={[styles.logo, { tintColor: colors.text.primary }]}
          />
          <View style={[styles.wordmarkRule, { backgroundColor: colors.accent.primary }]} />
        </View>

        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text.primary }]}>Welcome</Text>
          <Text style={[styles.subtitle, { color: colors.text.subtle }]}>
            Sign in to sync your listens across devices.
          </Text>
        </View>

        <View style={styles.actions}>
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
            variant="secondary"
          />
          {appleAvailable ? (
            <View pointerEvents={busy ? 'none' : 'auto'} style={[styles.appleButtonWrap, { opacity: busy ? 0.5 : 1 }]}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={14}
                style={styles.appleButton}
                onPress={continueWithApple}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 24,
    paddingTop: 0,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  brandArea: {
    alignItems: 'center',
  },
  logo: {
    opacity: 0.96,
  },
  wordmarkRule: {
    width: 34,
    height: 2,
    borderRadius: 1,
    marginTop: 14,
    opacity: 0.72,
  },
  copy: {
    marginTop: 38,
    alignItems: 'center',
  },
  title: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 290,
  },
  actions: {
    marginTop: 36,
    gap: 12,
    width: '100%',
  },
  appleButtonWrap: {
    width: '100%',
  },
  appleButton: {
    width: '100%',
    height: 52,
  },
});
