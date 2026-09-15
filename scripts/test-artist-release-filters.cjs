const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/artistReleaseFilters.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);
const rows=[{albumGroup:'album',presentationType:'project'},{albumGroup:'single',presentationType:'single'},{albumGroup:'appears_on',presentationType:'project'},{albumGroup:'appears_on',presentationType:'single'}];
const f=(scope,format)=>rows.filter(r=>m.exports.matchesArtistRelease(r,scope,format));
assert.equal(f('all','all').length,4);assert.equal(f('own','all').length,2);assert.equal(f('featured','all').length,2);
assert.deepEqual(f('own','single'),[rows[1]]);assert.deepEqual(f('featured','project'),[rows[2]]);
assert.equal(f('all','project').length,2);
console.log('PASS: own/featured/all and format intersections');
