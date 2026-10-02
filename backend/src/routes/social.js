import { Router } from 'express';
import { q, q1, ex, run, now, likeEsc } from '../db.js';
import { h, body, str, int, auth } from '../lib/http.js';
import { err, rateHit } from '../lib/security.js';
import { userJson, chatJson, messageJson, rowUser, rowChat, rowMsg, privatePeer, vis, member, msgPreview } from '../domain.js';
import { OFFICIAL_ID } from '../system.js';
import { hub, adminHub } from '../realtime/hub.js';

export const router = Router();

router.get('/users/:uid', h((req) => {
  const u = auth(req); const t = rowUser(int(req.params.uid));
  if (!t) err(404, 'کاربر یافت نشد.');
  const d = userJson(t, u.id);
  d.common_groups = q(`SELECT c.id FROM chats c JOIN members a ON a.chat_id=c.id AND a.user_id=? AND a.left=0
    JOIN members b ON b.chat_id=c.id AND b.user_id=? AND b.left=0 WHERE c.type='group'`, u.id, t.id).length;
  return d;
}));

router.get('/resolve/:name', h((req) => {
  const u = auth(req); const name = str(req.params.name, 40).replace(/^@/, '');
  const t = q1('SELECT * FROM users WHERE username=? AND deleted=0', name);
  if (t) return { user: userJson(t, u.id) };
  const c = q1('SELECT * FROM chats WHERE username=? AND is_public=1', name);
  if (c) return { chat: chatJson(c, u.id) };
  err(404, 'نام کاربری یافت نشد.');
}));

router.get('/search', h((req) => {
  const u = auth(req);
  if (!rateHit(`search:${u.id}`, 120, 60e3)) err(429, 'جستجوی زیاد؛ کمی صبر کنید.');
  const s = str(req.query.q, 64).trim().replace(/^@/, '');
  if (!s) return { users: [], chats: [], messages: [], msg_chats: [], msg_users: [] };
  const like = likeEsc(s);
  const users = q(`SELECT * FROM users WHERE deleted=0 AND banned=0 AND (pass_hash IS NOT NULL OR verified=1)
    AND (username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY (username=? COLLATE NOCASE) DESC, verified DESC, id LIMIT 25`, like, like, s);
  const chats = q(`SELECT * FROM chats WHERE is_public=1 AND type IN ('group','channel') AND (username LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') LIMIT 20`, like, like);
  const msgs = q(`SELECT m.* FROM messages m JOIN members mb ON mb.chat_id=m.chat_id AND mb.user_id=? AND mb.left=0
    WHERE m.type<>'service' AND m.id>mb.cleared AND (m.text LIKE ? ESCAPE '\\' OR (m.type IN ('file','poll') AND m.data LIKE ? ESCAPE '\\')) ${vis(u.id)}
    ORDER BY m.id DESC LIMIT 40`, u.id, like, like);
  const uids = new Set(msgs.map((m) => m.sender_id));
  const chatMap = new Map();
  for (const m of msgs) {
    if (chatMap.has(m.chat_id)) continue;
    const c = rowChat(m.chat_id);
    chatMap.set(m.chat_id, chatJson(c, u.id));
    if (c.type === 'private') uids.add(privatePeer(c, u.id));
  }
  return {
    users: users.map((x) => userJson(x, u.id)),
    chats: chats.map((c) => chatJson(c, u.id)),
    messages: msgs.map((m) => messageJson(m, u.id)),
    msg_chats: [...chatMap.values()],
    msg_users: [...uids].map((i) => userJson(rowUser(i), u.id)).filter(Boolean),
  };
}));

router.get('/contacts', h((req) => {
  const u = auth(req);
  return q('SELECT u.* FROM contacts c JOIN users u ON u.id=c.contact WHERE c.owner=? AND u.deleted=0 ORDER BY u.name', u.id).map((x) => userJson(x, u.id));
}));
router.post('/contacts/:uid', h((req) => {
  const u = auth(req); const id = int(req.params.uid); const t = rowUser(id);
  if (id === u.id || !t || t.deleted) err(400, 'کاربر نامعتبر است.');
  ex('INSERT OR IGNORE INTO contacts(owner,contact,created_at) VALUES(?,?,?)', u.id, id, now());
  hub.send(id, 'user:update', userJson(u, id));
  return userJson(rowUser(id), u.id);
}));
router.delete('/contacts/:uid', h((req) => {
  const u = auth(req); const id = int(req.params.uid);
  run('DELETE FROM contacts WHERE owner=? AND contact=?', u.id, id);
  hub.send(id, 'user:update', userJson(u, id));
  return userJson(rowUser(id), u.id);
}));

router.get('/blocks', h((req) => {
  const u = auth(req);
  return q('SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked WHERE b.owner=?', u.id).map((x) => userJson(x, u.id));
}));
router.post('/blocks/:uid', h((req) => {
  const u = auth(req); const id = int(req.params.uid);
  if (id === u.id || id === OFFICIAL_ID || !rowUser(id)) err(400, 'امکان مسدود کردن این حساب نیست.');
  ex('INSERT OR IGNORE INTO blocks(owner,blocked,created_at) VALUES(?,?,?)', u.id, id, now());
  hub.send(id, 'user:update', userJson(u, id));
  return userJson(rowUser(id), u.id);
}));
router.delete('/blocks/:uid', h((req) => {
  const u = auth(req); const id = int(req.params.uid);
  run('DELETE FROM blocks WHERE owner=? AND blocked=?', u.id, id);
  hub.send(id, 'user:update', userJson(u, id));
  return userJson(rowUser(id), u.id);
}));

/* ------------------------------------------------------------------ reports (moderation queue for admins) */
const REASONS = { spam: 'هرزنامه', violence: 'خشونت', porn: 'محتوای مستهجن', child: 'کودک‌آزاری', copyright: 'نقض کپی‌رایت', fake: 'جعل هویت', scam: 'کلاهبرداری', other: 'سایر' };
router.post('/reports', h((req) => {
  const u = auth(req); const b = body(req);
  if (!rateHit(`report:${u.id}`, 20, 3600e3)) err(429, 'گزارش‌های زیادی ثبت کرده‌اید؛ بعداً تلاش کنید.');
  const kind = str(b.kind, 10); const reason = str(b.reason, 20);
  if (!['user', 'message', 'chat'].includes(kind)) err(400, 'نوع گزارش نامعتبر است.');
  if (!(reason in REASONS)) err(400, 'دلیل گزارش را انتخاب کنید.');
  const target = int(b.target_id);
  let snapshot = null; let chatId = null;
  if (kind === 'user') {
    const t = rowUser(target); if (!t || t.id === u.id) err(400, 'کاربر نامعتبر است.');
    snapshot = { username: t.username, name: t.name, bio: t.bio };
  } else if (kind === 'message') {
    const m = rowMsg(target); if (!m || m.deleted) err(404, 'پیام یافت نشد.');
    const c = rowChat(m.chat_id);
    if (!member(c.id, u.id) && !c.is_public) err(403, 'دسترسی ندارید.');
    chatId = c.id; snapshot = { ...msgPreview(m), chat_title: c.title, chat_type: c.type, sender: rowUser(m.sender_id)?.username };
  } else {
    const c = rowChat(target); if (!c || !['group', 'channel'].includes(c.type)) err(404, 'گفتگو یافت نشد.');
    chatId = c.id; snapshot = { title: c.title, username: c.username, type: c.type };
  }
  if (q1("SELECT 1 FROM reports WHERE reporter=? AND kind=? AND target_id=? AND status='open'", u.id, kind, target)) return { ok: true, duplicate: true };
  const id = ex('INSERT INTO reports(reporter,kind,target_id,chat_id,reason,note,snapshot,created_at) VALUES(?,?,?,?,?,?,?,?)',
    u.id, kind, target, chatId, reason, str(b.note, 500), JSON.stringify(snapshot), now());
  adminHub.broadcast('report:new', { id, kind, reason });
  return { ok: true, id };
}));
