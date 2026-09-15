const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: '.env.local' });

const appContainer = process.argv[2];
if (!appContainer) throw new Error('Pass the simulator app data-container path.');

const projectUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');
assert(projectUrl && anonKey, 'Missing public Supabase configuration.');

const storageDir = path.join(
  appContainer,
  'Library/Application Support/com.capeparadise.rppl/RCTAsyncLocalStorage_V1',
);
const manifest = JSON.parse(fs.readFileSync(path.join(storageDir, 'manifest.json'), 'utf8'));
const authKey = Object.keys(manifest).find(key => /^sb-[a-z0-9]+-auth-token$/.test(key));
assert(authKey, 'No signed-in Supabase session found in the simulator.');

function asyncStorageValue(key) {
  const inline = manifest[key];
  if (typeof inline === 'string') return inline;
  const file = crypto.createHash('md5').update(key).digest('hex');
  return fs.readFileSync(path.join(storageDir, file), 'utf8');
}

const session = JSON.parse(asyncStorageValue(authKey));
const accessToken = session?.access_token;
const userId = session?.user?.id;
assert(accessToken && /^[0-9a-f-]{36}$/i.test(userId), 'Simulator session is incomplete.');

const runId = crypto.randomUUID();
const ownedPath = `${userId}/codex-storage-smoke-${runId}.png`;
const rejectedMimePath = `${userId}/codex-storage-smoke-${runId}.txt`;
const rejectedOwnerPath = `${crypto.randomUUID()}/codex-storage-smoke-${runId}.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${accessToken}`,
};
const objectUrl = value => `${projectUrl}/storage/v1/object/avatars/${value.split('/').map(encodeURIComponent).join('/')}`;

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
}

async function cleanup(value) {
  await request(objectUrl(value), { method: 'DELETE', headers }).catch(() => {});
}

async function listOwned(search) {
  const response = await request(`${projectUrl}/storage/v1/object/list/avatars`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: userId, search, limit: 10, offset: 0 }),
  });
  assert.equal(response.ok, true, `Owner avatar listing failed (${response.status}).`);
  return response.json();
}

(async () => {
  try {
    const upload = await request(objectUrl(ownedPath), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'image/png', 'x-upsert': 'false' },
      body: png,
    });
    assert.equal(upload.ok, true, `Owner image upload failed (${upload.status}).`);

    const publicRead = await request(`${projectUrl}/storage/v1/object/public/avatars/${ownedPath}`);
    assert.equal(publicRead.ok, true, `Public avatar delivery failed (${publicRead.status}).`);
    assert.deepEqual(Buffer.from(await publicRead.arrayBuffer()), png, 'Downloaded avatar bytes changed.');

    const listed = await listOwned(`codex-storage-smoke-${runId}`);
    assert(Array.isArray(listed) && listed.some(item => item.name === `codex-storage-smoke-${runId}.png`), 'Owner upload was not visible in owner listing.');

    const wrongMime = await request(objectUrl(rejectedMimePath), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'text/plain', 'x-upsert': 'false' },
      body: 'not an image',
    });
    assert.equal(wrongMime.ok, false, 'A disallowed avatar MIME type was accepted.');

    const wrongOwner = await request(objectUrl(rejectedOwnerPath), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'image/png', 'x-upsert': 'false' },
      body: png,
    });
    assert.equal(wrongOwner.ok, false, 'A user could upload into another profile folder.');

    const remove = await request(objectUrl(ownedPath), { method: 'DELETE', headers });
    assert.equal(remove.ok, true, `Owner avatar cleanup failed (${remove.status}).`);
    const afterDelete = await listOwned(`codex-storage-smoke-${runId}`);
    assert.equal(afterDelete.some(item => item.name === `codex-storage-smoke-${runId}.png`), false, 'Temporary avatar remained in Storage after deletion.');

    console.log('PASS: live owner upload/list/delete, public delivery, MIME limit and folder ownership');
  } finally {
    await Promise.all([ownedPath, rejectedMimePath, rejectedOwnerPath].map(cleanup));
  }
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
