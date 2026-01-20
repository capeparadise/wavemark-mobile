// Centralized function base with safe fallback
// Uses EXPO_PUBLIC_FN_BASE when provided; falls back to the deployed Supabase Functions URL.

export const FN_BASE: string = (() => {
  const env = process.env.EXPO_PUBLIC_FN_BASE ?? '';
  if (env && /^https?:\/\//i.test(env)) return env.replace(/\/+$/, '');

  // If we have a Supabase URL, derive the functions base from it so the app
  // automatically matches whatever project `.env.local` points at.
  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/^['"]/, '').replace(/['"]$/, '');
  const m = supabaseUrl.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
  if (m?.[1]) return `https://${m[1]}.functions.supabase.co`;

  // Final fallback (legacy/dev)
  return 'https://jvojjtjklqtmdtmeqqyy.functions.supabase.co';
})();
