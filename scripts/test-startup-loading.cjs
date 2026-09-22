const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function compile(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
async function main() {
  const { createListenRefreshGuard } = compile('lib/listenRefreshGuard.ts');
  const guard = createListenRefreshGuard();
  const startup = guard.read();
  assert(guard.begin('release'));
  assert(!guard.begin('release'), 'duplicate taps must not create another mutation');
  assert(!guard.accepts(startup), 'startup result must not undo Save');
  const during = guard.read();
  guard.finish('release');
  assert(!guard.accepts(startup));
  assert(!guard.accepts(during), 'read during Save must remain stale after completion');
  assert(guard.accepts(guard.read()));
  const older = guard.read(), newer = guard.read();
  assert(!guard.accepts(older)); assert(guard.accepts(newer));
  guard.begin('a'); guard.begin('b'); guard.finish('a');
  assert(!guard.accepts(guard.read()), 'a second pending mutation still protects the UI');
  guard.finish('b'); assert(guard.accepts(guard.read()));
  const beforeUnsave = guard.read(); guard.begin('release'); guard.finish('release');
  assert(!guard.accepts(beforeUnsave), 'Unsave/rollback also invalidates earlier reads');

  const storage = new Map();
  const cache = compile('lib/accountCache.ts', { '@react-native-async-storage/async-storage': { default: {
    getItem: async key => storage.get(key) ?? null,
    setItem: async (key, value) => storage.set(key, value),
  } } });
  storage.set('profile_snapshot_v1', JSON.stringify({ title: 'legacy, unknown owner' }));
  assert.equal(await cache.readAccountCache('profile_snapshot_v1', 'A'), null);
  await cache.writeAccountCache('profile_snapshot_v1', 'A', { title: 'A' });
  assert.equal((await cache.readAccountCache('profile_snapshot_v1', 'A')).title, 'A');
  assert.equal(await cache.readAccountCache('profile_snapshot_v1', 'B'), null);
  storage.set('profile_snapshot_v1_B', storage.get('profile_snapshot_v1_A'));
  assert.equal(await cache.readAccountCache('profile_snapshot_v1', 'B'), null, 'envelope owner must match');
  storage.set('profile_snapshot_v1_B', '{broken');
  assert.equal(await cache.readAccountCache('profile_snapshot_v1', 'B'), null);

  let releaseArtwork;
  const artwork = new Promise(resolve => { releaseArtwork = resolve; });
  let fail = false;
  const row = { id: 'track', title: 'Test track', item_type: 'track', done_at: new Date().toISOString(), rating: 8 };
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'A' } } } }) },
    from() {
      const query = { select() { return query; }, eq() { return query; }, not() { return query; }, order() { return query; }, limit() { return query; }, update() { return query; },
        then(resolve, reject) { return Promise.resolve(fail ? { error: new Error('offline') } : { data: [row], count: 1 }).then(resolve, reject); } };
      return query;
    },
  };
  const stats = compile('lib/stats.ts', { './supabase': { supabase }, './accountCache': cache, './profileSocial': { resolveListenerArtwork: () => artwork } });
  let ready;
  const fetching = stats.fetchProfileSnapshot(snapshot => { ready = snapshot; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready.uniqueCount, 1, 'stats published before artwork completes');
  assert.equal(ready.listened[0].title, 'Test track');
  assert.equal((await stats.loadCachedProfileSnapshot('A')).uniqueCount, 1);
  assert.equal(await stats.loadCachedProfileSnapshot('B'), null);
  releaseArtwork('https://example.test/art.jpg');
  assert.equal((await fetching).topRated[0].artwork_url, 'https://example.test/art.jpg');
  fail = true;
  await assert.rejects(stats.fetchProfileSnapshot(), /offline/);
  assert.equal((await stats.loadCachedProfileSnapshot('A')).uniqueCount, 1, 'offline response must not erase cache');
  console.log('PASS: startup Save/Unsave races, repeated taps, concurrent mutations, account-isolated cache, early profile content, artwork completion and offline preservation (synthetic only).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
