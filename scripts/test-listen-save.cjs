const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
let rows, missingDetails, race, selectFailures;
const user = { id: 'test-user' };
const unique = ['user_id', 'item_type', 'provider', 'provider_id'];
const supabase = { auth: { getUser: async () => ({ data: { user } }) }, from() {
  let filters = {}, fields = '*', action = 'select', payload;
  const q = {
    select(v) { fields = v; return q; }, eq(k,v) { filters[k]=v; return q; },
    insert(v) { action='insert'; payload=v; return q; }, update(v) { action='update'; payload=v; return q; },
    maybeSingle() { return run(); }, single() { return run(); }, then(a,b) { return run().then(a,b); },
  };
  async function run() {
    if (missingDetails && fields.includes('rating_details')) return { data:null,error:{code:'42703',message:'missing rating_details'} };
    if (action === 'select' && selectFailures-- > 0) return {data:null,error:{code:'503',message:'read unavailable'}};
    if (action === 'insert') {
      if (race) { rows.push({...payload,id:'race-winner',rating:9,review:'Keep this',rating_details:{production:8}}); race=false; }
      if(rows.some(r=>unique.every(k=>r[k]===payload[k]))) return {data:null,error:{code:'23505',message:'duplicate key value violates unique constraint "listen_list_unique_per_user_item"'}};
      const row={...payload,id:'new-row',rating:null,done_at:null};rows.push(row);return {data:row,error:null};
    }
    const matches=rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
    if(action==='update') matches.forEach(r=>Object.assign(r,payload));
    if(matches.length>1) return {data:null,error:{code:'PGRST116',message:'multiple rows'}};
    const row=matches[0];
    return {data:row ? Object.fromEntries(Object.entries(row).filter(([k])=>fields==='*'||fields.split(',').map(s=>s.trim()).includes(k))) : null,error:null};
  }
  return q;
}};
const compiled=ts.transpileModule(fs.readFileSync(require.resolve('../lib/listen.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='./supabase'?{supabase}:name==='./debug'?{debugNS:()=>()=>{}}:{},mod,mod.exports);
const input={type:'album',title:'PRIMA',artist:'ADÉLA',spotifyUrl:'https://open.spotify.com/album/fixturePrima',providerId:'fixturePrima'};
const saved=()=>({id:'album-row',user_id:user.id,item_type:'album',provider:'spotify',provider_id:'fixturePrima',title:'PRIMA',artist_name:'ADÉLA',rating:8,rating_details:{production:9,vocals:8,lyrics:7,replay:8},review:'Keep review',done_at:null});
function reset(data){rows=data;missingDetails=false;race=false;selectFailures=0;}
(async()=>{
 reset([saved(),{...saved(),id:'track-row',item_type:'track'}]);
 let result=await mod.exports.addToListFromSearch(input);
 assert.equal(result.ok,true,'Save must find the exact album when a track shares its provider ID');
 assert.equal(result.id,'album-row');assert.equal(rows.length,2);
 assert.equal(result.message,'This project is already in your listen list');assert.equal(result.alreadySaved,true);
 result=await mod.exports.addToListFromSearch({...input,type:'track'});
 assert.equal(result.id,'track-row');assert.equal(result.message,'This track is already in your listen list');
 reset([{...saved(),item_type:'track'}]);
 result=await mod.exports.addToListFromSearch(input);
 assert.equal(result.id,'new-row','An album must not reuse a track row');
 reset([saved()]);missingDetails=true;
 result=await mod.exports.addToListFromSearch(input);assert.equal(result.ok,true,'Existing row lookup must support the legacy schema');assert.equal(rows.length,1);
 reset([]);race=true;
 result=await mod.exports.addToListFromSearch(input);assert.equal(result.ok,true);assert.equal(result.id,'race-winner');assert.equal(rows[0].rating,9);assert.equal(rows[0].review,'Keep this');
 reset([{...saved(),done_at:'2026-09-08T12:00:00Z'}]);
 result=await mod.exports.addToListFromSearch(input);assert.equal(result.ok,true);assert.equal(rows[0].done_at,null,'Explicit save again still requeues the release');assert.equal(rows[0].rating,8);assert.equal(rows[0].review,'Keep review');assert.deepEqual(rows[0].rating_details,saved().rating_details);
 console.log('Listen save regressions passed (synthetic PRIMA fixture; no tester data).');
})().catch(e=>{console.error(e);process.exitCode=1;});
