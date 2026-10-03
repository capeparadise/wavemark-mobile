import { markDone, type ListenRow } from './listen';
import { beginListenedActivity } from './listenedActivity';
import { forgetListenSavePreview } from './listenSavePreview';

export async function markListened(row: ListenRow, userId: string | undefined, done: boolean, resolve?: () => Promise<ListenRow>): Promise<{ ok: boolean; row?: ListenRow; message?: string }> {
  if (!userId) return { ok: false, message: 'Not signed in' };
  const preview = beginListenedActivity(userId, row, done);
  if (row.provider_id) forgetListenSavePreview(userId, row.provider_id);
  try {
    const target = resolve ? await resolve() : row;
    const result = await markDone(target.id, done, { userId, doneAt: preview.doneAt });
    if (!result.ok) { preview.rollback(); return result; }
    const updated = { ...target, done_at: preview.doneAt };
    preview.confirm(updated);
    return { ok: true, row: updated };
  } catch (error: any) {
    preview.rollback();
    return { ok: false, message: error?.message || 'Could not update item' };
  }
}
