import AsyncStorage from '@react-native-async-storage/async-storage';

let _override: string | null = null;
let _loaded = false;

async function loadOnce() {
  if (_loaded) return;
  try {
    const v = await AsyncStorage.getItem('marketOverride');
    _override = v ? v.toUpperCase() : null;
  } catch {}
  _loaded = true;
}

// Kick off async load on import
loadOnce();

export function getMarketOverride(): string | null {
  return _override;
}

export async function setMarketOverride(v: string | null) {
  _override = v ? v.toUpperCase() : null;
  try {
    if (_override) await AsyncStorage.setItem('marketOverride', _override);
    else await AsyncStorage.removeItem('marketOverride');
  } catch {}
}

export async function initMarketOverride() {
  await loadOnce();
}
