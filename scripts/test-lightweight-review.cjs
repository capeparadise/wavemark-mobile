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
assert.equal(mod.exports.normalizeReview('x'.repeat(6000)).length, 5000);
assert.equal(mod.exports.normalizeReview('x'.repeat(400)).length, 400);
assert.equal(mod.exports.REVIEW_PREVIEW_LENGTH, 280);

const modal = fs.readFileSync(require.resolve('../components/RatingModal.tsx'), 'utf8');
assert.match(modal, /What stood out\? \(optional\)/);
assert.match(modal, /maxLength=\{REVIEW_MAX_LENGTH\}/);
assert.match(modal, /initialReview\?: string \| null/);
const scrollStart = modal.indexOf('{!editorExpanded ? <ScrollView');
const scrollEnd = modal.indexOf('</ScrollView>', scrollStart);
assert(scrollStart >= 0 && scrollEnd > scrollStart);
assert(modal.slice(scrollStart, scrollEnd).includes('ratingSections[section]'), 'All selected sections must scroll together');
assert(modal.includes('notes: noteEditor'), 'Note participates in configurable order');
assert(!modal.includes('Jump to artwork rating'), 'Rejected shortcut must stay removed');
assert(modal.includes('{editorExpanded ? noteEditor : null}'), 'Expanded writing mode remains available');

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
