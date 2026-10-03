import React, { useCallback, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Screen from '../../components/StackScreen';
import { deleteAccount } from '../../lib/accountDeletion';
import { supabase } from '../../lib/supabase';
import { countIncomingPendingRequests } from '../../lib/profileSocial';
import { getDemoSnapshotSummary, resetDemoProfile, restoreDemoProfile, type DemoSnapshotSummary } from '../../lib/demoProfile';
import { useTheme } from '../../theme/useTheme';

export default function ProfileSettingsPage() {
  const { colors } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [requestsHasDot, setRequestsHasDot] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoSnapshot, setDemoSnapshot] = useState<DemoSnapshotSummary | null>(null);


  useFocusEffect(useCallback(() => {
    countIncomingPendingRequests()
      .then((count) => setRequestsHasDot(count > 0))
      .catch(() => setRequestsHasDot(false));
    if (__DEV__) {
      getDemoSnapshotSummary().then(setDemoSnapshot).catch(() => setDemoSnapshot(null));
    }
  }, []));

  const runDemoReset = async () => {
    if (demoBusy) return;
    try {
      setDemoBusy(true);
      const result = await resetDemoProfile();
      setDemoSnapshot(result.snapshot);
      router.replace({ pathname: '/profile/setup', params: { next: 'home', demoReset: '1' } });
    } catch (e: any) {
      Alert.alert('Reset failed', e?.message || 'Could not reset the demo profile.');
    } finally {
      setDemoBusy(false);
    }
  };

  const onDemoReset = () => {
    Alert.alert(
      'Reset demo profile?',
      'A local backup will be saved first. This clears the listener name, photo, saved music, history, ratings, artist follows and listener connections. The login stays signed in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset profile', style: 'destructive', onPress: runDemoReset },
      ],
    );
  };

  const runDemoRestore = async () => {
    if (demoBusy) return;
    try {
      setDemoBusy(true);
      const result = await restoreDemoProfile();
      setDemoSnapshot(null);
      Alert.alert('Demo profile restored', `${result.label} is ready to use again.`);
      router.replace('/(tabs)/profile');
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message || 'Could not restore the saved demo profile.');
    } finally {
      setDemoBusy(false);
    }
  };

  const onDemoRestore = () => {
    if (!demoSnapshot) return;
    Alert.alert(
      `Restore ${demoSnapshot.label}?`,
      'This replaces the current demo data with the locally saved profile, listening activity and artist follows.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', onPress: runDemoRestore },
      ],
    );
  };


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

  const ProfileDestination = ({
    label,
    detail,
    icon,
    onPress,
    dot,
  }: {
    label: string;
    detail: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    dot?: boolean;
  }) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.subtle,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View style={{ width: 28, alignItems: 'center' }}>
        <Ionicons name={icon} size={20} color={colors.accent.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text style={{ color: colors.text.secondary, fontSize: 15, fontWeight: '800' }}>{label}</Text>
          {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff3b30' }} /> : null}
        </View>
        <Text style={{ color: colors.text.muted, fontSize: 12, marginTop: 2 }}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.text.muted} />
    </Pressable>
  );

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8, color: colors.text.secondary }}>Settings</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 18 }}>Manage your profile and app preferences.</Text>

        <View style={{ marginBottom: 24 }}>
          <ProfileDestination label="Ratings" detail="Your ratings, to rate, notes and preferences" icon="star-outline" onPress={() => router.push('/profile/rating-hub')} />
          <ProfileDestination label="Edit profile" detail="Display name, username and privacy" icon="person-outline" onPress={() => router.push('/profile/setup')} />
          <ProfileDestination label="General" detail="Haptics and app preferences" icon="options-outline" onPress={() => router.push('/profile/general-settings')} />
          <ProfileDestination label="People" detail="Requests, followers and following" icon="people-outline" dot={requestsHasDot} onPress={() => router.push('/profile/people')} />
          <ProfileDestination label="Insights" detail="Explore your listening patterns" icon="stats-chart-outline" onPress={() => router.push('/profile/insights')} />
          <ProfileDestination label="Share profile" detail="Create your listener profile card" icon="share-outline" onPress={() => router.push('/profile/share-card')} />
        </View>

        {__DEV__ ? (
          <View style={{ marginTop: 8, marginBottom: 26, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border.subtle }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Ionicons name="construct-outline" size={18} color={colors.accent.primary} />
              <Text style={{ fontWeight: '800', color: colors.text.secondary }}>Demo tools</Text>
            </View>
            <Text style={{ color: colors.text.muted, marginBottom: 10 }}>
              Start a clean fictional listener while keeping this login. A local backup is created before each reset.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset demo profile"
              onPress={onDemoReset}
              disabled={demoBusy}
              style={({ pressed }) => ({
                minHeight: 48,
                padding: 12,
                borderRadius: 14,
                backgroundColor: colors.bg.secondary,
                borderWidth: 1,
                borderColor: colors.accent.primary,
                opacity: demoBusy ? 0.55 : pressed ? 0.75 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ color: colors.accent.primary, fontWeight: '800' }}>Reset demo profile</Text>
                {demoBusy ? <ActivityIndicator /> : <Ionicons name="refresh" size={18} color={colors.accent.primary} />}
              </View>
            </Pressable>
            {demoSnapshot ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Restore ${demoSnapshot.label}`}
                onPress={onDemoRestore}
                disabled={demoBusy}
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: 'center',
                  marginTop: 8,
                  paddingHorizontal: 12,
                  opacity: demoBusy ? 0.55 : pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Restore {demoSnapshot.label}</Text>
                <Text style={{ color: colors.text.muted, fontSize: 12, marginTop: 2 }}>Listening activity and artist follows</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

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
