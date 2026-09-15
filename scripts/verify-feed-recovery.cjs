// Explicitly isolated integration check: real recovery Auth/Postgres, local
// production handler, synthetic Spotify responses. No Edge gateway deployment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const project = 'mlciopffwtbopluuahoj';
const deployed = process.argv.includes('--deployed');
const base = `https://${project}.supabase.co`;
const cli = '/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
function sql(statement) {
  const raw = execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, statement, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(raw.slice(raw.indexOf('{'))).rows;
}
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const service = keys.find(k => k.name === 'service_role')?.api_key;
const anon = keys.find(k => k.name === 'anon')?.api_key;
assert.ok(service && anon);
const db = createClient(base, service, { auth: { persistSession: false, autoRefreshToken: false } });
const artist = randomBytes(11).toString('hex');
const release = `security-${artist}`;
const releaseUrl = `https://open.spotify.com/album/${release}`;
const users = [];
const schedulerToken = deployed ? randomBytes(32).toString('hex') : service;
let schedulerConfigured = false;
let handler, providerCalls = 0, permissionsChanged = false;
const permissions = sql("select has_schema_privilege('service_role','public','USAGE') as usage, has_table_privilege('service_role','public.followed_artists','SELECT') as follows_select, has_table_privilege('service_role','public.new_release_feed','SELECT') as feed_select, has_table_privilege('service_role','public.new_release_feed','INSERT') as feed_insert;")[0];
const code = ts.transpileModule(fs.readFileSync('supabase/functions/check-new-releases/index.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require', 'exports', 'Deno', 'fetch', code)(name => name.includes('/http/server') ? { serve: fn => { handler = fn; } } : { createClient }, {}, {
  env: { get: key => ({ SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: service, SPOTIFY_CLIENT_ID: 'fixture', SPOTIFY_CLIENT_SECRET: 'fixture' })[key] },
}, async url => {
  providerCalls++;
  if (String(url).includes('/api/token')) return Response.json({ access_token: 'fixture-token' });
  return Response.json({ items: [{ id: release, name: 'Isolated security test', release_date: '2026-09-12', album_type: 'single', artists: [{ id: artist, name: 'Synthetic artist' }], external_urls: { spotify: releaseUrl }, images: [{ url: 'https://example.com/fixture.png' }] }] });
});
async function invoke(token, query = `artistId=${artist}`) {
  if (deployed) return fetch(`${base}/functions/v1/check-new-releases?${query}`, {
    method: 'POST', headers: { apikey: anon, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(30000),
  });
  return handler(new Request(`https://local.invalid/check-new-releases?${query}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }));
}
(async () => {
  try {
    if (deployed) {
      const secrets = JSON.parse(execFileSync(cli, ['secrets', 'list', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      assert.ok(!secrets.some(s => s.name === 'FEED_SCAN_SCHEDULER_TOKEN'), 'Do not overwrite a configured scheduler token');
      schedulerConfigured = true;
      execFileSync(cli, ['secrets', 'set', `FEED_SCAN_SCHEDULER_TOKEN=${schedulerToken}`, '--project-ref', project], { stdio: 'pipe' });
    }
    permissionsChanged = true;
    sql('GRANT USAGE ON SCHEMA public TO service_role; GRANT SELECT ON public.followed_artists TO service_role; GRANT SELECT,INSERT ON public.new_release_feed TO service_role;');
    for (let i = 0; i < 2; i++) {
      const email = `feed-probe-${randomUUID()}@example.com`, password = randomBytes(30).toString('base64url');
      const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
      assert.ok(!created.error && created.data.user, 'Create test account');
      users.push({ id: created.data.user.id });
      const client = createClient(base, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const login = await client.auth.signInWithPassword({ email, password });
      assert.ok(!login.error && login.data.session, 'Real test sign-in');
      users.at(-1).token = login.data.session.access_token;
    }
    sql(`INSERT INTO public.followed_artists(user_id,artist_id,artist_name) VALUES ('${users[0].id}','${artist}','Synthetic artist');`);
    for (const token of [null, anon, 'invalid-token', users[1].token]) {
      const before = providerCalls;
      assert.equal((await invoke(token)).status, token === users[1].token ? 403 : 401);
      assert.equal(providerCalls, before, 'Denied caller must not reach Spotify');
    }
    assert.equal((await invoke(users[0].token, '')).status, 400);
    assert.equal((await invoke(schedulerToken, `artistId=invalid`)).status, 400, 'Trusted scheduler reaches parameter validation');
    const response = await invoke(users[0].token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { processed: 1, inserted: 1 });
    const rows = sql(`SELECT image_url FROM public.new_release_feed WHERE spotify_url='${releaseUrl}';`);
    assert.equal(rows.length, 1); assert.equal(rows[0].image_url, 'https://example.com/fixture.png');
    console.log(`PASS (${deployed ? 'deployed recovery gateway + handler' : 'local handler'}): real sign-in, anonymous/invalid/unrelated-user denial, scheduler authentication and owned-follow release/artwork persistence. No production or Spotify calls.`);
  } finally {
    const failures = [];
    if (schedulerConfigured) {
      try { execFileSync(cli, ['secrets', 'unset', 'FEED_SCAN_SCHEDULER_TOKEN', '--project-ref', project, '--yes'], { stdio: 'pipe' }); } catch { failures.push('scheduler token cleanup'); }
    }
    try { sql(`DELETE FROM public.new_release_feed WHERE spotify_url='${releaseUrl}'; DELETE FROM public.followed_artists WHERE artist_id='${artist}';`); } catch { failures.push('fixture cleanup'); }
    for (const user of users) { const result = await db.auth.admin.deleteUser(user.id); if (result.error) failures.push('temporary account cleanup'); }
    if (permissionsChanged) {
      const revoke = [];
      if (!permissions.follows_select) revoke.push('REVOKE SELECT ON public.followed_artists FROM service_role');
      if (!permissions.feed_select) revoke.push('REVOKE SELECT ON public.new_release_feed FROM service_role');
      if (!permissions.feed_insert) revoke.push('REVOKE INSERT ON public.new_release_feed FROM service_role');
      if (!permissions.usage) revoke.push('REVOKE USAGE ON SCHEMA public FROM service_role');
      try { if (revoke.length) sql(revoke.join(';') + ';'); } catch { failures.push('permission restoration'); }
    }
    assert.deepEqual(failures, [], 'Recovery cleanup must complete');
    console.log('Temporary users/fixture rows removed and prior service-role grants restored.');
  }
})().catch(error => {
  console.error('Recovery feed verification failed.', {
    kind: error?.name,
    actualStatus: typeof error?.actual === 'number' ? error.actual : undefined,
    expectedStatus: typeof error?.expected === 'number' ? error.expected : undefined,
    location: String(error?.stack || '').split('\n').find(line => line.includes('verify-feed-recovery.cjs'))?.trim(),
  });
  process.exitCode = 1;
});
