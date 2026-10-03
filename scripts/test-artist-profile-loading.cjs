const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path, imports) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', '__DEV__', js)(name => imports[name], module, module.exports, false);
  return module.exports;
}
const disk = new Map();
const storage = { getItem: async key => disk.get(key) || null, setItem: async (key, value) => { disk.set(key, value); } };
const cache = load('lib/artistPageCache.ts', { '@react-native-async-storage/async-storage': { default: storage } });
let finishSecond;
const artistId = 'artist-fixture';
const album = (id, group = 'album', ids = [artistId]) => ({ id, name: id, type: 'album', album_type: 'album', album_group: group, artists: ids.map(id => ({ id, name: id })), release_date: '2026-09-01' });
const response = data => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(data) });
const api = load('lib/spotifyArtist.ts', { './fnBase': { FN_BASE: 'https://fixture.invalid', fetchFn: async url => {
  if (new URL(url).searchParams.get('offset') === '0') return response({ items: [album('one')], total: 2 });
  return new Promise(resolve => { finishSecond = () => resolve(response({ items: [album('two', 'appears_on')], total: 2 })); });
} } });
(async () => {
  const pages = [];
  const request = api.artistPageReleases(artistId, 'GB', page => pages.push(page));
  for (let i = 0; i < 20 && !finishSecond; i++) await Promise.resolve();
  assert.equal(pages.length, 1, 'First page is published before remaining catalogue finishes');
  assert.equal(pages[0][0].id, 'one');
  finishSecond();
  const all = await request;
  assert.equal(all.length, 2, 'Full catalogue remains available');
  assert.equal(pages[1].length, 2);
  assert.equal(api.filterArtistPageReleases([{id:'wrong',spotifyItemType:'album',albumType:'album',albumGroup:'album',artistIds:['someone-else']}], artistId).length, 0, 'Progress updates retain artist identity checks');
  const snapshot = { name: 'Artist', imageUrl: 'artist.jpg', genres: [], albums: all };
  cache.writeArtistPage(artistId, 'GB', snapshot);
  assert.equal(cache.peekArtistPage(artistId, 'GB').albums.length, 2, 'Revisit uses synchronous memory cache');
  assert.equal(cache.peekArtistPage(artistId, 'US'), null, 'Market isolation');
  assert.equal(cache.peekArtistPage('other-artist', 'GB'), null, 'Artist isolation');
  const restarted = load('lib/artistPageCache.ts', { '@react-native-async-storage/async-storage': { default: storage } });
  assert.equal((await restarted.readArtistPage(artistId, 'GB')).name, 'Artist', 'Disk cache works after restart');
  disk.set('artist_page_v1:GB:expired', JSON.stringify({ ...snapshot, savedAt: Date.now() - 86400001 }));
  assert.equal(await restarted.readArtistPage('expired', 'GB'), null, 'Expired cache is not shown');
  const screen = fs.readFileSync('app/artist/[id]/mini.tsx', 'utf8');
  assert.ok(screen.indexOf('const detailsPromise =') < screen.indexOf('await artistPageReleases('), 'Details start before catalogue request finishes');
  assert.ok(!screen.includes('if (loading) {\n    return ('), 'Full-screen spinner no longer blocks artist content');
  console.log('PASS: progressive pagination, complete catalogue, identity filters, memory/disk cache, expiry, market isolation and non-blocking screen.');
})().catch(error => { console.error(error); process.exitCode = 1; });
