import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { hasSeenFirstLogin } from '../lib/firstLogin';
import { useSession } from '../lib/session';

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
      const seen = await hasSeenFirstLogin(session.user.id);
      if (cancelled) return;
      if (!seen) router.replace('/(onboarding)/welcome');
      else router.replace('/(tabs)');
    })();
    return () => { cancelled = true; };
  }, [loading, session]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
