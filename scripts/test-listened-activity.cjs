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
const store = load('lib/listenedActivity.ts', { './events': { emit: (...args) => events.push(args) } });
let finish, fail;
const marking = load('lib/markListened.ts', {
  './listen': { markDone: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) },
  './listenedActivity': store,
  './listenSavePreview': { forgetListenSavePreview() {} },
});
const row = { id: 'saved-1', title: 'History fixture', item_type: 'track', provider: 'spotify', provider_id: 'song', artist_name: 'Test artist', artwork_url: 'cover.jpg', done_at: null, rating: 8, review: 'Keep this note' };
(async () => {
  const before = store.listenedActivityRevision();
  const action = marking.markListened(row, 'a', true);
  let history = store.mergeListenedActivity('a', [], 'history');
  assert.equal(history.length, 1, 'History available synchronously before network');
  assert.equal(history[0].artwork_url, 'cover.jpg');
  assert.equal(history[0].review, 'Keep this note');
  assert.equal(store.mergeListenedActivity('a', [row], 'list').length, 0, 'Listen List hides the same pending row');
  assert.equal(store.mergeListenedActivity('b', [], 'history').length, 0, 'Other accounts remain isolated');
  assert.equal(store.isListenedActivityPending('a', row), true);
  finish({ ok: true }); await action;
  assert.equal(store.mergeListenedActivity('a', [], 'history', before).length, 1, 'Stale read cannot overwrite confirmation');
  const confirmed = store.mergeListenedActivity('a', [], 'history')[0];
  const restore = store.suspendListenedActivity('a', row.provider_id);
  assert.equal(store.mergeListenedActivity('a', [row], 'list').length, 1, 'Save again is not hidden by a prior listened overlay');
  restore();
  assert.equal(store.mergeListenedActivity('a', [], 'history').length, 1, 'Failed save-again restores listened preview');
  const freshRead = store.listenedActivityRevision();
  assert.equal(store.mergeListenedActivity('a', [confirmed], 'history', freshRead).length, 1, 'No duplicate after confirmation');
  assert.equal(store.mergeListenedActivity('a', [], 'history').length, 1, 'Another screen with old cache still gets confirmed preview');
  const undo = marking.markListened(confirmed, 'a', false);
  assert.equal(store.mergeListenedActivity('a', [confirmed], 'history').length, 0, 'Undo removes history immediately');
  assert.equal(store.mergeListenedActivity('a', [], 'list').length, 1, 'Undo restores Listen List immediately');
  finish({ ok: false, message: 'Offline' }); await undo;
  assert.equal(store.mergeListenedActivity('a', [], 'history').length, 1, 'Failed undo restores previous confirmed state');
  const failed = marking.markListened({ ...row, id: 'failed', provider_id: 'other' }, 'a', true);
  fail(new Error('Offline')); await failed;
  assert.equal(store.mergeListenedActivity('a', [], 'history').length, 1, 'Failed write removes only its own preview');
  const undone = marking.markListened(confirmed, 'a', false);
  finish({ ok: true }); await undone;
  assert.equal(store.mergeListenedActivity('a', [confirmed], 'history').length, 0);
  assert.equal(store.mergeListenedActivity('a', [], 'list')[0].rating, 8, 'Undo preserves rating');
  store.forgetListenedActivityRow(row.id);
  assert.equal(store.mergeListenedActivity('a', [], 'list').length, 0, 'Removal does not resurrect an overlay');
  assert.ok(events.some(([name]) => name === 'listen:updated'));
  console.log('PASS: immediate history/profile/list transitions, artwork, ratings, stale reads, independent screen acknowledgments, account isolation, failure rollback and undo.');
})().catch(error => { console.error(error); process.exitCode = 1; });
