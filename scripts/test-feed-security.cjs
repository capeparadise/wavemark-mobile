const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function compile(file, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const artistId = 'A'.repeat(22);
let handler, followed, followError, queryCalls, providerCalls, inserts, tokens;
const db = {
  auth: { getUser: async token => {
    tokens.push(token);
    return { data: { user: token === 'user-session' ? { id: 'owner' } : null }, error: null };
  } },
  from(table) {
    const filters = {}; queryCalls.push({ table, filters });
    const q = {
      select() { return q; }, eq(k, v) { filters[k] = v; return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      insert: async row => { inserts.push(row); return { error: null }; },
      then(resolve, reject) {
        return Promise.resolve({ data: followed ? [{ artist_id: artistId, artist_name: 'Fixture artist' }] : [], error: followError ? {} : null }).then(resolve, reject);
      },
    }; return q;
  },
};
compile('supabase/functions/check-new-releases/index.ts', {
  'https://deno.land/std@0.224.0/http/server.ts': { serve: fn => { handler = fn; } },
  'https://esm.sh/@supabase/supabase-js@2': { createClient: () => db },
}, {
  Deno: { env: { get: key => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'server-secret' : 'fixture' } },
  fetch: async url => {
    providerCalls.push(String(url));
    if (String(url).includes('/api/token')) return Response.json({ access_token: 'spotify-token' });
    return Response.json({ items: [{ id: 'release', name: 'Fixture release', release_date: '2026-09-12', album_type: 'single', artists: [{ id: artistId, name: 'Fixture artist' }], external_urls: { spotify: 'https://open.spotify.com/album/release' }, images: [{ url: 'https://example.com/art.jpg' }] }] });
  },
});
function reset() { followed = true; followError = false; queryCalls = []; providerCalls = []; inserts = []; tokens = []; }
async function call(token, query = `artistId=${artistId}`, method = 'POST') {
  return handler(new Request(`https://example.com/check-new-releases?${query}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }));
}
(async () => {
  for (const token of [null, 'public-anon-key', 'expired-token', 'forged-admin-claim']) {
    reset(); assert.equal((await call(token)).status, 401); assert.equal(queryCalls.length, 0); assert.equal(providerCalls.length, 0);
  }
  reset(); assert.equal((await call('user-session', '', 'DELETE')).status, 405);
  for (const query of ['', 'artistId=bad', `artistId=${artistId}&market=bad`, `artistId=${artistId}&limitArtists=100000`, `artistId=${artistId}&limitArtists=NaN`]) {
    reset(); assert.equal((await call('user-session', query)).status, 400); assert.equal(providerCalls.length, 0);
  }
  reset(); followed = false; assert.equal((await call('user-session')).status, 403); assert.equal(providerCalls.length, 0);
  assert.deepEqual(queryCalls[0].filters, { user_id: 'owner', artist_id: artistId });
  reset(); followError = true; assert.equal((await call('user-session')).status, 503); assert.equal(providerCalls.length, 0);
  for (const method of ['POST', 'GET']) {
    reset(); const response = await call('user-session', `artistId=${artistId}`, method);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { processed: 1, inserted: 1 });
    assert.equal(inserts[0].artist_id, artistId); assert.equal(inserts[0].image_url, 'https://example.com/art.jpg');
  }
  reset(); assert.equal((await call('server-secret', 'limitArtists=1')).status, 200); assert.equal(tokens.length, 0); assert.equal(inserts.length, 1);
  reset(); assert.equal((await call('server-secret', 'limitArtists=201')).status, 400); assert.equal(providerCalls.length, 0);

  let session = { access_token: 'user-session' }, request, requestCount = 0, responseStatus = 200, sessionError = null;
  const client = compile('lib/feedRefresh.ts', {
    './fnBase': { FN_BASE: 'https://example.com', SUPABASE_ANON_KEY: 'public-anon-key' },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session }, error: sessionError }) } } },
  }, { fetch: async (url, options) => { requestCount++; request = { url, options }; return new Response('', { status: responseStatus }); } });
  assert.equal(await client.requestArtistFeedRefresh(artistId, 'GB'), true);
  assert.equal(request.options.headers.Authorization, 'Bearer user-session'); assert.equal(request.options.headers.apikey, 'public-anon-key');
  assert.equal(request.options.method, 'POST'); assert.equal(new URL(request.url).searchParams.get('artistId'), artistId);
  responseStatus = 401; assert.equal(await client.requestArtistFeedRefresh(artistId, 'GB'), false);
  session = null; const before = requestCount; assert.equal(await client.requestArtistFeedRefresh(artistId, 'GB'), false); assert.equal(requestCount, before);
  session = { access_token: 'user-session' }; sessionError = {}; assert.equal(await client.requestArtistFeedRefresh(artistId, 'GB'), false); assert.equal(requestCount, before);
  assert.equal(await client.requestArtistFeedRefresh('invalid', 'GB'), false);
  // Exercise the actual follow function, including its second refresh event
  // after the authenticated provider request settles. No UI rendering implied.
  const events = []; let finishRefresh;
  const follow = compile('lib/follow.ts', {
    './events': { emit: (name, payload) => events.push({ name, payload }) },
    './feedRefresh': { requestArtistFeedRefresh: () => new Promise(resolve => { finishRefresh = resolve; }) },
    './spotify': { getMarket: () => 'GB' },
    './supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
      from: () => ({ upsert: async () => ({ error: null }) }),
    } },
  });
  for (const succeeded of [true, false]) {
    events.length = 0;
    assert.equal((await follow.followArtist({ artistId, artistName: 'Fixture artist' })).ok, true);
    assert.deepEqual(events.map(e => e.name), ['follow:changed', 'feed:refresh']);
    finishRefresh(succeeded); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.map(e => e.name), ['follow:changed', 'feed:refresh', 'feed:refresh']);
    assert.equal(events[2].payload.artistId, artistId);
  }
  console.log('Feed security: handler authorization, ownership, bounds, release insertion and authenticated client tests passed. Synthetic mocks only; no live service calls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
