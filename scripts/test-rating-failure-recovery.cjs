const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function extract(file, pick) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(n) { if (pick(n, ast)) found = n; ts.forEachChild(n, visit); }
  visit(ast);
  assert(found, `Missing callback in ${file}`);
  return found.getText(ast);
}
function evaluate(source, scope) {
  const mod = { exports: {} };
  const code = ts.transpileModule(`module.exports = ${source};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', ...Object.keys(scope), code)(mod, ...Object.values(scope));
  return mod.exports;
}
async function databaseTests() {
  for (const name of ['setRating', 'setRatingDetailed', 'clearRating']) {
    const fn = extract('lib/listen.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === name).replace(/^export /, '');
    let response, writes = [];
    const q = { update(p) { writes.push(p); return q; }, eq() { return q; }, select() { return q; }, async maybeSingle() { return response; } };
    const save = evaluate(fn, { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) }, from: () => q }, normalizeRating: Math.round, normalizeReview: x => x, debug: () => {} });
    const args = name === 'setRatingDetailed' ? ['fixture', 9, { artwork: 8 }, 'Keep this note'] : ['fixture', 9, 'Keep this note'];
    response = { data: null, error: { code: '23514' } };
    assert.equal((await save(...args)).ok, false);
    assert.equal(writes.length, 1, 'Server rejection must never trigger a substituted score');
    if (name !== 'clearRating') assert.equal(writes[0].rating, 9);
    response = { data: null, error: null };
    assert.equal((await save(...args)).ok, false, 'Deleted/unavailable row must not report success');
    response = { data: { id: 'fixture', rating: 9 }, error: null };
    assert.equal((await save(...args)).ok, true);
  }
}
async function editorTests() {
  const submit = extract('components/ReleaseActionSheet.tsx', (n, ast) => ts.isArrowFunction(n) && ts.isJsxExpression(n.parent) && n.parent.parent.name?.getText(ast) === 'onSubmit');
  let visible = true, ensures = 0, writes = 0, closes = 0, result = { ok: false, message: 'Offline' }, release;
  const busyRef = { current: false }, resolvedRatingRow = { current: null };
  const alerts = [], updates = [];
  const save = async () => { writes++; await new Promise(r => { release = r; }); return result; };
  const callback = evaluate(submit, { busyRef, resolvedRatingRow, setBusy: () => {}, ensureRow: async () => { ensures++; return { id: 'saved-fixture', title: 'Fixture' }; }, setRating: save, setRatingDetailed: save, setRatingVisible: v => { visible = v; }, onChanged: x => updates.push(x), H: { success() {} }, emit() {}, onClose: () => { closes++; }, Alert: { alert: (...x) => alerts.push(x) } });
  const first = callback(9, { artwork: 8 }, 'Keep my draft');
  await Promise.resolve();
  await callback(9, { artwork: 8 }, 'Keep my draft');
  assert.equal(writes, 1, 'Rapid double-tap only writes once');
  release(); await first;
  assert.equal(visible, true, 'Failure retains editor and draft');
  assert.equal(closes, 0);
  assert.equal(alerts.length, 1);
  assert.equal(busyRef.current, false);
  result = { ok: true, row: { rating_details: { artwork: 8 } } };
  const retry = callback(9, { artwork: 8 }, 'Keep my draft');
  release(); await retry;
  assert.equal(ensures, 1, 'Retry reuses resolved saved item');
  assert.equal(visible, false);
  assert.equal(updates[0].done, true);
  assert.equal(closes, 1);
  const open = extract('components/ReleaseActionSheet.tsx', (n, ast) => ts.isArrowFunction(n) && ts.isPropertyAssignment(n.parent) && n.parent.name.getText(ast) === 'onPress' && n.getText(ast).includes('resolvedRatingRow.current'));
  let opens = 0;
  await evaluate(open, { busyRef, resolvedRatingRow, isUuid: () => false, row: { id: 'catalogue-fixture' }, onRate: null, setRatingRow: () => {}, setRatingVisible: () => { opens++; } })();
  assert.equal(opens, 1, 'Unsaved item opens without any database-write dependency');
}
(async () => { await databaseTests(); await editorTests(); console.log('PASS: exact rating preservation, missing rows, cancel without writes, draft retention, duplicate taps and retry. Synthetic callbacks only.'); })().catch(e => { console.error(e); process.exitCode = 1; });
