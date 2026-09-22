// Runs screen load callbacks with synthetic React/native/service dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function screen(file, extra) {
  const states = []; let cursor = 0, focus;
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return states[i] ||= { current: initial }; },
    useCallback: fn => fn,
    useMemo: fn => fn(),
  };
  const deps = {
    react: { ...react, default: react },
    '@react-navigation/native': { useFocusEffect: fn => { focus = fn; } },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-router': { router: { push() {} } },
    'react-native': Object.fromEntries(['ActivityIndicator','FlatList','Image','Pressable','RefreshControl','ScrollView','Text','View'].map(x => [x,x])),
    '../../theme/useTheme': { useTheme: () => ({ colors: { text: {}, accent: {}, bg: {}, border: {} } }) },
    '../../lib/date': { formatDate: x => x },
    '../../lib/navigation': {},
    '../../components/Avatar': { default: 'Avatar' },
    '../../components/ListenerFollowButton': { default: 'Follow' },
    '../../components/ReleaseActionSheet': { default: 'Sheet' },
    '../../components/StackScreen': { default: 'Screen' },
    ...extra,
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  new Function('require','module','exports',code)(name => { assert(name in deps, name); return deps[name]; }, mod, mod.exports);
  return { render: () => { cursor = 0; return mod.exports.default(); }, focus: () => focus() };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  let fail = false;
  const value = async data => { if (fail) throw Error('offline'); return data; };
  const notifications = screen('app/profile/notifications.tsx', {
    '../../lib/discoverFreshness': { discoverReleaseDateTimestamp: x => Date.parse(x) },
    '../../lib/profileSocial': { listMyFollowRequests: () => value([{ user_id: 'request', display_name: 'Request person' }]), listMyFollowersProfiles: () => value([]) },
    '../../lib/follow': { listFollowedArtists: () => value([]) },
  });
  notifications.render(); notifications.focus(); await settle();
  assert(JSON.stringify(notifications.render()).includes('Request person'));
  fail = true; notifications.focus(); await settle();
  let tree = JSON.stringify(notifications.render());
  assert(tree.includes('Request person'), 'failed refresh must retain prior results');
  assert(tree.includes('Some updates couldn’t load'));
  assert(!tree.includes('You’re all caught up'));
  fail = false; notifications.focus(); await settle();
  assert(!JSON.stringify(notifications.render()).includes('Some updates couldn’t load'));

  const query = { select() { return query; }, eq() { return query; }, not() { return query; }, order() { return query; }, limit: () => value({ data: [{ id: 'note', title: 'Example', review: 'My note' }] }) };
  const notes = screen('app/profile/reviews.tsx', {
    '../../lib/supabase': { supabase: { auth: { getUser: () => value({ data: { user: { id: 'test' } } }) }, from: () => query } },
    '../../lib/ratingDisplay': { ratingLabel: () => '8/10' },
    '../../lib/user': { useAdvancedRatingsEnabled: () => [false] },
  });
  fail = true; notes.render(); notes.focus(); await settle();
  tree = JSON.stringify(notes.render());
  assert(tree.includes('Notes couldn’t refresh'));
  assert(!tree.includes('ActivityIndicator'), 'rejected auth must exit initial spinner');
  fail = false; notes.focus(); await settle();
  assert(JSON.stringify(notes.render()).includes('My note'));
  fail = true; notes.focus(); await settle();
  tree = JSON.stringify(notes.render());
  assert(tree.includes('My note') && tree.includes('Notes couldn’t refresh'));
  console.log('PASS: notification preservation/error/recovery and Notes rejected-load/retry/preservation. Synthetic screen callbacks, not device rendering.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
