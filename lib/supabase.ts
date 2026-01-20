import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const rawAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function normalizeEnvValue(v: string) {
  const t = v.trim();
  return t.replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

const supabaseUrl = normalizeEnvValue(rawUrl || '');
const supabaseAnonKey = normalizeEnvValue(rawAnon || '');

function isPlaceholder(v: string) {
  return (
    v.includes('YOUR_PROJECT_REF') ||
    v.includes('YOUR_ANON_KEY') ||
    v.includes('YOUR_DEV_PASSWORD') ||
    /^YOUR_/i.test(v)
  );
}

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn('[supabase env] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY', {
    hasUrl: !!supabaseUrl,
    hasAnon: !!supabaseAnonKey,
    presentKeys: Object.keys(process.env).filter(k => k.startsWith('EXPO_PUBLIC_')),
  });
}

let _client: ReturnType<typeof createClient> | null = null;

function requireSupabaseEnv() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      '[supabase env] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Create a local `.env.local` with these values (see `.env.local.example`), then restart Expo with `npx expo start -c`.',
    );
  }

  if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseAnonKey)) {
    throw new Error(
      '[supabase env] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are still set to placeholder values. ' +
        'Update `.env.local` with your real Supabase project URL + anon key, then restart Expo with `npx expo start -c`.',
    );
  }

  if (!/^https:\/\//i.test(supabaseUrl)) {
    throw new Error('[supabase env] EXPO_PUBLIC_SUPABASE_URL must start with https:// (check `.env.local` and restart Expo).');
  }
}

function getClient() {
  if (_client) return _client;
  requireSupabaseEnv();
  _client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage as any,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    const client = getClient() as any;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as ReturnType<typeof createClient>;

export default supabase;
