// Exercise the real button with local React/native mocks, without an account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const alerts = [];
const busy = [];
let calls = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useEffect: () => {},
  useState: initial => [initial, value => busy.push(value)],
};
const deps = {
  react: { ...react, default: react },
  'react-native': { Alert: { alert: (...args) => alerts.push(args) }, Pressable: 'Pressable', Text: 'Text' },
  './haptics': { H: { success() {}, tap() {} } },
  '../theme/useTheme': { useTheme: () => ({ colors: { bg: {}, accent: {}, border: {}, text: {} } }) },
  '../lib/profileSocial': {
    followListener: async () => { calls++; throw new Error('offline'); },
    unfollowListener: async () => { calls++; throw new Error('offline'); },
  },
};
const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync('components/ListenerFollowButton.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
new Function('require', 'module', 'exports', code)(name => {
  assert(name in deps, name);
  return deps[name];
}, mod, mod.exports);
async function main() {
  let changed = false;
  const button = mod.exports.default({ userId: 'test', initialStatus: 'none', followsYou: true, onChanged: () => { changed = true; } });
  button.props.onPress({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(alerts.at(-1)[0], 'Could not confirm follow');
  assert.equal(busy.at(-1), false);
  assert.equal(changed, false);
  button.props.onPress({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2, 'retry can issue another request');
  const following = mod.exports.default({ userId: 'test', initialStatus: 'following' });
  following.props.onPress({ stopPropagation() {} });
  await alerts.at(-1)[2][1].onPress();
  assert.equal(alerts.at(-1)[0], 'Could not confirm change');
  assert.equal(busy.at(-1), false);
  console.log('PASS: follow/unfollow transport failures alert, release busy state and allow retry.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
