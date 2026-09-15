const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
let rows=[],uid='owner',error=null;
const supabase={auth:{getUser:async()=>({data:{user:uid?{id:uid}:null}})},from:(table)=>{
 assert.equal(table,'saved_artists','Bookmarks must not change follows or history');
 let predicates=[],payload,action;
 const q={select(){return q},eq(k,v){predicates.push(r=>r[k]===v);return q},order(){return q},upsert(v){payload=v;action='save';return q},delete(){action='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{
  if(error)return {error};
  if(action==='save'){const existing=rows.find(r=>['user_id','provider','artist_id'].every(k=>r[k]===payload[k]));if(existing)Object.assign(existing,payload);else rows.push(payload);}
  if(action==='delete')rows=rows.filter(r=>!predicates.every(p=>p(r)));
  return {data:rows.filter(r=>predicates.every(p=>p(r))),error:null};
 }).then(resolve,reject);}};return q;
}};
const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/savedArtists.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({supabase}),mod,mod.exports);
(async()=>{const a={provider:'spotify',artist_id:'2qanRMyA5bNuTvz1dK45OP',artist_name:'ADÉLA',image_url:null};
 await mod.exports.setArtistSaved(a,true);await mod.exports.setArtistSaved(a,true);assert.equal(rows.length,1);
 uid='other';assert.equal((await mod.exports.fetchSavedArtists()).length,0);await mod.exports.setArtistSaved(a,false);assert.equal(rows.length,1);
 uid='owner';assert.equal((await mod.exports.fetchSavedArtists()).length,1);error={code:'offline'};await assert.rejects(()=>mod.exports.setArtistSaved(a,false));assert.equal(rows.length,1);
 error=null;await mod.exports.setArtistSaved(a,false);assert.equal(rows.length,0);uid=null;await assert.rejects(()=>mod.exports.fetchSavedArtists());
 console.log('PASS: bookmark save/revisit/remove, duplicates, account scope, failure retention; no follow/history mutations');
})().catch(e=>{console.error(e);process.exitCode=1});
