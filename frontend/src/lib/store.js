import { useSyncExternalStore, useRef, useCallback } from 'react';

const listeners = new Set();
let state = {
  phase: 'boot', // boot | auth | locked | app
  me: null,
  chats: new Map(),
  users: new Map(),
  msgs: new Map(), // chatId -> {list, hasOlder, hasNewer, loaded, loading}
  typing: new Map(), // chatId -> Map(uid -> {kind, until})
  active: null,
  panel: null, // right info panel: {type:'chat'|'user', id}
  view: { name: 'chats' }, // sidebar stack top
  stack: [],
  folder: 'all',
  archived: false,
  search: '',
  conn: 'connecting',
  stories: [],
  toasts: [],
  modal: null,
  ctx: null,
  call: null,
  viewer: null,
  storyView: null,
  reply: null, edit: null, select: null,
  jump: null,
  lockedAt: 0,
};

export const getState = () => state;
export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next) return;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

/** Shallow-equal memoised selector hook. */
export function useStore(sel = (s) => s) {
  const last = useRef({ v: undefined, has: false });
  const get = useCallback(() => {
    const v = sel(state);
    const p = last.current;
    if (p.has && shallow(p.v, v)) return p.v;
    last.current = { v, has: true };
    return v;
  }, [sel]);
  return useSyncExternalStore(subscribe, get, get);
}
function shallow(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Map || b instanceof Map) return false;
  if (a instanceof Set || b instanceof Set) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}

/* ------------------------------------------------------------------ entity helpers */
export function putUsers(list) {
  if (!list?.length) return;
  const users = new Map(state.users);
  for (const u of list) if (u) users.set(u.id, { ...(users.get(u.id) || {}), ...u });
  setState({ users });
}
export function putChat(c) {
  if (!c) return;
  const chats = new Map(state.chats);
  const prev = chats.get(c.id);
  chats.set(c.id, { ...(prev || {}), ...c });
  setState({ chats });
}
export function removeChat(id) {
  const chats = new Map(state.chats); chats.delete(id);
  const msgs = new Map(state.msgs); msgs.delete(id);
  setState({ chats, msgs, ...(state.active === id ? { active: null, panel: null } : {}) });
}
export function setMsgs(cid, patch) {
  const msgs = new Map(state.msgs);
  const cur = msgs.get(cid) || { list: [], hasOlder: true, hasNewer: false, loaded: false };
  msgs.set(cid, { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) });
  setState({ msgs });
}
export function upsertMsg(m) {
  setMsgs(m.chat_id, (cur) => {
    if (!cur.loaded) return {};
    const list = cur.list.slice();
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list[i] = { ...list[i], ...m };
    else if (!cur.hasNewer) {
      // keep ordered by id (server ids are monotonic)
      let j = list.length;
      while (j > 0 && list[j - 1].id > m.id) j--;
      list.splice(j, 0, m);
    }
    return { list };
  });
}
export function dropMsgs(cid, ids) {
  const set = new Set(ids);
  setMsgs(cid, (cur) => ({ list: cur.list.filter((m) => !set.has(m.id)) }));
}

let toastId = 0;
export function toast(text, kind = 'info', ms = 3200) {
  const id = ++toastId;
  setState({ toasts: [...state.toasts, { id, text: String(text), kind }] });
  setTimeout(() => setState({ toasts: state.toasts.filter((t) => t.id !== id) }), ms);
}
