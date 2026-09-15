// Prepared batch; exact production approval still required before execution.
// No broad db push, relink, reset, or user-data deletion.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
if(process.argv[2]!=='--apply-approved-batch')throw new Error('Explicit apply flag required');
const versions=['20260913100000_harden_catalogue_avatars_demo','20260913120000_saved_artists'];
const sql=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id='411d016c-f17d-44b2-88a0-938e250c9fbc' AND p.username='ripple_qa' AND u.email='dev@wavemark.local') THEN RAISE EXCEPTION 'Demo identity changed'; END IF; END $$;
${versions.map(name=>fs.readFileSync('supabase/migrations/'+name+'.sql','utf8')+`\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${name.slice(0,14)}','${name.slice(15)}',ARRAY[$migration$${fs.readFileSync('supabase/migrations/'+name+'.sql','utf8')}$migration$]);`).join('\n')}
UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||'{"rppl_demo_reset_allowed":true}'::jsonb WHERE id='411d016c-f17d-44b2-88a0-938e250c9fbc';
COMMIT;`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rppl-approved-batch-')),file=path.join(dir,'apply.sql');fs.writeFileSync(file,sql);
execFileSync('/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase',['db','query','--linked','--project-ref','jvojjtjklqtmdtmeqqyy','--file',file,'--output','json'],{stdio:'pipe',timeout:60000});
console.log('Applied only hardening + saved_artists; enabled designated demo identity. No reset invoked.');
