const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const cli = '/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const fixtureId = randomUUID();
const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260913143000_lock_legacy_messages.sql'),
  'utf8',
);
const sql = `BEGIN;
SET LOCAL statement_timeout = '30s';
INSERT INTO public.messages(id, content, created_at)
VALUES ('${fixtureId}', 'synthetic rollback-only fixture', now());
${migration}
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF has_table_privilege(current_user, 'public.messages', 'SELECT')
     OR has_table_privilege(current_user, 'public.messages', 'INSERT')
     OR has_table_privilege(current_user, 'public.messages', 'UPDATE')
     OR has_table_privilege(current_user, 'public.messages', 'DELETE')
     OR has_table_privilege(current_user, 'public.messages', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Anonymous messages access remains';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF has_table_privilege(current_user, 'public.messages', 'SELECT')
     OR has_table_privilege(current_user, 'public.messages', 'INSERT')
     OR has_table_privilege(current_user, 'public.messages', 'UPDATE')
     OR has_table_privilege(current_user, 'public.messages', 'DELETE')
     OR has_table_privilege(current_user, 'public.messages', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Authenticated messages access remains';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = '${fixtureId}') THEN
    RAISE EXCEPTION 'Existing row was removed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages'
  ) THEN
    RAISE EXCEPTION 'Messages policy remains';
  END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.messages WHERE id = '${fixtureId}') THEN
    RAISE EXCEPTION 'Rollback fixture leaked';
  END IF;
END $$;`;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rppl-messages-hardening-'));
const file = path.join(directory, 'test.sql');
fs.writeFileSync(file, sql, { mode: 0o600 });

try {
  execFileSync(cli, [
    'db', 'query', '--linked', '--project-ref', 'mlciopffwtbopluuahoj',
    '--file', file, '--output', 'json',
  ], { stdio: 'pipe', timeout: 120000 });
  console.log('PASS: legacy message rows preserved, client access denied, fixture rolled back.');
} catch (error) {
  console.error(String(error.stderr || error.message));
  process.exitCode = 1;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
