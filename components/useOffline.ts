import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import type { NetInfoState } from '@react-native-community/netinfo';

export function isConfirmedOffline(state?: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'> | null) {
  return state?.isConnected === false || state?.isInternetReachable === false;
}

export function useOffline() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = (state: NetInfoState) => {
      const isOff = isConfirmedOffline(state);
      setOffline(isOff);
      console.log('[net]', isOff ? 'offline' : 'online');
    };
    NetInfo.fetch().then(update).catch(() => {});
    const sub = NetInfo.addEventListener((state) => {
      update(state);
    });
    return () => { sub && sub(); };
  }, []);

  return { offline };
}
