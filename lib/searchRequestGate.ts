// A query change invalidates requests immediately, not 300ms later when the
// next debounce fires. Older responses must never replace the visible results.
export function createSearchRequestGate() {
  let revision = 0;
  return {
    invalidate() { revision++; },
    begin() { return ++revision; },
    accepts(request: number) { return request === revision; },
  };
}
