const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
let rows=[],user={id:'owner'},fail=false,events=[];
const supabase={auth:{getUser:async()=>({data:{user}})},from:()=>{
 let filters=[],action,payload;
 const q={delete(){action='delete';return q},update(v){action='update';payload=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,ids){filters.push(r=>ids.includes(r[k]));return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},async select(){
  if(fail)return {error:{message:'fail'}};
  const matched=rows.filter(r=>filters.every(f=>f(r)));
  if(action==='delete')rows=rows.filter(r=>!matched.includes(r));else matched.forEach(r=>Object.assign(r,payload));
  return {data:matched.map(r=>({id:r.id})),error:null};
 }};return q;
}};
const mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/listenBulk.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(n=>n==='./supabase'?{supabase}:{emit:e=>events.push(e)},mod,mod.exports);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=(n,extra={})=>({id:id(n),user_id:'owner',done_at:null,...extra});
(async()=>{
 rows=[fixture(1),fixture(2,{rating:8}),fixture(3,{done_at:'old'}),fixture(4,{user_id:'other'}),fixture(5,{review:'keep'}),fixture(6,{rating_details:{production:8}})];
 assert.deepEqual(await mod.exports.bulkListenAction(rows.map(r=>r.id),'remove'),[id(1)]);
 assert.equal(rows.length,5,'Ratings, details, reviews, history and other users protected');
 const changed=await mod.exports.bulkListenAction([id(2),id(2),id(3),id(4)],'listened');
 assert.deepEqual(changed,[id(2)]);assert.equal(rows.find(r=>r.id===id(2)).rating,8);
 assert.equal(rows.find(r=>r.id===id(3)).done_at,'old');
 fail=true;events=[];await assert.rejects(()=>mod.exports.bulkListenAction([id(5)],'remove'));assert.equal(events.length,0);
 user=null;await assert.rejects(()=>mod.exports.bulkListenAction([id(5)],'remove'));
 await assert.rejects(()=>mod.exports.bulkListenAction([],'remove'));
 await assert.rejects(()=>mod.exports.bulkListenAction(Array.from({length:101},(_,i)=>id(i)),'remove'));
 console.log('PASS: bulk ownership, duplicates, limits, protected history/ratings/reviews and failures');
})().catch(e=>{console.error(e);process.exitCode=1});
