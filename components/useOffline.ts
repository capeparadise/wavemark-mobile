import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useOffline() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      const isOff = !(state?.isConnected && state.isInternetReachable !== false);
      setOffline(isOff);
      // eslint-disable-next-line no-console
      console.log('[net]', isOff ? 'offline' : 'online');
    });
    return () => { sub && sub(); };
  }, []);

  return { offline };
}
