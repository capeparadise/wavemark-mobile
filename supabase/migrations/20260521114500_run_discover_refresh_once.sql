-- WARNING: one-time operational Discover cache refresh.
--
-- This migration was already applied to production and is retained only
-- to match Supabase migration history.
--
-- It triggers a one-time Discover refresh using Vault-backed secrets.
-- This intentionally uses the same Vault-backed headers as the nightly
-- scheduler so no secret value is stored in source or shell history.
--
-- Do not copy or reuse this migration for future environments. Future
-- one-off refreshes must be run from an ops playbook or script, not
-- committed as schema migrations.

select net.http_post(
  url := 'https://jvojjtjklqtmdtmeqqyy.functions.supabase.co/spotify-search/discover-refresh',
  headers := jsonb_build_object(
    'Authorization',
    'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'DISCOVER_REFRESH_SECRET'
      order by created_at desc
      limit 1
    ),
    'apikey',
    (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'SUPABASE_ANON_KEY'
      order by created_at desc
      limit 1
    ),
    'Content-Type',
    'application/json'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 300000
);
