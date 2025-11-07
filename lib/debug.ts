export function debugNS(ns: string) {
  return (...args: any[]) => {
    if (__DEV__ && process.env.EXPO_PUBLIC_DEBUG === 'true') {
      console.log(`[${ns}]`, ...args);
    }
  };
}
