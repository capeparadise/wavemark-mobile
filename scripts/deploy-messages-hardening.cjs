// Exact, owner-approved production change. No broad db push or row deletion.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.argv[2] !== '--apply-approved-migration') {
  throw new Error('Explicit apply flag required');
}

const cli = '/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const version = '20260913143000';
const name = 'lock_legacy_messages';
const migrationPath = path.join(__dirname, `../supabase/migrations/${version}_${name}.sql`);
const migration = fs.readFileSync(migrationPath, 'utf8');
const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.messages) <> 2 THEN
    RAISE EXCEPTION 'Legacy messages row count changed; refusing migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${version}'
  ) THEN
    RAISE EXCEPTION 'Migration already registered';
  END IF;
END $$;
${migration}
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('${version}', '${name}', ARRAY[$migration$${migration}$migration$]);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.messages) <> 2 THEN
    RAISE EXCEPTION 'Legacy messages rows were changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages'
  ) THEN
    RAISE EXCEPTION 'Messages policy remains';
  END IF;
END $$;
COMMIT;`;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rppl-approved-messages-'));
const file = path.join(directory, 'apply.sql');
fs.writeFileSync(file, sql, { mode: 0o600 });

try {
  execFileSync(cli, [
    'db', 'query', '--linked', '--project-ref', 'jvojjtjklqtmdtmeqqyy',
    '--file', file, '--output', 'json',
  ], { stdio: 'pipe', timeout: 120000 });
  console.log('Applied only legacy messages access hardening; preserved both rows.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
