import { useSyncExternalStore } from 'react';
import { on, off } from '../lib/events';
import { listenedActivityRevision } from '../lib/listenedActivity';
const subscribe = (notify: () => void) => {
  on('listen:activity-preview', notify);
  return () => off('listen:activity-preview', notify);
};
export function useListenedActivity() {
  return useSyncExternalStore(subscribe, listenedActivityRevision, listenedActivityRevision);
}
