import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getHasSeenOnboarding } from '../lib/onboarding';
import { useSession } from '../lib/session';

const POST_AUTH_REDIRECT_KEY = 'wavemark:post-auth-redirect';

export default function SessionGateScreen() {
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      if (!session) {
        router.replace('/(auth)/welcome');
        return;
      }
      const hasSeenOnboarding = await getHasSeenOnboarding();
      if (cancelled) return;
      if (!hasSeenOnboarding) {
        router.replace('/onboarding');
        return;
      }
      try {
        const redirect = await AsyncStorage.getItem(POST_AUTH_REDIRECT_KEY);
        if (cancelled) return;
        if (redirect && typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') && redirect !== '/session') {
          await AsyncStorage.removeItem(POST_AUTH_REDIRECT_KEY);
          if (cancelled) return;
          router.replace(redirect as any);
          return;
        }
      } catch {}
      router.replace('/(tabs)');
    })();
    return () => { cancelled = true; };
  }, [loading, session]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
