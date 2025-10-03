// lib/devAuth.ts
import { supabase } from './supabase';

const email = process.env.EXPO_PUBLIC_SUPABASE_DEV_EMAIL;
const password = process.env.EXPO_PUBLIC_SUPABASE_DEV_PASSWORD;

/**
 * Dev-only helper: ensure a Supabase session exists so RLS inserts work.
 * Call once on app start (behind __DEV__) after env vars are set.
 */
export async function ensureDevSignIn() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      console.log('[devAuth] signed in as', session.user.email);
      return;
    }
    if (!email || !password) {
      console.warn('[devAuth] Missing EXPO_PUBLIC_SUPABASE_DEV_EMAIL/PASSWORD');
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('[devAuth] sign-in failed:', error.message);
    } else {
      console.log('[devAuth] signed in as', data.user?.email);
    }
  } catch (e) {
    console.error('[devAuth] unexpected error:', e);
  }
}
