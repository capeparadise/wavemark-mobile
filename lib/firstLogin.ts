import AsyncStorage from '@react-native-async-storage/async-storage';

function keyForUser(userId: string) {
  return `wavemark:first-login-seen:${userId}`;
}

export async function hasSeenFirstLogin(userId: string): Promise<boolean> {
  if (!userId) return true;
  try {
    const v = await AsyncStorage.getItem(keyForUser(userId));
    return v === '1';
  } catch {
    return true;
  }
}

export async function markFirstLoginSeen(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyForUser(userId), '1');
  } catch {}
}

