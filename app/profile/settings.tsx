import React, { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import PlayerToggle from '../../components/PlayerToggle';
import Screen from '../../components/StackScreen';
import { deleteAccount } from '../../lib/accountDeletion';
import { emit } from '../../lib/events';
import { supabase } from '../../lib/supabase';
import { getAdvancedRatingsEnabled, setAdvancedRatingsEnabled } from '../../lib/user';
import { isHapticsEnabled, setHapticsEnabled } from '../../components/haptics';
import { useTheme } from '../../theme/useTheme';

export default function ProfileSettingsPage() {
  const { colors } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [advEnabled, setAdvEnabled] = useState<boolean>(false);
  const [advSaving, setAdvSaving] = useState<boolean>(false);
  const [hapticsEnabled, setHapticsEnabledState] = useState<boolean>(true);
  const [hapticSaving, setHapticSaving] = useState<boolean>(false);

  useEffect(() => {
    // Load advanced rating preference
    getAdvancedRatingsEnabled().then(setAdvEnabled).catch(() => setAdvEnabled(false));
    // Load haptics pref
    setHapticsEnabledState(isHapticsEnabled());
  }, []);

  const APPLE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_APPLE === 'true';

  const currentUserUsesApple = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user as any;
    const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    return providers.includes('apple') || identities.some((identity: any) => identity?.provider === 'apple');
  };

  const getAppleAuthorizationCode = async () => {
    const available = await AppleAuthentication.isAvailableAsync().catch(() => false);
    if (!available) {
      throw new Error('Apple reauthorization is not available on this device.');
    }
    const credential = await AppleAuthentication.signInAsync();
    const code = credential.authorizationCode?.trim();
    if (!code) {
      throw new Error('Apple did not return an authorization code. Please try again.');
    }
    return code;
  };

  const onSignOut = () => {
    if (signingOut) return;
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            setSigningOut(true);
            const { error } = await supabase.auth.signOut();
            if (error) {
              Alert.alert('Sign out failed', error.message);
              return;
            }
            router.replace('/session');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const runDeleteAccount = async () => {
    if (deletingAccount) return;
    try {
      setDeletingAccount(true);
      const usesApple = await currentUserUsesApple();
      const appleAuthorizationCode = usesApple ? await getAppleAuthorizationCode() : null;
      const result = await deleteAccount({ appleAuthorizationCode });
      if (!result.ok) {
        Alert.alert('Delete account failed', result.message || 'Could not delete your account. Please try again.');
        return;
      }
      router.replace('/(auth)/welcome');
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Delete account failed', e?.message || 'Could not delete your account. Please try again.');
    } finally {
      setDeletingAccount(false);
    }
  };

  const onDeleteAccount = () => {
    if (deletingAccount) return;
    Alert.alert(
      'Delete account?',
      'This permanently removes your profile, saved releases, follows, connections, and account data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete permanently?',
              'This is the final confirmation. Your RPPL account and account data will be removed permanently.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete Account', style: 'destructive', onPress: runDeleteAccount },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8, color: colors.text.secondary }}>Settings</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 18 }}>Manage your app preferences.</Text>

      {APPLE_ENABLED ? (
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Default player</Text>
          <Text style={{ color: colors.text.muted, marginBottom: 8 }}>Choose where releases open.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text style={{ fontSize: 16, color: colors.text.secondary }}>Player</Text>
            <PlayerToggle />
          </View>
        </View>
      ) : null}

      {/* Advanced rating mode */}
      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Advanced rating mode</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 8 }}>Enable detailed category sliders when rating songs.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
          <Text style={{ fontSize: 16, color: colors.text.secondary }}>Enable</Text>
          <Switch
            value={advEnabled}
            onValueChange={async (v) => {
              if (advSaving) return;
              setAdvSaving(true);
              setAdvEnabled(v);
              const ok = await setAdvancedRatingsEnabled(v);
              if (!ok) {
                setAdvEnabled(!v);
                Alert.alert('Could not save preference');
              }
              if (ok) {
                // notify app so listeners can update immediately
                try { emit('prefs:advanced_ratings', v); } catch {}
              }
              setAdvSaving(false);
            }}
            trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
            thumbColor={advEnabled ? colors.text.inverted : colors.bg.primary}
            ios_backgroundColor={colors.border.subtle}
          />
        </View>
      </View>

        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Haptics</Text>
          <Text style={{ color: colors.text.muted, marginBottom: 8 }}>Turn on/off haptic feedback.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text style={{ fontSize: 16, color: colors.text.secondary }}>Enable</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={async (v) => {
                if (hapticSaving) return;
                setHapticSaving(true);
                setHapticsEnabledState(v);
                try {
                  await setHapticsEnabled(v);
                } catch {
                  setHapticsEnabledState(!v);
                  Alert.alert('Could not save preference');
                }
                setHapticSaving(false);
              }}
              trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
              thumbColor={hapticsEnabled ? colors.text.inverted : colors.bg.primary}
              ios_backgroundColor={colors.border.subtle}
            />
          </View>
      </View>

        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Account</Text>
          <Pressable
            onPress={onSignOut}
            disabled={signingOut || deletingAccount}
            style={{
              padding: 12,
              borderRadius: 14,
              backgroundColor: colors.bg.secondary,
              borderWidth: 1,
              borderColor: colors.border.subtle,
              opacity: signingOut || deletingAccount ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontWeight: '700', color: '#ff3b30' }}>
                Sign out
              </Text>
              {signingOut ? <ActivityIndicator /> : null}
            </View>
          </Pressable>
        </View>

        <View style={{ marginTop: 26, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border.subtle }}>
          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Delete account</Text>
          <Text style={{ color: colors.text.muted, marginBottom: 10 }}>
            Permanently remove your account and RPPL data.
          </Text>
          <Pressable
            onPress={onDeleteAccount}
            disabled={deletingAccount || signingOut}
            accessibilityRole="button"
            accessibilityLabel="Delete Account"
            style={{
              minHeight: 48,
              padding: 12,
              borderRadius: 14,
              backgroundColor: colors.bg.secondary,
              borderWidth: 1,
              borderColor: '#ff3b30',
              opacity: deletingAccount || signingOut ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontWeight: '800', color: '#ff3b30' }}>
                Delete Account
              </Text>
              {deletingAccount ? <ActivityIndicator /> : null}
            </View>
          </Pressable>
        </View>
	      </ScrollView>
	    </Screen>
	  );
	}
