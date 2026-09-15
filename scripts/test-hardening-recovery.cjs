const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const cli='/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const uid=randomUUID(), other=randomUUID();
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260913100000_harden_catalogue_avatars_demo.sql'),'utf8');
const sql=`BEGIN;
SET LOCAL statement_timeout='30s';
-- Restored recovery buckets are private; reproduce production's public bucket
-- inside the rollback-only transaction to verify the migration preserves it.
UPDATE storage.buckets SET public=true WHERE id='avatars';
${migration}
INSERT INTO auth.users(id) VALUES('${uid}'),('${other}');
INSERT INTO public.profiles(id,display_name) VALUES('${uid}','Fixture'),('${other}','Untouched fixture') ON CONFLICT DO NOTHING;
INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','${uid}/probe.jpg'),('avatars','${other}/probe.jpg');
GRANT USAGE ON SCHEMA public,storage TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${uid}',true);
DO $$ BEGIN
  IF has_table_privilege(current_user,'public.artists','INSERT') OR has_table_privilege(current_user,'public.releases','UPDATE') THEN RAISE EXCEPTION 'Catalogue grants open'; END IF;
  IF has_function_privilege(current_user,'public.reset_demo_profile_internal()','EXECUTE') THEN RAISE EXCEPTION 'Internal reset exposed'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE name IN ('${uid}/probe.jpg','${other}/probe.jpg')) <> 1 THEN RAISE EXCEPTION 'Avatar listing not isolated'; END IF;
  BEGIN PERFORM public.reset_my_demo_profile(); EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
  RAISE EXCEPTION 'Unapproved reset allowed';
END $$;
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data='{"rppl_demo_reset_allowed":true}' WHERE id='${uid}';
SET LOCAL ROLE authenticated;
SELECT public.reset_my_demo_profile();
RESET ROLE;
DO $$ BEGIN
 IF (SELECT display_name FROM public.profiles WHERE id='${other}') <> 'Untouched fixture' THEN RAISE EXCEPTION 'Other profile changed'; END IF;
 IF NOT (SELECT public FROM storage.buckets WHERE id='avatars') THEN RAISE EXCEPTION 'Public avatar URLs disabled'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users WHERE id='${uid}') THEN RAISE EXCEPTION 'Fixture leaked'; END IF; END $$;`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rppl-hardening-')), file=path.join(dir,'test.sql');
fs.writeFileSync(file,sql);
try { execFileSync(cli,['db','query','--linked','--project-ref','mlciopffwtbopluuahoj','--file',file,'--output','json'],{stdio:'pipe',timeout:120000}); console.log('PASS: catalogue grants, avatar listing, denied/approved demo reset; all changes rolled back.'); }
catch(e){console.error(String(e.stderr||e.message));process.exitCode=1;}
