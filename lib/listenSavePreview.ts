import type { ListenRow } from './listen';
import { emit } from './events';

// Account-scoped save overlays survive lazy tab mounting, but are never persisted
// as successful saves. Only a server read started after confirmation retires them.
const accounts = new Map<string, Map<string, { row: ListenRow; revision: number; pending: boolean }>>();
let revision = 0;
let sequence = 0;
export const listenSaveRevision = () => revision;
export const isSavePending = (row: ListenRow) => row.id.startsWith('saving:');
const sameItem = (a: ListenRow, b: ListenRow) => a.id === b.id || (
  !!a.provider_id && a.provider === b.provider && a.provider_id === b.provider_id && a.item_type === b.item_type
);

export function mergeListenSavePreviews(userId: string, rows: ListenRow[], readRevision?: number): ListenRow[] {
  const entries = accounts.get(userId);
  let result = rows.filter(row => !isSavePending(row));
  for (const [key, entry] of entries || []) {
    if (!entry.pending && readRevision !== undefined && readRevision >= entry.revision) {
      entries?.delete(key);
      continue;
    }
    result = [entry.row, ...result.filter(row => !sameItem(row, entry.row))];
  }
  return result;
}

export function beginListenSavePreview(userId: string, row: Omit<ListenRow, 'id'>) {
  const entries = accounts.get(userId) || new Map();
  accounts.set(userId, entries);
  const key = `saving:${++sequence}`;
  const preview = { ...row, id: key } as ListenRow;
  entries.set(key, { row: preview, pending: true, revision: ++revision });
  const notify = () => emit('listen:save-preview', userId);
  notify();
  return {
    confirm(saved: Partial<ListenRow> & { id: string }) {
      entries.set(key, { row: { ...preview, ...saved }, pending: false, revision: ++revision });
      notify();
    },
    rollback() { entries.delete(key); revision++; notify(); },
  };
}

export function forgetListenSavePreview(userId: string, providerId: string) {
  const entries = accounts.get(userId);
  for (const [key, entry] of entries || []) {
    if (entry.row.provider_id === providerId) entries?.delete(key);
  }
  revision++;
}
