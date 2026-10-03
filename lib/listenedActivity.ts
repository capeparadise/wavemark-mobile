import type { ListenRow } from './listen';
import { emit } from './events';

type Entry = { row: ListenRow; pending: boolean; revision: number };
const changes = new Map<string, Map<string, Entry>>();
let revision = 0;
export const listenedActivityRevision = () => revision;
const same = (a: Pick<ListenRow, 'id' | 'provider' | 'provider_id' | 'item_type'>, b: ListenRow) =>
  a.id === b.id || (!!a.provider_id && a.provider === b.provider && a.provider_id === b.provider_id && a.item_type === b.item_type);

export function beginListenedActivity(userId: string, row: ListenRow, done: boolean) {
  const account = changes.get(userId) || new Map<string, Entry>();
  changes.set(userId, account);
  const previous = account.get(row.id);
  const entry: Entry = { row: { ...row, done_at: done ? new Date().toISOString() : null }, pending: true, revision: ++revision };
  account.set(row.id, entry);
  const notify = () => emit('listen:activity-preview', userId);
  notify();
  return {
    doneAt: entry.row.done_at,
    confirm(saved: ListenRow) {
      if (account.get(row.id) !== entry) return;
      entry.row = { ...saved, done_at: entry.row.done_at };
      entry.pending = false;
      entry.revision = ++revision;
      notify();
      emit('listen:updated');
      emit('listen:refresh');
    },
    rollback() {
      if (account.get(row.id) !== entry) return;
      if (previous) account.set(row.id, previous); else account.delete(row.id);
      revision++;
      notify();
    },
  };
}

// Each screen acknowledges its own successful server read. A History response
// cannot retire a preview still needed by a lazily mounted Profile screen.
export function mergeListenedActivity<T extends { id: string; done_at: string | null }>(
  userId: string | null | undefined, rows: T[], mode: 'history' | 'list', readRevision = -1,
): T[] {
  let result = [...rows];
  for (const entry of changes.get(userId || '')?.values() || []) {
    if (!entry.pending && entry.revision <= readRevision) continue;
    const existing = result.find(row => same(row as T & ListenRow, entry.row));
    result = result.filter(row => !same(row as T & ListenRow, entry.row));
    const row = { ...entry.row, ...existing, done_at: entry.row.done_at } as unknown as T;
    if ((mode === 'history') === !!row.done_at) result.unshift(row);
  }
  return mode === 'history' ? result.sort((a, b) => Date.parse(b.done_at || '') - Date.parse(a.done_at || '')) : result;
}

export function isListenedActivityPending(userId: string | null | undefined, row: ListenRow) {
  return [...(changes.get(userId || '')?.values() || [])].some(entry => entry.pending && same(row, entry.row));
}

export function forgetListenedActivity(userId: string, id: string) {
  const account = changes.get(userId);
  for (const [key, entry] of account || []) if (key === id || entry.row.id === id) account?.delete(key);
  revision++;
  emit('listen:activity-preview', userId);
}

export function forgetListenedActivityRow(id: string) {
  for (const userId of changes.keys()) forgetListenedActivity(userId, id);
}

export function suspendListenedActivity(userId: string, providerId: string | null | undefined) {
  const account = changes.get(userId);
  const removed = [...(account || [])].filter(([, entry]) => !!providerId && entry.row.provider_id === providerId);
  for (const [key] of removed) account?.delete(key);
  revision++;
  emit('listen:activity-preview', userId);
  return () => {
    for (const [key, entry] of removed) if (!account?.has(key)) account?.set(key, entry);
    revision++;
    emit('listen:activity-preview', userId);
  };
}
