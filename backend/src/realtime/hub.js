/** In-process realtime hub: user → set of sockets, socket → session id. */
const conns = new Map(); // uid -> Set<ws>
const sockSession = new Map(); // ws -> sid
const listeners = { presence: [] };

export const hub = {
  online: (uid) => !!conns.get(uid)?.size,
  onlineCount: () => conns.size,
  socketCount: () => sockSession.size,
  onlineIds: () => [...conns.keys()],
  onlineSessions: () => new Set(sockSession.values()),
  onPresence(fn) { listeners.presence.push(fn); },

  add(uid, ws, sid) {
    const first = !hub.online(uid);
    if (!conns.has(uid)) conns.set(uid, new Set());
    conns.get(uid).add(ws);
    sockSession.set(ws, sid);
    if (first) listeners.presence.forEach((f) => f(uid, true));
  },
  remove(uid, ws) {
    const s = conns.get(uid);
    if (s) s.delete(ws);
    sockSession.delete(ws);
    if (!hub.online(uid)) {
      conns.delete(uid);
      listeners.presence.forEach((f) => f(uid, false));
    }
  },
  send(uid, ev, d) {
    const s = conns.get(uid);
    if (!s) return;
    const raw = JSON.stringify({ ev, d });
    for (const ws of s) {
      if (ws.readyState === 1) {
        try { ws.send(raw); } catch { /* socket dying */ }
      }
    }
  },
  sendMany(uids, ev, fn) {
    for (const uid of new Set(uids)) {
      if (!hub.online(uid)) continue;
      const d = typeof fn === 'function' ? fn(uid) : fn;
      if (d != null) hub.send(uid, ev, d);
    }
  },
  killSession(sid, reason = {}) {
    for (const [ws, s] of sockSession) {
      if (s === sid) {
        try { ws.send(JSON.stringify({ ev: 'session:revoked', d: reason })); ws.close(4401, 'revoked'); } catch { /* */ }
      }
    }
  },
  killUser(uid, reason = {}) {
    for (const ws of conns.get(uid) || []) {
      try { ws.send(JSON.stringify({ ev: 'session:revoked', d: reason })); ws.close(4401, 'revoked'); } catch { /* */ }
    }
  },
};

/** Admin realtime channel (separate socket pool). */
const adminSocks = new Map(); // ws -> admin session id
export const adminHub = {
  add(ws, sid) { adminSocks.set(ws, sid); },
  remove(ws) { adminSocks.delete(ws); },
  count: () => adminSocks.size,
  broadcast(ev, d) {
    const raw = JSON.stringify({ ev, d });
    for (const ws of adminSocks.keys()) if (ws.readyState === 1) { try { ws.send(raw); } catch { /* */ } }
  },
  killSession(sid) {
    for (const [ws, s] of adminSocks) if (s === sid) { try { ws.close(4401, 'revoked'); } catch { /* */ } }
  },
};
