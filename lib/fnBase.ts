// Centralized function base with safe fallback
// Uses EXPO_PUBLIC_FN_BASE when provided; falls back to the deployed Supabase Functions URL.

export const FN_BASE: string = (() => {
  const env = process.env.EXPO_PUBLIC_FN_BASE ?? '';
  if (env && /^https?:\/\//i.test(env)) return env;
  // Fallback to the known functions base (public URL)
  return 'https://jvojjtjklqtmdtmeqqyy.functions.supabase.co';
})();

export const SUPABASE_ANON_KEY: string = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

type FnHeadersInit = ConstructorParameters<typeof Headers>[0];

export function withFnHeaders(headers?: FnHeadersInit): Headers {
  const h = new Headers(headers);
  if (SUPABASE_ANON_KEY) {
    h.set('apikey', SUPABASE_ANON_KEY);
    h.set('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
  }
  return h;
}

export function fetchFn(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, headers: withFnHeaders(init.headers) });
}
