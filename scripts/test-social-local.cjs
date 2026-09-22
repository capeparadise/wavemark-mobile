// Synthetic service tests only: no credentials, network, or account mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
let response = { data: [], error: null };
const calls = [];
const supabase = {
  rpc: async (name, args) => { calls.push({ name, args }); return response; },
  from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 'actor', display_name: 'Demo', username: 'demo' }], error: null }) }) }),
};
const moduleStub = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('lib/profileSocial.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('require', 'module', 'exports', '__DEV__', code)(name => {
  if (name === './supabase') return { supabase };
  if (name === './spotify') return {};
  throw new Error(`Unexpected dependency: ${name}`);
}, moduleStub, moduleStub.exports, false);
const api = moduleStub.exports;
async function main() {
  response.data = ['following', 'requested', 'none', 'unexpected'].map(relationship_status => ({ user_id: relationship_status, relationship_status }));
  assert.deepEqual((await api.listMyFollowersProfiles()).map(x => x.relationship_status), ['following', 'requested', 'none', 'none']);
  response = { data: null, error: { message: 'offline' } };
  await assert.rejects(api.listMyFollowersProfiles(), /offline/);
  assert.equal((await api.removeMyFollower('person')).ok, false);
  response = { data: false, error: null };
  assert.equal((await api.removeMyFollower('person')).ok, false);
  response.data = true;
  assert.equal((await api.removeMyFollower('person')).ok, true);
  assert.deepEqual(calls.at(-1), { name: 'remove_my_follower', args: { p_follower_id: 'person' } });
  response.data = ['  A note  ', '   ', null].map((review, i) => ({ id: String(i), user_id: 'actor', title: 'Example', rating: 8, review }));
  const activity = await api.fetchSocialActivity();
  assert.deepEqual(activity.map(x => x.review), ['A note', null, null]);
  assert(activity.every(x => x.actorUsername === 'demo' && x.rating === 8));
  response = { data: null, error: { message: 'permission denied' } };
  const before = calls.length;
  await assert.rejects(api.fetchSocialActivity(), /permission denied/);
  assert.equal(calls.length, before + 1, 'permission errors must not fall back to legacy activity');
  console.log('PASS: local social service mappings, notes, follower results and permission-error handling. No live accounts accessed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
