import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../lib/session';

export default function SessionGateScreen() {
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (session) router.replace('/(tabs)');
    else router.replace('/(auth)/welcome');
  }, [loading, session]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}

