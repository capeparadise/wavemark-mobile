const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path, imports) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => imports[name], module, module.exports);
  return module.exports;
}
const events = [];
const store = load('lib/listenSavePreview.ts', { './events': { emit: (...args) => events.push(args) } });
let resolve, reject;
const saver = load('lib/saveFromDiscover.ts', {
  './listenedActivity': { suspendListenedActivity: () => () => {} },
  './listenSavePreview': store,
  './listen': { addToListFromSearch: () => new Promise((yes, no) => { resolve = yes; reject = no; }) },
});
const input = { type: 'track', providerId: 'song1', title: 'Save test', artist: 'Test artist', imageUrl: 'cover.jpg', spotifyUrl: 'https://open.spotify.com/track/song1' };
(async () => {
  const before = store.listenSaveRevision();
  const saving = saver.saveFromDiscover(input, 'account-a');
  let rows = store.mergeListenSavePreviews('account-a', []);
  assert.equal(rows.length, 1, 'Lazy first tab mount shows pending save before server responds');
  assert.equal(rows[0].artwork_url, 'cover.jpg');
  assert.equal(store.isSavePending(rows[0]), true);
  assert.equal(store.mergeListenSavePreviews('account-b', []).length, 0, 'Account isolation');
  assert.equal(store.mergeListenSavePreviews('account-a', [], before).length, 1, 'Stale read cannot erase pending save');
  assert.equal(events[0][1], 'account-a', 'Mounted background tab is notified immediately');
  resolve({ ok: true, id: 'server1', row: { id: 'server1', rating: 8, review: 'Existing note' } });
  await saving;
  rows = store.mergeListenSavePreviews('account-a', rows);
  assert.equal(rows.length, 1, 'Confirmation replaces temporary row');
  assert.equal(rows[0].id, 'server1');
  assert.equal(rows[0].review, 'Existing note');
  assert.equal(rows[0].spotify_id, 'song1', 'Partial save response retains provider link');
  assert.equal(store.mergeListenSavePreviews('account-a', [], before).length, 1, 'Read started before confirmation cannot erase saved row');
  assert.equal(store.mergeListenSavePreviews('account-a', rows, store.listenSaveRevision()).length, 1);
  assert.equal(store.mergeListenSavePreviews('account-a', []).length, 0, 'Authoritative read retires overlay so future removals work');
  const failed = saver.saveFromDiscover(input, 'failure');
  const failedRows = store.mergeListenSavePreviews('failure', []);
  resolve({ ok: false, message: 'Offline' });
  await failed;
  assert.equal(store.mergeListenSavePreviews('failure', failedRows).length, 0, 'Reported save failure rolls back');
  const thrown = saver.saveFromDiscover(input, 'throws');
  reject(new Error('Offline'));
  await assert.rejects(thrown);
  assert.equal(store.mergeListenSavePreviews('throws', []).length, 0, 'Thrown failure rolls back');
  const a = saver.saveFromDiscover(input, 'concurrent'); const finishA = resolve;
  const b = saver.saveFromDiscover({ ...input, providerId: 'song2', spotifyUrl: 'https://open.spotify.com/track/song2' }, 'concurrent');
  resolve({ ok: true, id: 'server2' }); await b;
  finishA({ ok: true, id: 'server1' }); await a;
  assert.equal(store.mergeListenSavePreviews('concurrent', []).length, 2, 'Concurrent saves survive out-of-order responses');
  store.forgetListenSavePreview('concurrent', 'song1');
  assert.equal(store.mergeListenSavePreviews('concurrent', []).length, 1, 'Unsave clears confirmed overlay');
  const discover = fs.readFileSync('app/(tabs)/discover.tsx', 'utf8');
  assert.ok(!discover.includes('removeSaved(filterDiscoverEligibleReleases(topPicksRaw))'), 'Saved Top Picks remain visible');
  assert.ok(discover.includes('}, [topPicksRaw, selectedGenres]);'), 'Saving does not rerun/reorder Top Picks');
  console.log('PASS: immediate lazy/background saves, rollback, account isolation, stale reads, confirmation, concurrent saves, unsave and stable Top Picks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
