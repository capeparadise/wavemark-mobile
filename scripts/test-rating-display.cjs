const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(require.resolve('../lib/ratingDisplay.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleUnderTest = { exports: {} };
new Function('exports', 'module', source)(moduleUnderTest.exports, moduleUnderTest);
const { advancedRatingTotal, ratingLabel } = moduleUnderTest.exports;
const details = { production: 9, vocals: 10, lyrics: 8, replay: 9 };
assert.equal(advancedRatingTotal(9, details), 45);
assert.equal(advancedRatingTotal(8, details), 44);
assert.equal(advancedRatingTotal(9, { ...details, replay: 10 }), 46);
assert.equal(advancedRatingTotal(9, null), null);
assert.equal(advancedRatingTotal(9, { production: 9 }), null);
assert.equal(advancedRatingTotal(9, { ...details, replay: NaN }), null);
assert.equal(ratingLabel(9, details, true), '45/50 · Overall 9/10');
assert.equal(ratingLabel(9, details, false), '9/10');
assert.equal(ratingLabel(9, null, true), '9/10');
assert.equal(advancedRatingTotal(9, details), 45); // Simple-mode display didn't mutate detail.
console.log('Rating display checks passed');
