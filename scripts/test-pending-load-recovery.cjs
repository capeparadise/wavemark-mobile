const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript');
const ast = ts.createSourceFile('pending.tsx', fs.readFileSync('app/profile/pending.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let source;
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'load') source = n.initializer.arguments[0].getText(ast);
  ts.forEachChild(n, visit);
}
visit(ast);
assert(source);
let loading, error, rows, authError, queryError, gate, user = { id: 'alice' };
const loadVersion = { current: 0 }, stored = [];
const cached = [{ id: 'cached-alice' }];
const q = { select() { return q; }, eq() { return q; }, not() { return q; }, is() { return q; }, order() { return q; }, async limit() { if (gate) await gate; if (queryError) throw Error('Offline'); return { data: [{ id: 'fresh-alice' }] }; } };
const scope = {
  loadVersion, user, CACHE_KEY: 'fixture', setLoading: x => { loading = x; }, setError: x => { error = x; }, setRows: x => { rows = x; },
  supabase: { auth: { getUser: async () => { if (authError) throw Error('Session unavailable'); return { data: { user } }; } }, from: () => q },
  AsyncStorage: { getItem: async () => JSON.stringify(cached), setItem: async (...x) => stored.push(x) },
};
const mod = { exports: {} };
new Function('module', ...Object.keys(scope), ts.transpileModule(`module.exports = ${source}`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText)(mod, ...Object.values(scope));
(async () => {
  authError = true;
  await mod.exports();
  assert.equal(loading, false, 'Session failure must end loading'); assert(error);
  authError = false; queryError = true;
  await mod.exports();
  assert.equal(loading, false); assert.deepEqual(rows, cached, 'Offline response preserves cached content'); assert(error);
  queryError = false;
  await mod.exports();
  assert.equal(error, null, 'Successful retry clears old failure'); assert.equal(rows[0].id, 'fresh-alice');
  let release; gate = new Promise(r => { release = r; });
  const pending = mod.exports();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  loadVersion.current++; rows = []; const writes = stored.length;
  release(); await pending;
  assert.deepEqual(rows, [], 'Response after account change/unmount cannot repopulate old account');
  assert.equal(stored.length, writes);
  console.log('PASS: Pending Ratings auth failure, offline cache, retry and stale-response protection. Synthetic callbacks only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
