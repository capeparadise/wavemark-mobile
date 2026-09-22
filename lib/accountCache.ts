import AsyncStorage from '@react-native-async-storage/async-storage';

// Never read the legacy shared profile cache: its owner cannot be established.
export const accountCacheKey = (name: string, userId: string) => `${name}_${userId}`;

export async function readAccountCache<T>(name: string, userId: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(accountCacheKey(name, userId));
    const value = raw ? JSON.parse(raw) : null;
    return value?.userId === userId ? value.data as T : null;
  } catch { return null; }
}

export async function writeAccountCache<T>(name: string, userId: string, data: T) {
  try {
    await AsyncStorage.setItem(accountCacheKey(name, userId), JSON.stringify({ userId, data }));
  } catch { /* Cache failure must not prevent fresh content from rendering. */ }
}
