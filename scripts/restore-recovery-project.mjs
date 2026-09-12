// Explicitly scoped rehearsal: never retarget this to production.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export const project = 'mlciopffwtbopluuahoj';
export const cli = '/Users/f4f/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const directory = process.argv[2];
if (!directory?.startsWith('/tmp/rppl-hosted-recovery.')) throw new Error('Private rehearsal directory required');
function query(sql, name) {
 const file=path.join(directory,name+'.sql'); fs.writeFileSync(file,sql,{mode:0o600});
 try { const out=execFileSync(cli,['db','query','--linked','--project-ref',project,'--file',file,'--output','json'],{encoding:'utf8',maxBuffer:20*1024*1024}); return JSON.parse(out.slice(out.indexOf('{'))).rows; }
 catch(error) { fs.writeFileSync(path.join(directory,'restore-failure.log'),String(error.stderr),{mode:0o600}); throw new Error('Rehearsal stopped; private failure log recorded.'); }
}
const decode = value => {
 if(value==='\\N') return null;
 return value.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/gs,(_,c)=>c[0]==='x'?String.fromCharCode(parseInt(c.slice(1),16)):/^[0-7]/.test(c)?String.fromCharCode(parseInt(c,8)):({b:'\b',f:'\f',n:'\n',r:'\r',t:'\t',v:'\v','\\':'\\'}[c]??c));
};
const literal = value => value===null?'NULL':"E'"+value.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
const snapshot=fs.readFileSync(path.join(directory,'data.sql'),'utf8');
const tables=[];
for(const m of snapshot.matchAll(/^COPY (\w+)\.(\w+) \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm)) {
 if(!['public','private','auth'].includes(m[1]) || (m[1]==='auth'&&m[2]==='schema_migrations')) continue;
 const rows=m[4].split('\n').filter(Boolean).map(row=>row.split('\t').map(decode));
 const columns=m[3].split(', ');
 if(rows.some(row=>row.length!==columns.length)) throw new Error('COPY column mismatch');
 tables.push({schema:m[1],table:m[2],columns,rows});
}
const preflight=query("select current_setting('server_version') as version, (select count(*) from pg_tables where schemaname='public') as app_tables, (select count(*) from auth.users) as users;",'preflight');
if(Number(preflight[0].app_tables)!==0 || Number(preflight[0].users)!==0) throw new Error('Target is not empty; refusing repeat import');
let schema=fs.readFileSync(path.join(directory,'app-schema.sql'),'utf8').replace(/^\\(?:un)?restrict .*\n/gm,'');
const managed=fs.readFileSync(path.join(directory,'managed-schema.sql'),'utf8');
const authTrigger=managed.match(/^CREATE TRIGGER on_auth_user_created[^\n]+;/m)?.[0];
if(!authTrigger) throw new Error('Expected profile creation trigger missing');
let sql=`BEGIN; SET LOCAL ROLE postgres; SET LOCAL statement_timeout='120s'; CREATE SCHEMA IF NOT EXISTS private;\n${schema}\n`;
// Block API access until the imported policies and grants have been tested.
sql+='REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM PUBLIC, anon, authenticated;\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM PUBLIC, anon, authenticated;\n';
sql+=fs.readFileSync('supabase/migrations/20260909173000_secure_listen_list_inserts.sql','utf8')+'\n';
sql+='SET LOCAL session_replication_role=replica;\n';
for(const table of tables) {
 const prefix=`INSERT INTO "${table.schema}"."${table.table}" (${table.columns.map(c=>'"'+c+'"').join(',')}) VALUES `;
 for(let i=0;i<table.rows.length;i+=100) sql+=prefix+table.rows.slice(i,i+100).map(row=>'('+row.map(literal).join(',')+')').join(',')+';\n';
}
sql+='SET LOCAL session_replication_role=origin;\n'+authTrigger+'\nCOMMIT;\nSELECT true AS restored;';
query(sql,'import');
const counts=query(tables.map(t=>`SELECT '${t.schema}.${t.table}' AS table_name, count(*)::int AS rows FROM "${t.schema}"."${t.table}"`).join(' UNION ALL '),'verify-counts');
for(const t of tables) if(counts.find(r=>r.table_name===t.schema+'.'+t.table)?.rows!==t.rows.length) throw new Error('Row verification failed');
fs.writeFileSync(path.join(directory,'hosted-row-counts.json'),JSON.stringify(counts,null,2),{mode:0o600});
console.log(`Restored ${tables.length} table data sets and verified ${counts.reduce((n,r)=>n+r.rows,0)} rows in RPPL Recovery Test. Client access remains restricted.`);
