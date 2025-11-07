// Centralized function base with safe fallback
// Uses EXPO_PUBLIC_FN_BASE when provided; falls back to the deployed Supabase Functions URL.

export const FN_BASE: string = (() => {
  const env = process.env.EXPO_PUBLIC_FN_BASE ?? '';
  if (env && /^https?:\/\//i.test(env)) return env;
  // Fallback to the known functions base (public URL)
  return 'https://jvojjtjklqtmdtmeqqyy.functions.supabase.co';
})();
