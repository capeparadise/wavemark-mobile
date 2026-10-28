// Execute the screen's saved-row lookup against synthetic database responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('app/release/[id].tsx', 'utf8');
const ast = ts.createSourceFile('release.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let lookup;
function visit(node) {
  if (ts.isTryStatement(node) && node.tryBlock.getText(ast).includes('provider_id.eq.${releaseId}') && node.tryBlock.getText(ast).includes('setAdded(true)')) lookup = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(lookup, 'Saved-release lookup must be present');
const body = ts.transpileModule(`module.exports = async function(detail, user, releaseId, active, supabase, isUuid, mapListenRow, setAdded) { ${lookup.getText(ast)}; return detail; };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', body)(mod);
const catalogue = { title: "It's Too Late", artistName: 'Aby Coulibaly', artworkUrl: 'fixture://cover', artistId: 'fixture-artist', totalTracks: 1 };
async function check({ detail = catalogue, saved = true, user = { id: 'owner' }, active = true, uuid = false, error = false } = {}) {
  let added = false, reads = 0;
  const filters = [];
  const q = {
    select() { return q; }, eq(...args) { filters.push(args); return q; }, or() { return q; },
    async maybeSingle() { reads++; return { data: saved ? { title: 'Stored title' } : null, error: error ? { message: 'Offline' } : null }; },
  };
  const result = await mod.exports(detail, user, 'fixture-id', active, { from: () => q }, () => uuid, row => ({ title: row.title }), value => { added = value; });
  if (user) assert(filters.some(([key, value]) => key === 'user_id' && value === user.id), 'Lookup must be scoped to current account');
  return { result, added, reads };
}
(async () => {
  const saved = await check();
  assert.equal(saved.added, true, 'Catalogue details must not skip the saved-state lookup');
  assert.deepEqual(saved.result, catalogue, 'Saved-state lookup must preserve rich catalogue presentation');
  assert.equal((await check({ saved: false })).added, false);
  assert.equal((await check({ error: true })).added, false);
  assert.equal((await check({ active: false })).added, false, 'An obsolete screen must not receive saved state');
  assert.equal((await check({ user: null })).reads, 0);
  const direct = await check({ detail: null, uuid: true });
  assert.equal(direct.added, true);
  assert.equal(direct.reads, 1, 'A stored-row route needs only its owner-scoped ID lookup');
  assert.equal(direct.result.title, 'Stored title');
  const bare = await check({ detail: null });
  assert.equal(bare.added, true);
  assert.equal(bare.result.title, 'Stored title');
  console.log('PASS: saved catalogue routes, metadata preservation, unsaved/error/signed-out/stale results and stored-row routes. Synthetic lookup, not a device test.');
})().catch(error => { console.error(error); process.exitCode = 1; });
