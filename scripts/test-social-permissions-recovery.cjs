// Rollback-only database-role tests. Production requires an explicit verify flag;
// that mode never changes policies/grants or reproduces the insecure baseline.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const cli = '/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const production = process.argv.includes('--production-verify');
const project = production ? 'jvojjtjklqtmdtmeqqyy' : 'mlciopffwtbopluuahoj';
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913090000_enforce_connection_and_rating_ownership.sql'), 'utf8');
const [a,b,c,artist,release,request,rating] = Array.from({length:7}, randomUUID);
const asUser = id => `RESET ROLE; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',true);`;
const check = (query, denied=false) => `DO $test$ BEGIN
  ${denied ? `BEGIN ${query}; EXCEPTION WHEN insufficient_privilege THEN RETURN; END; RAISE EXCEPTION 'Expected permission denial';` : query + ';'}
END $test$;`;
const assert = condition => check(`IF NOT (${condition}) THEN RAISE EXCEPTION 'Assertion failed'; END IF`);
function run(fixed) {
  const sql = `BEGIN;
SET LOCAL statement_timeout = '30s';
-- Recovery restore omits client grants. Match audited production grants only
-- for this transaction, without weakening or replacing its RLS policies.
${production ? '' : `GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_requests, public.ratings TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_listener(uuid), public.respond_to_follow_request(uuid,boolean) TO authenticated;`}
${fixed && !production ? migration : ''}
INSERT INTO auth.users(id) VALUES ('${a}'),('${b}'),('${c}');
INSERT INTO public.profiles(id,display_name,is_private) VALUES
('${a}','Permission fixture A',true),('${b}','Permission fixture B',true),('${c}','Permission fixture C',true)
ON CONFLICT(id) DO NOTHING;
UPDATE public.profiles SET profile_setup_completed=true, username='probe_' || left(replace(id::text,'-',''),12)
WHERE id IN ('${a}','${b}','${c}');
INSERT INTO public.artists(id,name) VALUES('${artist}','Synthetic permission artist');
INSERT INTO public.releases(id,artist_id,title,release_type) VALUES('${release}','${artist}','Synthetic permission release','single');
${asUser(a)}
INSERT INTO public.friend_requests(id,requester_id,recipient_id,status) VALUES('${request}','${a}','${b}','pending');
${check(`UPDATE public.friend_requests SET status='accepted' WHERE id='${request}'`, fixed)}
${check(`INSERT INTO public.ratings(id,user_id,release_id,rating) VALUES('${rating}','${b}','${release}',3)`, fixed)}
RESET ROLE;
${assert(`(SELECT count(*) FROM public.profile_follows WHERE follower_id='${a}' AND following_id='${b}' AND status='accepted') = ${fixed ? 0 : 1}`)}
${fixed ? `
${asUser(a)}
${check(`UPDATE public.friend_requests SET recipient_id='${c}' WHERE id='${request}'`,true)}
INSERT INTO public.ratings(id,user_id,release_id,rating) VALUES('${rating}','${a}','${release}',3);
UPDATE public.ratings SET rating=4 WHERE id='${rating}';
${assert(`(SELECT rating FROM public.ratings WHERE id='${rating}')=4`)}
${check(`UPDATE public.ratings SET user_id='${b}' WHERE id='${rating}'`,true)}
${asUser(c)}
${assert(`(SELECT count(*) FROM public.ratings WHERE id='${rating}')=0`)}
UPDATE public.friend_requests SET status='accepted' WHERE id='${request}';
${assert(`(SELECT count(*) FROM public.friend_requests WHERE id='${request}')=0`)}
${asUser(b)}
UPDATE public.friend_requests SET status='declined' WHERE id='${request}';
${assert(`(SELECT status FROM public.friend_requests WHERE id='${request}')='declined'`)}
${asUser(a)}
UPDATE public.friend_requests SET status='pending' WHERE id='${request}';
${asUser(b)}
UPDATE public.friend_requests SET status='accepted' WHERE id='${request}';
${assert(`(SELECT status FROM public.friend_requests WHERE id='${request}')='accepted'`)}
RESET ROLE;
${assert(`(SELECT count(*) FROM public.profile_follows WHERE follower_id='${a}' AND following_id='${b}' AND status='accepted')=1`)}
${asUser(a)}
${check(`UPDATE public.friend_requests SET status='pending' WHERE id='${request}'`,true)}
DELETE FROM public.ratings WHERE id='${rating}';
${assert(`(SELECT count(*) FROM public.ratings WHERE id='${rating}')=0`)}
${asUser(c)}
SELECT public.follow_listener('${b}');
SELECT public.respond_to_follow_request('${c}',true);
RESET ROLE;
${assert(`(SELECT status FROM public.profile_follows WHERE follower_id='${c}' AND following_id='${b}')='pending'`)}
${asUser(b)}
SELECT public.respond_to_follow_request('${c}',true);
RESET ROLE;
${assert(`(SELECT status FROM public.profile_follows WHERE follower_id='${c}' AND following_id='${b}')='accepted'`)}
` : ''}
RESET ROLE;
ROLLBACK;
${assert(`NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN ('${a}','${b}','${c}'))`)}
${assert(`NOT EXISTS (SELECT 1 FROM public.artists WHERE id='${artist}')`)}
${assert(`to_regprocedure('public.guard_friend_request_update()') IS ${production ? 'NOT ' : ''}NULL`)}
`;
  // Generated test input only; no credentials or user data.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rppl-permission-test-'));
  const file = path.join(dir,'test.sql');
  fs.writeFileSync(file,sql);
  try {
    execFileSync(cli,['db','query','--linked','--project-ref',project,'--file',file,'--output','json'],{stdio:['ignore','pipe','pipe'],timeout:120000});
    console.log(`PASS: ${fixed ? 'fixed ownership, immutable participants, recipient acceptance/decline, requester retry and own rating CRUD' : 'both original vulnerabilities reproduced on synthetic records'}; transaction rolled back.`);
  } catch (error) {
    console.error(String(error.stderr || error.message));
    process.exitCode=1;
    return false;
  }
  return true;
}
if(production) run(true);
else if(run(false)) run(true);
