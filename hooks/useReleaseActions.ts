import { useCallback, useState } from 'react';
import type { ListenRow } from '../lib/listen';

export const RELEASE_LONG_PRESS_MS = 300;

export type ReleaseActionRow = (ListenRow & {
  artist_id?: string | null;
  artistId?: string | null;
  in_list?: boolean;
}) | null;

export function useReleaseActions() {
  const [row, setRow] = useState<ReleaseActionRow>(null);
  const open = useCallback((next: NonNullable<ReleaseActionRow>) => setRow(next), []);
  const close = useCallback(() => setRow(null), []);
  return { row, visible: !!row, open, close, setRow };
}

