type Handler<T = any> = (payload?: T) => void;
const bus = new Map<string, Set<Handler>>();

export function on<T = any>(event: string, handler: Handler<T>) {
  let set = bus.get(event);
  if (!set) { set = new Set(); bus.set(event, set); }
  set.add(handler as Handler);
}

export function off<T = any>(event: string, handler: Handler<T>) {
  const set = bus.get(event);
  if (!set) return;
  set.delete(handler as Handler);
}

export function emit<T = any>(event: string, payload?: T) {
  const set = bus.get(event);
  if (!set) return;
  for (const h of Array.from(set)) {
    try { h(payload); } catch { /* noop */ }
  }
}
