const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const ast = ts.createSourceFile('RatingModal.tsx', fs.readFileSync('components/RatingModal.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, scope) {
  let source;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name) source = n.initializer.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast); assert(source);
  const mod = { exports: {} };
  const code = ts.transpileModule(`module.exports = ${source}`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', ...Object.keys(scope), code)(mod, ...Object.values(scope));
  return mod.exports;
}
(async () => {
  const submittingRef = { current: false };
  let busy = false, saves = 0, cancels = 0, release, reject;
  const alerts = [], submissions = [];
  const scope = { submittingRef, saving: false, preferencesReady: true,
    setSubmitting: x => { busy = x; },
    onSubmit: (...args) => { saves++; submissions.push(args); return new Promise((a,b) => { release=a; reject=b; }); },
    onCancel: () => { cancels++; },
    value: 9, details: { artwork: 8 }, advanced: false, artworkEnabled: true,
    individualTrack: false, initialDetails: null, preferences: { notes: true },
    review: 'Keep this draft', initialReview: null, normalizeReview: x => x,
    ratingDetailsForSubmit: x => x, Alert: { alert: (...x) => alerts.push(x) },
  };
  const submit = callback('submitRating', scope), cancel = callback('cancel', scope);
  const first = submit();
  await submit(); cancel();
  assert.equal(saves, 1, 'Duplicate taps before rerender must not submit twice');
  assert.equal(cancels, 0, 'Cannot dismiss an in-flight save'); assert.equal(busy,true);
  reject(Error('Offline')); await first;
  assert.equal(busy,false); assert.equal(submittingRef.current,false);
  assert.equal(alerts.length,1); assert.equal(cancels,0,'Thrown failures keep the draft open');
  const retry=submit(); release(); await retry;
  assert.equal(saves,2); assert.deepEqual(submissions[1],[9,{artwork:8},'Keep this draft']);
  cancel(); assert.equal(cancels,1,'Cancel works again after saving settles');
  await callback('submitRating',{...scope,saving:true})();
  await callback('submitRating',{...scope,preferencesReady:false})();
  assert.equal(saves,2,'Parent saving and preference loading both prevent submission');
  console.log('PASS: shared rating guard prevents duplicate saves and dismissal, retains draft after exceptions, and permits retry.');
})().catch(e => { console.error(e); process.exitCode=1; });
