// Back up the public avatar objects referenced by an existing database dump.
// Run pg_restore --data-only --schema=storage --table=objects first.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [sqlFile, output] = process.argv.slice(2);
if (!sqlFile || !output) throw new Error('Usage: node scripts/backup-avatar-files.mjs objects.sql output-directory');
const sql = await fs.readFile(sqlFile, 'utf8');
const block = sql.match(/^COPY storage\.objects \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.$/m);
if (!block) throw new Error('Storage object COPY data missing');
const columns = block[1].split(', ');
const decode = value => value === '\\N' ? null : value.replace(/\\([\\tnr])/g, (_, c) => ({'\\':'\\', t:'\t', n:'\n', r:'\r'}[c]));
const objects = block[2].trimEnd().split('\n').filter(Boolean).map(line => Object.fromEntries(line.split('\t').map((v, i) => [columns[i], decode(v)])));
const otherBuckets = [...new Set(objects.filter(o => o.bucket_id !== 'avatars').map(o => o.bucket_id))];
if (otherBuckets.length) throw new Error('Additional storage buckets require a separate backup plan');
await fs.mkdir(output, {recursive:true, mode:0o700});
const manifest = [];
for (const object of objects) {
  if (object.is_delete_marker === 't') continue;
  const url = 'https://jvojjtjklqtmdtmeqqyy.supabase.co/storage/v1/object/public/avatars/' + object.name.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(url, {signal:AbortSignal.timeout(30000), redirect:'error'});
  if (!response.ok) throw new Error(`Avatar download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(output, sha256), bytes, {mode:0o600});
  manifest.push({bucket:'avatars', name:object.name, file:sha256, bytes:bytes.length, sha256, databaseMetadata:object.metadata});
}
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({project:'jvojjtjklqtmdtmeqqyy', capturedAt:new Date().toISOString(), objects:manifest}, null, 2), {mode:0o600});
console.log(`Downloaded ${manifest.length} avatar objects; ${manifest.reduce((n,o)=>n+o.bytes,0)} bytes. SHA-256 hashes recorded.`);
