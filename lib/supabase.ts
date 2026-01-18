
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const rawAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabaseUrl = (rawUrl || '').trim();
const supabaseAnonKey = (rawAnon || '').trim();

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn('[supabase env] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY', {
    hasUrl: !!supabaseUrl,
    hasAnon: !!supabaseAnonKey,
    presentKeys: Object.keys(process.env).filter(k => k.startsWith('EXPO_PUBLIC_')),
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  db: { schema: 'public' },
});

export default supabase;


