import { useEffect, useRef, useSyncExternalStore } from 'react';

/* ---------------------------------------------------------------- live bus (admin websocket) */
export const live = (() => {
  let s = { conn: 'offline', stats: null, feed: [], reportsOpen: 0 }; const subs = new Set(); const evs = new Set();
  return {
    get: () => s,
    set: (p) => { s = { ...s, ...p }; subs.forEach((f) => f()); },
    sub: (f) => { subs.add(f); return () => subs.delete(f); },
    on: (f) => { evs.add(f); return () => evs.delete(f); },
    emit: (ev, d) => evs.forEach((f) => f(ev, d)),
  };
})();
export const useLive = (sel) => useSyncExternalStore(live.sub, () => sel(live.get()));
export const onLive = live.on;

const RANK = { viewer: 1, moderator: 2, superadmin: 3 };
export const can = (admin, role) => RANK[admin?.role] >= RANK[role];


/** Re-run `fn` (debounced) whenever one of the given live events arrives. */
export function useLiveRefresh(events, fn, delay = 700) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    let t = null;
    const off = live.on((ev, d) => {
      if (!events.includes(ev) && !(ev === 'tick' && events.includes(`tick:${d?.kind}`))) return;
      clearTimeout(t); t = setTimeout(() => ref.current(ev, d), delay);
    });
    return () => { clearTimeout(t); off(); };
  }, [events.join(','), delay]); // eslint-disable-line
}
