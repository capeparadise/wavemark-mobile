const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const mod = { exports: {} };
const source = fs.readFileSync('lib/authRecovery.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports);

const {
  parseRecoveryCallback,
  passwordValidationMessage,
  resetRequestErrorMessage,
} = mod.exports;

const implicit = parseRecoveryCallback('rppl://reset-password#access_token=access-secret&refresh_token=refresh-secret&type=recovery');
assert.equal(implicit.accessToken, 'access-secret');
assert.equal(implicit.refreshToken, 'refresh-secret');
assert.equal(implicit.type, 'recovery');
assert.equal(implicit.code, null);

const code = parseRecoveryCallback('rppl://reset-password?code=one-time-code');
assert.equal(code.code, 'one-time-code');
assert.equal(code.accessToken, null);

const expired = parseRecoveryCallback('rppl://reset-password?error=access_denied&error_description=Link%20has%20expired');
assert.equal(expired.errorMessage, 'Link has expired');

assert.equal(passwordValidationMessage('', ''), 'Enter a new password.');
assert.equal(passwordValidationMessage('short', 'short'), 'Use at least 8 characters.');
assert.equal(passwordValidationMessage('long-enough', 'different'), 'The passwords do not match.');
assert.equal(passwordValidationMessage('long-enough', 'long-enough'), null);

assert.equal(resetRequestErrorMessage({ status: 429, message: 'rate limited' }), 'Please wait a little before requesting another email.');
assert.equal(resetRequestErrorMessage({ message: 'Network request failed' }), 'Check your connection and try again.');
assert.equal(resetRequestErrorMessage({ status: 400, message: 'User not found' }), null, 'Account existence must stay private');

console.log('PASS: recovery links, password validation and neutral request errors');
