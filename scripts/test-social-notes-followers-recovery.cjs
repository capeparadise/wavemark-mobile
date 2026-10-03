// Rollback-only verification for feed notes and follower management helpers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const cli = '/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const production = process.argv.includes('--production-verify');
const project = production ? 'jvojjtjklqtmdtmeqqyy' : 'mlciopffwtbopluuahoj';
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260916090000_social_notes_followers.sql'), 'utf8');
const [owner, mutual, follower, listenId] = Array.from({ length: 4 }, randomUUID);
const asUser = (id) => `RESET ROLE; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',true);`;
const assert = (condition) => `DO $test$ BEGIN IF NOT (${condition}) THEN RAISE EXCEPTION 'Assertion failed: ${condition.replaceAll("'", "''")}'; END IF; END $test$;`;

const sql = `BEGIN;
SET LOCAL statement_timeout = '30s';
${production ? '' : migration}
${production ? '' : 'GRANT EXECUTE ON FUNCTION public.get_listener_music(text,integer) TO authenticated;'}
INSERT INTO auth.users(id) VALUES ('${owner}'),('${mutual}'),('${follower}');
INSERT INTO public.profiles(id,display_name,username,is_private,profile_setup_completed) VALUES
  ('${owner}','Owner','owner_${owner.slice(0,8)}',true,true),
  ('${mutual}','Mutual listener','mutual_${mutual.slice(0,8)}',true,true),
  ('${follower}','Follower','follower_${follower.slice(0,8)}',true,true)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  username = excluded.username,
  is_private = excluded.is_private,
  profile_setup_completed = excluded.profile_setup_completed;
INSERT INTO public.profile_follows(follower_id,following_id,status) VALUES
  ('${mutual}','${owner}','accepted'),
  ('${owner}','${mutual}','accepted'),
  ('${follower}','${owner}','accepted');
INSERT INTO public.listen_list(id,user_id,provider,item_type,external_id,title,artist_name,provider_id,done_at,rating,review,rated_at)
VALUES ('${listenId}','${mutual}','spotify','track','social-note-fixture','Synthetic rated track','Synthetic artist','social-note-fixture',now(),8,'Visible follower note',now());
${asUser(owner)}
${assert(`(SELECT count(*) FROM public.list_my_followers_profiles()) = 2`)}
${assert(`(SELECT relationship_status FROM public.list_my_followers_profiles() WHERE user_id='${mutual}') = 'following'`)}
${assert(`(SELECT relationship_status FROM public.list_my_followers_profiles() WHERE user_id='${follower}') = 'none'`)}
${assert(`position('review text' in pg_get_function_result('public.get_following_activity(integer)'::regprocedure)) > 0`)}
${assert(`(SELECT review FROM public.get_following_activity(60) WHERE id='${listenId}') = 'Visible follower note'`)}
${assert(`EXISTS (SELECT 1 FROM public.get_listener_music('mutual_${mutual.slice(0,8)}',12))`)}
${assert(`public.remove_my_follower('${follower}')`)}
RESET ROLE;
${assert(`NOT EXISTS (SELECT 1 FROM public.profile_follows WHERE follower_id='${follower}' AND following_id='${owner}')`)}
${assert(`EXISTS (SELECT 1 FROM public.profile_follows WHERE follower_id='${mutual}' AND following_id='${owner}')`)}
${asUser(mutual)}
${assert(`NOT public.remove_my_follower('${follower}')`)}
RESET ROLE;
${assert(`EXISTS (SELECT 1 FROM public.profile_follows WHERE follower_id='${owner}' AND following_id='${mutual}')`)}
${asUser(follower)}
${assert(`NOT EXISTS (SELECT 1 FROM public.get_following_activity(60) WHERE id='${listenId}')`)}
${asUser(mutual)}
${assert(`public.remove_my_follower('${owner}')`)}
${asUser(owner)}
${assert(`NOT EXISTS (SELECT 1 FROM public.get_following_activity(60) WHERE id='${listenId}')`)}
${assert(`NOT EXISTS (SELECT 1 FROM public.get_listener_music('mutual_${mutual.slice(0,8)}',12))`)}
RESET ROLE;
ROLLBACK;
${assert(`NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN ('${owner}','${mutual}','${follower}'))`)}
${assert(`NOT EXISTS (SELECT 1 FROM public.listen_list WHERE id='${listenId}')`)}
${assert(`to_regprocedure('public.list_my_followers_profiles()') IS ${production ? 'NOT ' : ''}NULL`)}
${assert(`to_regprocedure('public.remove_my_follower(uuid)') IS ${production ? 'NOT ' : ''}NULL`)}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rppl-social-notes-followers-'));
const file = path.join(dir, 'test.sql');
fs.writeFileSync(file, sql);
try {
  execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, '--file', file, '--output', 'json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
  console.log(`PASS: ${production ? 'production ' : ''}rating-note result, follower listing, follow-back status and owner-scoped removal; transaction rolled back.`);
} catch (error) {
  console.error(String(error.stderr || error.message));
  process.exitCode = 1;
}
