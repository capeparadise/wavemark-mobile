const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const a=randomUUID(),b=randomUUID();
const migration=fs.readFileSync('supabase/migrations/20260913120000_saved_artists.sql','utf8');
const sql=`BEGIN;
SET LOCAL statement_timeout='30s';
${migration}
INSERT INTO auth.users(id) VALUES('${a}'),('${b}');
GRANT USAGE ON SCHEMA public TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${a}',true);
INSERT INTO public.saved_artists(user_id,provider,artist_id,artist_name) VALUES('${a}','spotify','2qanRMyA5bNuTvz1dK45OP','ADÉLA');
INSERT INTO public.saved_artists(user_id,provider,artist_id,artist_name) VALUES('${a}','spotify','2qanRMyA5bNuTvz1dK45OP','ADÉLA') ON CONFLICT(user_id,provider,artist_id) DO UPDATE SET artist_name=excluded.artist_name;
DO $$ BEGIN IF (SELECT count(*) FROM public.saved_artists)<>1 THEN RAISE EXCEPTION 'Duplicate bookmark'; END IF;
BEGIN INSERT INTO public.saved_artists(user_id,provider,artist_id,artist_name) VALUES('${b}','apple','123','Wrong owner'); RAISE EXCEPTION 'Forged owner accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','${b}',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.saved_artists) THEN RAISE EXCEPTION 'Private bookmark exposed'; END IF; END $$;
DELETE FROM public.saved_artists WHERE user_id='${a}';
SELECT set_config('request.jwt.claim.sub','${a}',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.saved_artists)<>1 THEN RAISE EXCEPTION 'Cross-user delete'; END IF; END $$;
DELETE FROM public.saved_artists WHERE user_id='${a}';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.saved_artists) THEN RAISE EXCEPTION 'Owner delete failed'; END IF; END $$;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users WHERE id='${a}') THEN RAISE EXCEPTION 'Fixture leaked'; END IF; END $$;`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rppl-bookmark-test-')),file=path.join(dir,'test.sql');
fs.writeFileSync(file,sql);
try{execFileSync('/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase',['db','query','--linked','--project-ref','mlciopffwtbopluuahoj','--file',file,'--output','json'],{stdio:'pipe',timeout:60000});console.log('PASS: private bookmarks, idempotent save, forged owner and cross-user deletion denied; rollback complete');}catch(e){console.error(String(e.stderr||e.message));process.exitCode=1;}
