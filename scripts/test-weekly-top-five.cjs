const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const calls = [];
let pages = [];
let failure = false;
const supabase = { from(table) {
  calls.push(['from', table]);
  const query = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.then = resolve => Promise.resolve({ data: pages.shift() || [], error: failure ? new Error('offline') : null }).then(resolve);
  return query;
} };
const compiled = ts.transpileModule(fs.readFileSync('lib/weeklyTopFive.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => ({ supabase }), mod, mod.exports);
const { rankWeeklySongs, weeklyWindow, fetchWeeklyTopFive } = mod.exports;
const now = new Date(2026, 8, 23, 12);
const row = (id, rating = 8, extra = {}) => ({ id, title: id, artist_name: 'Artist', item_type: 'track', rating, done_at: new Date(2026, 8, 22, 12).toISOString(), ...extra });
async function main() {
  assert.equal(weeklyWindow(now).start.getDay(), 1);
  assert.equal(weeklyWindow(new Date(2026, 8, 27, 23)).start.getDate(), 21);
  assert.equal(weeklyWindow(new Date(2026, 8, 28)).start.getDate(), 28);
  assert.deepEqual(rankWeeklySongs([
    row('album', 10, { item_type: 'album' }), row('unrated', null), row('invalid', NaN),
    row('past', 10, { done_at: new Date(2026, 8, 20).toISOString() }),
    row('future', 10, { done_at: new Date(2026, 8, 24).toISOString() }),
    row('old', 8), row('new', 8, { done_at: now.toISOString() }), row('best', 9),
  ], now).map(r => r.id), ['best', 'new', 'old']);
  assert.equal(rankWeeklySongs([row('one', 8, { spotify_id: 'same' }), row('two', 9, { spotify_id: 'same' })], now).length, 1);
  assert.equal(rankWeeklySongs(Array.from({ length: 7 }, (_, i) => row(String(i))), now).length, 5);
  assert.equal(rankWeeklySongs([], now).length, 0);
  assert.equal(rankWeeklySongs([row('song', 6, { rating_details: { production: 10, vocals: 10, lyrics: 10, replay: 10 } }), row('higher', 7)], now)[0].id, 'higher');
  assert.equal(rankWeeklySongs([row('a', 8), row('b', 8)], now)[0].id, 'a');
  pages = [Array.from({ length: 500 }, (_, i) => row(String(i), 5)), [row('winner', 10)]];
  assert.equal((await fetchWeeklyTopFive('account-A', now))[0].id, 'winner');
  assert.equal(calls.filter(c => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'account-A').length, 2);
  assert(calls.some(c => c[0] === 'range' && c[1] === 500));
  failure = true;
  await assert.rejects(fetchWeeklyTopFive('account-A', now), /offline/);
  console.log('PASS: weekly boundaries, eligibility, overall ranking, ties, deduplication, sparse weeks, pagination, owner scope and failed requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
