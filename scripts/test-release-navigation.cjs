const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
let history=false,calls=[];
const router={canGoBack:()=>history,back:()=>calls.push('back'),replace:route=>calls.push(route)};
const mod={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/navigation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({router}),mod,mod.exports);
mod.exports.backFromRelease();assert.deepEqual(calls,['/(tabs)/discover']);
history=true;calls=[];mod.exports.backFromRelease();assert.deepEqual(calls,['back']);
console.log('PASS: release back preserves navigation history; direct entry falls back to Discover.');
