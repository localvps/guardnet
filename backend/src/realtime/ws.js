import { WebSocketServer } from 'ws';
import { q1, ex, run, now } from '../db.js';
import { hub, adminHub } from './hub.js';
import { hashToken, clientIp, rateHit } from '../lib/security.js';
import { ipBlocked } from '../lib/settings.js';
import { rowUser, rowChat, member, chatMemberIds, blocked, allowed, privacyOf, userJson, getOrCreatePrivate, insertMessage, deliverMessage, presenceChanged } from '../domain.js';
import { adminFromToken } from '../admin/session.js';

/* ------------------------------------------------------------------ calls (WebRTC signaling) */
const ACTIVE = new Map(); // call_id -> {a, b, answered, timer}

function finishCall(id, status) {
  const c = ACTIVE.get(id);
  if (!c) return;
  clearTimeout(c.timer);
  ACTIVE.delete(id);
  run('UPDATE calls SET ended_at=?, status=? WHERE id=?', now(), status, id);
  const r = q1('SELECT * FROM calls WHERE id=?', id);
  const dur = r.answered_at ? Math.floor((r.ended_at - r.answered_at) / 1000) : 0;
  const cid = getOrCreatePrivate(r.caller, r.callee);
  const mid = insertMessage(cid, r.caller, 'call', '', { video: !!r.video, status, dur });
  for (const uid of [r.caller, r.callee]) hub.send(uid, 'call:end', { call_id: id, status });
  deliverMessage(mid);
}

function onCall(uid, ev, d) {
  if (ev === 'call:start') {
    const to = Number.parseInt(d.to, 10) || 0; const t = rowUser(to);
    if (!t || t.deleted || t.is_bot || t.banned || to === uid) return hub.send(uid, 'call:error', { msg: 'امکان تماس با این کاربر نیست.' });
    if (blocked(to, uid) || blocked(uid, to) || !allowed(privacyOf(t).calls, to, uid)) return hub.send(uid, 'call:error', { msg: 'این کاربر تماس از شما را نمی‌پذیرد.' });
    for (const c of ACTIVE.values()) if ([c.a, c.b].includes(uid) || [c.a, c.b].includes(to)) return hub.send(uid, 'call:error', { msg: 'کاربر در حال مکالمه است.' });
    if (!rateHit(`call:${uid}`, 20, 600e3)) return hub.send(uid, 'call:error', { msg: 'تماس‌های زیادی گرفتید؛ کمی بعد تلاش کنید.' });
    const video = !!d.video;
    const id = ex("INSERT INTO calls(caller,callee,video,started_at,status) VALUES(?,?,?,?,'ringing')", uid, to, video ? 1 : 0, now());
    const timer = setTimeout(() => { const c = ACTIVE.get(id); if (c && !c.answered) finishCall(id, 'missed'); }, 45e3);
    ACTIVE.set(id, { a: uid, b: to, answered: false, timer });
    hub.send(uid, 'call:created', { call_id: id, to, video });
    if (!hub.online(to)) hub.send(uid, 'call:status', { call_id: id, status: 'offline' });
    else hub.send(to, 'call:incoming', { call_id: id, from: userJson(rowUser(uid), to), video });
    return;
  }
  const id = Number.parseInt(d.call_id, 10) || 0; const c = ACTIVE.get(id);
  if (!c || ![c.a, c.b].includes(uid)) return;
  const other = uid === c.a ? c.b : c.a;
  if (ev === 'call:accept') {
    if (uid !== c.b || c.answered) return;
    c.answered = true; clearTimeout(c.timer);
    run("UPDATE calls SET answered_at=?, status='active' WHERE id=?", now(), id);
    hub.send(other, 'call:accepted', { call_id: id });
    hub.send(uid, 'call:taken', { call_id: id }); // stop ringing on the callee's other devices
  } else if (ev === 'call:decline') finishCall(id, c.answered ? 'ended' : 'declined');
  else if (ev === 'call:hangup') finishCall(id, c.answered ? 'ended' : uid === c.a ? 'cancelled' : 'declined');
  else if (['call:offer', 'call:answer', 'call:ice', 'call:media'].includes(ev)) {
    const raw = JSON.stringify(d);
    if (raw.length < 64 * 1024) hub.send(other, ev, d);
  }
}

/* ------------------------------------------------------------------ attach */
export function attachWs(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const awss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  hub.onPresence((uid, online) => {
    if (!online) run('UPDATE users SET last_seen=? WHERE id=?', now(), uid);
    presenceChanged(uid);
    adminHub.broadcast('tick', { kind: 'presence' });
    if (!online) for (const [id, c] of ACTIVE) if ([c.a, c.b].includes(uid)) finishCall(id, c.answered ? 'ended' : 'missed');
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);
    if (ipBlocked(ip)) { socket.destroy(); return; }
    if (url.pathname.endsWith('/admin-ws')) {
      const a = adminFromToken(url.searchParams.get('token'), ip, req.headers['user-agent'], { touch: true });
      if (!a || a.sess.stage !== 'full') { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      awss.handleUpgrade(req, socket, head, (ws) => {
        adminHub.add(ws, a.sess.id);
        ws.on('close', () => adminHub.remove(ws));
        ws.on('error', () => {});
        ws.on('message', (raw) => { if (String(raw).includes('"ping"')) try { ws.send('{"ev":"pong","d":{}}'); } catch { /* */ } });
        ws.send(JSON.stringify({ ev: 'hello', d: { admin: a.admin.username } }));
      });
      return;
    }
    if (!url.pathname.endsWith('/ws')) { socket.destroy(); return; }
    const tok = url.searchParams.get('token') || '';
    const s = tok ? q1('SELECT * FROM sessions WHERE token_hash=?', hashToken(tok)) : null;
    const u = s ? rowUser(s.user_id) : null;
    if (!s || !u || u.deleted || u.banned) {
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(4401, 'unauthorized'));
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      hub.add(u.id, ws, s.id);
      run('UPDATE sessions SET last_active=?, ip=? WHERE id=?', now(), ip, s.id);
      ws.send(JSON.stringify({ ev: 'hello', d: { user_id: u.id } }));
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('error', () => {});
      ws.on('close', () => hub.remove(u.id, ws));
      ws.on('message', (raw) => {
        ws.isAlive = true;
        let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
        const ev = typeof msg?.ev === 'string' ? msg.ev : ''; const d = msg?.d && typeof msg.d === 'object' ? msg.d : {};
        if (ev === 'ping') { try { ws.send('{"ev":"pong","d":{}}'); } catch { /* */ } return; }
        if (!rateHit(`ws:${u.id}`, 200, 10e3)) return;
        try {
          if (ev === 'typing') {
            const cid = Number.parseInt(d.chat_id, 10) || 0; const c = rowChat(cid);
            if (c && member(cid, u.id) && ['private', 'group'].includes(c.type)) {
              for (const o of chatMemberIds(cid)) {
                if (o !== u.id && !(c.type === 'private' && blocked(o, u.id)))
                  hub.send(o, 'typing', { chat_id: cid, user_id: u.id, kind: ['text', 'voice', 'file', 'photo'].includes(d.kind) ? d.kind : 'text', stop: !!d.stop });
              }
            }
          } else if (ev.startsWith('call:')) onCall(u.id, ev, d);
        } catch (e) { console.error('ws message', e); }
      });
    });
  });

  // heartbeat: drop dead sockets so presence is accurate
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* */ }
    }
  }, 25e3).unref();
}
