-- Restore the Discover cache refresh scheduler.
--
-- This job runs daily at 03:00 UTC and calls the spotify-search
-- discover-refresh route. Secrets are intentionally read from Supabase
-- Vault at execution time so bearer/API keys are not stored in source.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'discover-refresh-nightly'
  ) then
    perform cron.unschedule('discover-refresh-nightly');
  end if;
end $$;

select cron.schedule(
  'discover-refresh-nightly',
  '0 3 * * *',
  $job$
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
  $job$
);
