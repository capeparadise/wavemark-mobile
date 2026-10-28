const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('app/profile/pending.tsx', 'utf8');
assert.match(source, /useAdvancedRatingsEnabled\(\)/, 'Pending Ratings must use the account preference');
assert.match(source, /rating_details/, 'Pending query must load saved advanced details');
assert.match(source, /advanced=\{advancedRatings\}/, 'Pending modal must render in advanced mode');
assert.match(source, /initialDetails=\{ratingRow\?\.rating_details\}/, 'Existing advanced values must be retained');
// Exercise the actual save callback rather than matching its former condition.
// Details can also contain an artwork score while advanced mode is disabled.
const ast = ts.createSourceFile('pending.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submit;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onSubmit') submit = node.initializer.expression;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(submit, 'Pending modal must expose a save callback');
const callback = ts.transpileModule(`module.exports = ${submit.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
assert.match(source, /Could not save rating/, 'Write failures must be visible and keep the modal open');
async function check(details) {
  const row = { id: 'pending-fixture', done_at: '2026-10-27T12:00:00Z' };
  let rows = [row], visible = true, target = row, result = { ok: false, message: 'Offline' };
  const calls = [], alerts = [];
  const save = kind => async (...args) => { calls.push({ kind, args }); return result; };
  const mod = { exports: {} };
  new Function('module', 'ratingRow', 'setRatingDetailed', 'setRating', 'Alert', 'setRatingVisible', 'setRatingRow', 'setRows', callback)(
    mod, row, save('detailed'), save('simple'), { alert: (...args) => alerts.push(args) },
    value => { visible = value; }, value => { target = value; }, update => { rows = update(rows); },
  );
  await mod.exports(8, details, 'Updated note');
  assert.deepEqual(calls[0], { kind: details ? 'detailed' : 'simple', args: details ? [row.id, 8, details, 'Updated note'] : [row.id, 8, 'Updated note'] });
  assert.equal(alerts[0][0], 'Could not save rating');
  assert.equal(visible, true, 'Failure keeps editor open');
  assert.equal(target, row, 'Failure retains draft target');
  assert.deepEqual(rows, [row], 'Failure retains pending item');
  result = { ok: true };
  await mod.exports(8, details, 'Updated note');
  assert.equal(visible, false);
  assert.equal(target, null);
  assert.deepEqual(rows, [], 'Success removes pending item');
}
(async () => {
  await check({ production: 7, vocals: 8, lyrics: 9, replay: 8 });
  await check(undefined);
  await check({ artwork: 7 });
  console.log('PASS: Pending simple/advanced/artwork-only saves, visible failure, retry and removal after success. Synthetic callbacks, not device rendering.');
})().catch(error => { console.error(error); process.exitCode = 1; });
