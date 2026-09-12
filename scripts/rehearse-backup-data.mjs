// Isolated data recovery check. This does not validate Supabase services or RLS.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const [directory] = process.argv.slice(2);
if (!directory?.startsWith('/tmp/rppl-recovery-check.')) throw new Error('Expected isolated recovery directory');
const pg = '/opt/homebrew/opt/libpq/bin/';
const archive = path.join(directory, 'database.dump');
const databaseName = 'recovery_' + Date.now();
execFileSync(pg+'createdb', ['-h',directory,'-p','55439',databaseName]);
const db = ['-h', directory, '-p', '55439', '-d', databaseName];
const query = sql => execFileSync(pg+'psql', [...db, '-X', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {encoding:'utf8'}).trim();
const toc = execFileSync(pg+'pg_restore', ['--list', archive], {encoding:'utf8'});
const entries = toc.split('\n').filter(line => /^\d+; \d+ \d+ (SCHEMA - (auth|storage|extensions)|TYPE (auth|storage) |TABLE (public|auth|storage) |SEQUENCE (public|auth|storage) |FUNCTION auth )/.test(line));
const list = path.join(directory, 'data-structure.list');
fs.writeFileSync(list, entries.join('\n')+'\n', {mode:0o600});
// Restore schema/type dependencies before installing the UUID extension.
const schemas = entries.filter(line => / SCHEMA /.test(line));
fs.writeFileSync(path.join(directory,'schemas.list'),schemas.join('\n')+'\n');
const restore = args => execFileSync(pg+'pg_restore', [...db, '--exit-on-error', '--no-owner', '--no-privileges', ...args, archive], {stdio:['ignore','pipe','pipe']});
restore(['--use-list',path.join(directory,'schemas.list')]);
query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;');
fs.writeFileSync(list, entries.filter(line=>!schemas.includes(line)).join('\n')+'\n');
try { restore(['--use-list',list]); } catch (error) { fs.writeFileSync(path.join(directory,'restore-error.log'),error.stderr,{mode:0o600}); throw new Error('Structure restore failed; private error log recorded'); }
const dataFile = path.join(directory,'table-data.sql');
execFileSync(pg+'pg_restore',['--data-only','--schema=public','--schema=auth','--schema=storage','--file='+dataFile,archive]);
// Restore only table contents; service-owned triggers and policies are intentionally not installed.
const dataEntries = toc.split('\n').filter(line=>/ TABLE DATA (public|auth|storage) /.test(line));
fs.writeFileSync(path.join(directory,'table-data.list'),dataEntries.join('\n')+'\n');
try { restore(['--use-list',path.join(directory,'table-data.list')]); } catch (error) { fs.writeFileSync(path.join(directory,'restore-error.log'),error.stderr,{mode:0o600}); throw new Error('Data restore failed; private error log recorded'); }
const sql=fs.readFileSync(dataFile,'utf8');
const results=[];
for (const match of sql.matchAll(/^COPY ([\w]+)\.([\w]+) \([^\n]+\) FROM stdin;\n([\s\S]*?)^\\\.$/gm)) {
 const expected=match[3].split('\n').filter(Boolean).length;
 const actual=Number(query(`SELECT count(*) FROM "${match[1]}"."${match[2]}"`));
 if(actual!==expected) throw new Error('Restored row count does not match archive');
 results.push({table:match[1]+'.'+match[2],rows:actual});
}
fs.writeFileSync(path.join(directory,'row-count-verification.json'),JSON.stringify(results,null,2),{mode:0o600});
console.log(`Restored and verified ${results.length} table row counts (${results.reduce((n,r)=>n+r.rows,0)} rows). Services, grants, functions and RLS need a separate Supabase rehearsal.`);
