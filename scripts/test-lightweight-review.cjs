const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../lib/review.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports);

assert.equal(mod.exports.normalizeReview(), null);
assert.equal(mod.exports.normalizeReview('   '), null);
assert.equal(mod.exports.normalizeReview('  loved the production  '), 'loved the production');
assert.equal(mod.exports.normalizeReview('x'.repeat(400)).length, mod.exports.REVIEW_MAX_LENGTH);

const modal = fs.readFileSync(require.resolve('../components/RatingModal.tsx'), 'utf8');
assert.match(modal, /What stood out\? \(optional\)/);
assert.match(modal, /maxLength=\{REVIEW_MAX_LENGTH\}/);
assert.match(modal, /initialReview\?: string \| null/);

for (const path of [
  '../components/TrackRatingButton.tsx',
  '../components/ReleaseActionSheet.tsx',
  '../app/(tabs)/listen.tsx',
  '../app/profile/history.tsx',
  '../app/profile/pending.tsx',
  '../app/profile/ratings.tsx',
  '../app/profile/top-rated.tsx',
]) {
  const caller = fs.readFileSync(require.resolve(path), 'utf8');
  assert.match(caller, /initialReview=/, `${path} must restore an existing rating note`);
  assert.match(caller, /onSubmit=\{async \([^)]*review/, `${path} must save rating notes`);
}

console.log('Lightweight optional rating note regressions passed.');
