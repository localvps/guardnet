import { Router } from 'express';
import crypto from 'node:crypto';
import { q, q1, qv, ex, run, now, tx } from '../db.js';
import { h, body, str, int, auth } from '../lib/http.js';
import { err } from '../lib/security.js';
import { USERNAME_RE } from '../config.js';
import {
  userJson, chatJson, chatUsers, rowUser, rowChat, member, chatMemberIds, myChatIds, getOrCreatePrivate,
  pushChat, deliverMessage, service, allowed, privacyOf, limits, isPremium, pickColor,
} from '../domain.js';
import { hub } from '../realtime/hub.js';

export const router = Router();
const invite = () => crypto.randomBytes(9).toString('base64url');

export function requireMember(cid, uid, admin = false) {
  const c = rowChat(cid);
  if (!c) err(404, 'گفتگو یافت نشد.');
  const m = member(cid, uid);
  if (!m) {
    if (c.is_public && !admin) return { c, m: null };
    err(403, 'شما عضو این گفتگو نیستید.');
  }
  if (admin && !['owner', 'admin'].includes(m.role)) err(403, 'فقط مدیران اجازه این کار را دارند.');
  return { c, m };
}

function checkChatUsername(un, cid = null) {
  if (!USERNAME_RE.test(un)) err(400, 'پیوند عمومی باید ۵ تا ۳۲ نویسه انگلیسی باشد و با حرف شروع شود.');
  const o = q1('SELECT id FROM chats WHERE username=?', un);
  if ((o && o.id !== cid) || q1('SELECT 1 FROM users WHERE username=?', un)) err(409, 'این پیوند قبلاً گرفته شده است.');
}

router.get('/', h((req) => {
  const u = auth(req);
  const ids = myChatIds(u.id);
  if (!q1('SELECT 1 FROM chats WHERE pkey=?', `s:${u.id}`)) ids.push(getOrCreatePrivate(u.id, u.id));
  const chats = []; const users = new Map();
  for (const cid of ids) {
    const c = rowChat(cid); if (!c) continue;
    chats.push(chatJson(c, u.id));
    for (const x of chatUsers(c, u.id)) users.set(x.id, x);
  }
  return { chats, users: [...users.values()] };
}));

router.post('/private', h((req) => {
  const u = auth(req); const t = rowUser(int(body(req).user_id));
  if (!t || t.deleted) err(404, 'کاربر یافت نشد.');
  const c = rowChat(getOrCreatePrivate(u.id, t.id));
  return { chat: chatJson(c, u.id), users: chatUsers(c, u.id) };
}));

router.post('/', h((req) => {
  const u = auth(req); const b = body(req);
  const type = b.type;
  if (!['group', 'channel'].includes(type)) err(400, 'نوع گفتگو نامعتبر است.');
  const title = str(b.title, 128).trim();
  if (!title) err(400, 'نام را وارد کنید.');
  const un = str(b.username, 40).trim().replace(/^@/, '') || null;
  if (un) checkChatUsername(un);
  let photo = b.photo ? str(b.photo, 40) : null;
  if (photo && !q1("SELECT 1 FROM files WHERE id=? AND owner=? AND done=1 AND mime LIKE 'image/%'", photo, u.id)) photo = null;
  const ids = (Array.isArray(b.members) ? b.members : []).slice(0, 200);
  let added = [];
  const cid = tx(() => {
    const id = ex('INSERT INTO chats(type,title,description,username,photo,color,owner_id,invite,is_public,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      type, title, str(b.description, 500), un, photo, JSON.stringify(pickColor()), u.id, invite(), un ? 1 : 0, now());
    ex("INSERT INTO members(chat_id,user_id,role,joined_at) VALUES(?,?,'owner',?)", id, u.id, now());
    service(id, u.id, `${u.name} ${type === 'group' ? 'گروه' : 'کانال'} «${title}» را ساخت`);
    for (const x of ids) {
      const t = rowUser(int(x));
      if (!t || t.deleted || t.banned || t.id === u.id || t.is_bot) continue;
      if (!allowed(privacyOf(t).groups, t.id, u.id)) continue;
      ex("INSERT OR IGNORE INTO members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", id, t.id, now());
      added.push(t.name);
    }
    if (added.length) service(id, u.id, `${u.name} ${added.join('، ')} را اضافه کرد`);
    return id;
  });
  pushChat(cid);
  return { chat: chatJson(rowChat(cid), u.id), users: [], skipped: ids.length - added.length };
}));

router.get('/:cid', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  const d = chatJson(c, u.id); let users = [];
  const order = "ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at";
  if (c.type === 'group' || (c.type === 'channel' && m && ['owner', 'admin'].includes(m.role))) {
    const rows = q(`SELECT user_id, role, joined_at FROM members WHERE chat_id=? AND left=0 ${order} LIMIT 500`, cid);
    d.members = rows; users = rows.map((r) => userJson(rowUser(r.user_id), u.id));
  } else if (c.type === 'channel') {
    const rows = q("SELECT user_id, role FROM members WHERE chat_id=? AND role IN ('owner','admin') AND left=0", cid);
    d.members = rows; users = rows.map((r) => userJson(rowUser(r.user_id), u.id));
  } else if (c.type === 'private') users = [userJson(rowUser(d.peer_id), u.id)];
  return { chat: d, users: users.filter(Boolean) };
}));

router.patch('/:cid', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c } = requireMember(cid, u.id, true);
  if (!['group', 'channel'].includes(c.type)) err(400, 'این گفتگو قابل ویرایش نیست.');
  const b = body(req);
  if ('title' in b) {
    const t = str(b.title, 128).trim();
    if (!t) err(400, 'نام نمی‌تواند خالی باشد.');
    if (t !== c.title) { run('UPDATE chats SET title=? WHERE id=?', t, cid); deliverMessage(service(cid, u.id, `${u.name} نام را به «${t}» تغییر داد`)); }
  }
  if ('description' in b) run('UPDATE chats SET description=? WHERE id=?', str(b.description, 500), cid);
  if ('photo' in b) {
    const p = b.photo ? str(b.photo, 40) : null;
    if (p && !q1("SELECT 1 FROM files WHERE id=? AND done=1 AND mime LIKE 'image/%'", p)) err(400, 'فایل نامعتبر است.');
    run('UPDATE chats SET photo=? WHERE id=?', p, cid);
    deliverMessage(service(cid, u.id, `${u.name} عکس را ${p ? 'تغییر داد' : 'حذف کرد'}`));
  }
  if ('username' in b) {
    const un = str(b.username, 40).trim().replace(/^@/, '') || null;
    if (un) checkChatUsername(un, cid);
    run('UPDATE chats SET username=?, is_public=? WHERE id=?', un, un ? 1 : 0, cid);
  }
  pushChat(cid);
  return chatJson(rowChat(cid), u.id);
}));

router.post('/:cid/invite/reset', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  requireMember(cid, u.id, true);
  run('UPDATE chats SET invite=? WHERE id=?', invite(), cid);
  pushChat(cid);
  return chatJson(rowChat(cid), u.id);
}));

export function joinChat(c, u) {
  if (member(c.id, u.id)) return;
  if (q1('SELECT 1 FROM members WHERE chat_id=? AND user_id=?', c.id, u.id))
    run("UPDATE members SET left=0, role='member', joined_at=? WHERE chat_id=? AND user_id=?", now(), c.id, u.id);
  else ex("INSERT INTO members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", c.id, u.id, now());
  const last = qv('SELECT MAX(id) FROM messages WHERE chat_id=?', c.id) || 0;
  run('UPDATE members SET last_read=? WHERE chat_id=? AND user_id=?', c.type === 'channel' ? Math.max(0, last - 20) : last, c.id, u.id);
  if (c.type === 'group') deliverMessage(service(c.id, u.id, `${u.name} به گروه پیوست`));
  pushChat(c.id);
}

router.post('/:cid/join', h((req) => {
  const u = auth(req); const c = rowChat(int(req.params.cid));
  if (!c || !c.is_public) err(404, 'گفتگوی عمومی یافت نشد.');
  joinChat(c, u);
  return chatJson(c, u.id);
}));

router.post('/:cid/members', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const c0 = rowChat(cid);
  const { c } = requireMember(cid, u.id, c0?.type === 'channel');
  if (!['group', 'channel'].includes(c.type)) err(400, 'نامعتبر');
  const added = []; let skipped = 0;
  for (const x of (Array.isArray(body(req).user_ids) ? body(req).user_ids : []).slice(0, 100)) {
    const t = rowUser(int(x));
    if (!t || t.deleted || t.is_bot || t.banned || member(cid, t.id)) continue;
    if (!allowed(privacyOf(t).groups, t.id, u.id)) { skipped++; continue; }
    if (q1('SELECT 1 FROM members WHERE chat_id=? AND user_id=?', cid, t.id))
      run("UPDATE members SET left=0, role='member', joined_at=? WHERE chat_id=? AND user_id=?", now(), cid, t.id);
    else ex("INSERT INTO members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", cid, t.id, now());
    added.push(t.name);
  }
  if (added.length && c.type === 'group') deliverMessage(service(cid, u.id, `${u.name} ${added.join('، ')} را اضافه کرد`));
  pushChat(cid);
  return { added: added.length, skipped };
}));

export function removeMember(cid, uid, actor) {
  const c = rowChat(cid);
  if (!c) err(404, 'گفتگو یافت نشد.');
  const me = member(cid, actor.id);
  if (!me) err(403, 'شما عضو نیستید.');
  const target = member(cid, uid);
  if (!target) return { ok: true };
  if (uid !== actor.id && (!['owner', 'admin'].includes(me.role) || target.role === 'owner' || (target.role === 'admin' && me.role !== 'owner')))
    err(403, 'اجازه حذف این عضو را ندارید.');
  const before = chatMemberIds(cid);
  run('UPDATE members SET left=1 WHERE chat_id=? AND user_id=?', cid, uid);
  const t = rowUser(uid);
  if (c.type === 'group') deliverMessage(service(cid, actor.id, uid === actor.id ? `${t.name} گروه را ترک کرد` : `${actor.name} ${t.name} را حذف کرد`));
  if (target.role === 'owner') {
    const nxt = q1("SELECT user_id FROM members WHERE chat_id=? AND left=0 ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at LIMIT 1", cid);
    if (nxt) { run("UPDATE members SET role='owner' WHERE chat_id=? AND user_id=?", cid, nxt.user_id); run('UPDATE chats SET owner_id=? WHERE id=?', nxt.user_id, cid); }
  }
  pushChat(cid, before);
  if (hub.online(uid)) hub.send(uid, 'chat:update', { chat: chatJson(rowChat(cid), uid), users: [] });
  return { ok: true };
}

router.delete('/:cid/members/:uid', h((req) => removeMember(int(req.params.cid), int(req.params.uid), auth(req))));

router.patch('/:cid/members/:uid', h((req) => {
  const u = auth(req); const cid = int(req.params.cid); const uid = int(req.params.uid);
  const { c, m } = requireMember(cid, u.id, true);
  if (m.role !== 'owner') err(403, 'فقط مالک می‌تواند مدیر تعیین کند.');
  const role = body(req).role;
  if (!['admin', 'member'].includes(role) || uid === u.id || !member(cid, uid)) err(400, 'نقش نامعتبر است.');
  run('UPDATE members SET role=? WHERE chat_id=? AND user_id=? AND left=0', role, cid, uid);
  if (c.type === 'group') deliverMessage(service(cid, u.id, `${rowUser(uid).name} ${role === 'admin' ? 'مدیر شد' : 'دیگر مدیر نیست'}`));
  pushChat(cid);
  return { ok: true };
}));

router.patch('/:cid/me', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  if (!m) err(403, 'ابتدا عضو شوید.');
  const b = body(req);
  if ('pinned' in b) {
    if (b.pinned) {
      const n = qv('SELECT COUNT(*) FROM members WHERE user_id=? AND pinned>0 AND left=0 AND archived=0', u.id);
      if (!m.pinned && n >= limits(u).pins) err(403, `حداکثر ${limits(u).pins} گفتگو را می‌توانید سنجاق کنید.` + (isPremium(u) ? '' : ' با پریمیوم تا ۲۰ گفتگو.'));
      if (!m.pinned) run('UPDATE members SET pinned=? WHERE chat_id=? AND user_id=?', now(), cid, u.id);
    } else run('UPDATE members SET pinned=0 WHERE chat_id=? AND user_id=?', cid, u.id);
  }
  for (const k of ['muted', 'archived', 'mark_unread']) if (k in b) run(`UPDATE members SET ${k}=? WHERE chat_id=? AND user_id=?`, b[k] ? 1 : 0, cid, u.id);
  if ('draft' in b) run('UPDATE members SET draft=? WHERE chat_id=? AND user_id=?', str(b.draft, 4000), cid, u.id);
  pushChat(cid, [u.id]);
  return chatJson(c, u.id);
}));

router.post('/:cid/read', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  if (!m) return { ok: true };
  const top = qv('SELECT MAX(id) FROM messages WHERE chat_id=?', cid) || 0;
  const last = Math.min(int(body(req).last_id), top);
  if (last > m.last_read || m.mark_unread) {
    if (c.type === 'channel') ex('INSERT OR IGNORE INTO views(msg_id,user_id) SELECT id, ? FROM messages WHERE chat_id=? AND id>? AND id<=? AND deleted=0', u.id, cid, m.last_read, last);
    run('UPDATE members SET last_read=MAX(last_read, ?), mark_unread=0 WHERE chat_id=? AND user_id=?', last, cid, u.id);
    if (['private', 'group'].includes(c.type)) {
      for (const uid of chatMemberIds(cid)) {
        if (uid !== u.id && hub.online(uid)) hub.send(uid, 'read', { chat_id: cid, user_id: u.id, last_id: last, peer_read: chatJson(c, uid).peer_read });
      }
    }
    hub.send(u.id, 'chat:update', { chat: chatJson(c, u.id), users: [] });
  }
  return { ok: true };
}));

router.post('/:cid/clear', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c } = requireMember(cid, u.id);
  const top = qv('SELECT MAX(id) FROM messages WHERE chat_id=?', cid) || 0;
  if (body(req).for_all && c.type === 'private') {
    run('UPDATE messages SET deleted=1 WHERE chat_id=?', cid);
    chatMemberIds(cid).forEach((uid) => hub.send(uid, 'chat:cleared', { chat_id: cid }));
    pushChat(cid);
  } else {
    run('UPDATE members SET cleared=? WHERE chat_id=? AND user_id=?', top, cid, u.id);
    hub.send(u.id, 'chat:cleared', { chat_id: cid });
    pushChat(cid, [u.id]);
  }
  return { ok: true };
}));

router.delete('/:cid', h((req) => {
  const u = auth(req); const cid = int(req.params.cid); const c = rowChat(cid);
  if (!c) err(404, 'گفتگو یافت نشد.');
  const m = member(cid, u.id);
  if (!m) err(403, 'شما عضو نیستید.');
  const b = body(req); const ids = chatMemberIds(cid);
  if (['group', 'channel'].includes(c.type) && m.role === 'owner' && b.destroy) {
    run('DELETE FROM chats WHERE id=?', cid);
    ids.forEach((uid) => hub.send(uid, 'chat:removed', { chat_id: cid }));
    return { ok: true };
  }
  if (c.type === 'private' && b.for_all) {
    run('UPDATE messages SET deleted=1 WHERE chat_id=?', cid);
    ids.forEach((uid) => hub.send(uid, 'chat:cleared', { chat_id: cid }));
  }
  if (['private', 'saved'].includes(c.type)) {
    const top = qv('SELECT MAX(id) FROM messages WHERE chat_id=?', cid) || 0;
    run('UPDATE members SET cleared=?, pinned=0, archived=0 WHERE chat_id=? AND user_id=?', top, cid, u.id);
    if (c.type !== 'saved') run('UPDATE members SET left=1 WHERE chat_id=? AND user_id=?', cid, u.id);
    hub.send(u.id, 'chat:removed', { chat_id: cid });
    return { ok: true };
  }
  const r = removeMember(cid, u.id, u);
  hub.send(u.id, 'chat:removed', { chat_id: cid });
  return r;
}));

/* invites (mounted at /api/invite) */
export const inviteRouter = Router();
inviteRouter.get('/:code', h((req) => {
  const u = auth(req); const c = q1('SELECT * FROM chats WHERE invite=?', str(req.params.code, 40));
  if (!c) err(404, 'پیوند دعوت نامعتبر یا منقضی شده است.');
  const d = chatJson(c, u.id); delete d.last_message; delete d.invite;
  return d;
}));
inviteRouter.post('/:code', h((req) => {
  const u = auth(req); const c = q1('SELECT * FROM chats WHERE invite=?', str(req.params.code, 40));
  if (!c) err(404, 'پیوند دعوت نامعتبر یا منقضی شده است.');
  joinChat(c, u);
  return chatJson(c, u.id);
}));
