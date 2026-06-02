# Discover refresh cron

`../migrations/20260521113000_restore_discover_refresh_cron.sql` installs the nightly Discover cache refresh job.

`../migrations/20260521113000_restore_discover_refresh_cron.sql` is the durable long-term scheduler fix.

`../migrations/20260521114500_run_discover_refresh_once.sql` exists only because it was used to run the same Vault-backed refresh once after restoring Vault values, and it is retained to match Supabase migration history. It should not be used as the future pattern for manual refreshes.

Future one-off Discover refreshes should live in an operations playbook or script and be run intentionally from there, not committed as schema migrations.

Schedule: daily at `03:00 UTC`.

Endpoint:

```text
https://jvojjtjklqtmdtmeqqyy.functions.supabase.co/spotify-search/discover-refresh
```

The job reads these Supabase Vault secrets at runtime:

- `DISCOVER_REFRESH_SECRET`: must match the Edge Function secret with the same name.
- `SUPABASE_ANON_KEY`: the project anon key, used as the `apikey` header.

If Vault does not already contain them, add them in the Supabase Dashboard without pasting values into source:

1. Open the Wavemark project in Supabase Dashboard.
2. Go to **Project Settings -> Vault**.
3. Add or update `DISCOVER_REFRESH_SECRET` with the existing Edge Function secret value.
4. Add or update `SUPABASE_ANON_KEY` with the project anon key.
5. Apply migrations with `supabase db push --linked`.
6. Manually test the refresh endpoint once with `Authorization: Bearer <DISCOVER_REFRESH_SECRET>` and `apikey: <SUPABASE_ANON_KEY>`.

Do not store the bearer secret in migrations, scripts, docs, or committed environment files.
