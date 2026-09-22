// A read begun before/during a local mutation cannot replace optimistic UI.
export function createListenRefreshGuard() {
  let revision = 0;
  let latestRead = 0;
  const pending = new Set<string>();
  return {
    begin(key: string) {
      if (pending.has(key)) return false;
      pending.add(key);
      revision++;
      return true;
    },
    finish(key: string) { pending.delete(key); revision++; },
    read() { return { revision, id: ++latestRead, pending: pending.size > 0 }; },
    accepts(read: { revision: number; id: number; pending: boolean }) {
      return !read.pending && pending.size === 0 && read.revision === revision && read.id === latestRead;
    },
  };
}
