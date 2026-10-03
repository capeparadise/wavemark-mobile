const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('components/RatingModal.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
// Spaces on the same line as a fragment opening become literal text children.
// Native views reject them even though TypeScript accepts the JSX.
assert(!/React\.createElement\(React\.Fragment, null,\s*" +"/.test(compiled), 'Rating fragments must not render standalone whitespace');
console.log('PASS: no stray text children in rating section fragments.');
