const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const mod={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/artistIdentity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod,mod.exports);
assert.equal(mod.exports.verifiedSpotifyArtistId('1765924916'),'2qanRMyA5bNuTvz1dK45OP');
assert.equal(mod.exports.verifiedSpotifyArtistId('ADÉLA'),null);
assert.equal(mod.exports.verifiedSpotifyArtistId('123'),null);
console.log('PASS: verified Apple identity maps to canonical Spotify artist; unknown/name-only identities do not');
