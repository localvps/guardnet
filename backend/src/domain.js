import crypto from 'node:crypto';
import { q, q1, qv, ex, run, now } from './db.js';
import { hub, adminHub } from './realtime/hub.js';
import { COLORS, DEFAULT_PRIVACY, LIMITS, OFFICIAL_USERNAME } from './config.js';

export const J = (s, d = null) => { if (s == null || s === '') return d; try { return JSON.parse(s); } catch { return d; } };
export const rowUser = (id) => (id ? q1('SELECT * FROM users WHERE id=?', id) : undefined);
export const rowChat = (id) => q1('SELECT * FROM chats WHERE id=?', id);
export const rowMsg = (id) => q1('SELECT * FROM messages WHERE id=?', id);
export const isPremium = (u) => !!u && (u.premium_until || 0) > now();
export const privacyOf = (u) => ({ ...DEFAULT_PRIVACY, ...(J(u?.privacy, {}) || {}) });
export const isContact = (a, b) => !!q1('SELECT 1 FROM contacts WHERE owner=? AND contact=?', a, b);
export const blocked = (a, b) => !!q1('SELECT 1 FROM blocks WHERE owner=? AND blocked=?', a, b);
export const fileUrl = (fid) => (fid ? `/files/${fid}` : null);
export const limits = (u) => ({ ...(isPremium(u) ? LIMITS.premium : LIMITS.free) });

export function allowed(rule, owner, viewer) {
  if (owner === viewer) return true;
  if (blocked(owner, viewer)) return false;
  if (rule === 'all') return true;
  if (rule === 'contacts') return isContact(owner, viewer);
  return false;
}

export function userJson(u, viewer) {
  if (!u) return null;
  const id = u.id;
  if (u.deleted) return { id, username: '', name: 'حساب حذف‌شده', deleted: true, color: ['#64748b', '#334155'] };
  const p = privacyOf(u);
  const blockedMe = viewer ? blocked(id, viewer) : false;
  const prem = isPremium(u);
  const d = {
    id, username: u.username, name: u.name, bio: u.bio || '',
    color: J(u.color) || COLORS[id % COLORS.length],
    avatar: allowed(p.photo, id, viewer) && !blockedMe ? fileUrl(u.avatar) : null,
    premium: prem, emoji_status: prem ? u.emoji_status : null,
    bot: !!u.is_bot, verified: !!u.verified, created_at: u.created_at,
    banned: !!u.banned,
  };
  if (u.is_bot || (u.verified && u.username.toLowerCase() === OFFICIAL_USERNAME)) d.online = null;
  else if (allowed(p.lastSeen, id, viewer) && !blockedMe) { d.online = hub.online(id); d.last_seen = u.last_seen; }
  else { d.online = false; d.last_seen = null; d.seen_hidden = true; }
  if (viewer && viewer !== id) {
    d.is_contact = isContact(viewer, id);
    d.blocked = blocked(viewer, id);
    d.blocked_me = blockedMe;
    d.can_call = allowed(p.calls, id, viewer) && !u.is_bot && !u.banned;
  }
  return d;
}

export function meJson(u) {
  const d = userJson(u, u.id);
  return {
    ...d, online: true, privacy: privacyOf(u), settings: J(u.settings, {}) || {},
    premium_until: u.premium_until || 0, trial_used: !!u.trial_used, totp: !!u.totp_on, limits: limits(u),
  };
}

export const member = (cid, uid) => q1('SELECT * FROM members WHERE chat_id=? AND user_id=? AND left=0', cid, uid);
export const chatMemberIds = (cid) => q('SELECT user_id FROM members WHERE chat_id=? AND left=0', cid).map((r) => r.user_id);
export const myChatIds = (uid) => q('SELECT chat_id FROM members WHERE user_id=? AND left=0', uid).map((r) => r.chat_id);
export function privatePeer(c, uid) {
  if (c.type !== 'private') return null;
  const r = q1('SELECT user_id FROM members WHERE chat_id=? AND user_id<>?', c.id, uid);
  return r ? r.user_id : uid;
}
/** SQL fragment (uid is always an integer from the DB, never user input). */
export const vis = (uid) => {
  const u = Number.parseInt(uid, 10) | 0;
  return ` AND m.deleted=0 AND (m.expires_at IS NULL OR m.expires_at > ${Date.now()}) AND (m.sched_at IS NULL OR m.sender_id=${u}) AND NOT EXISTS(SELECT 1 FROM hidden h WHERE h.msg_id=m.id AND h.user_id=${u})`;
};

export function msgPreview(m) {
  if (!m) return null;
  const data = J(m.data, {}) || {};
  const small = {};
  for (const k of ['name', 'q', 'e', 't', 'dur', 'url', 'thumb', 'mime']) if (k in data) small[k] = data[k];
  return { id: m.id, sender_id: m.sender_id, type: m.type, text: (m.text || '').slice(0, 200), data: small };
}

export function messageJson(m, uid, chatType) {
  const data = J(m.data, {}) || {};
  const d = {
    id: m.id, chat_id: m.chat_id, sender_id: m.sender_id, type: m.type, text: m.text || '', data,
    created_at: m.created_at, edited_at: m.edited_at, pinned: !!m.pinned, sched_at: m.sched_at, silent: !!m.silent,
    ttl: m.ttl || 0, expires_at: m.expires_at || null,
    fwd: J(m.fwd),
  };
  if (m.reply_to) {
    const r = q1('SELECT * FROM messages WHERE id=? AND deleted=0', m.reply_to);
    d.reply = r ? msgPreview(r) : { id: m.reply_to, deleted: true };
  }
  const reacts = {};
  for (const r of q('SELECT user_id, emoji FROM reactions WHERE msg_id=? ORDER BY at', m.id)) (reacts[r.emoji] ||= []).push(r.user_id);
  d.reactions = {};
  for (const [e, v] of Object.entries(reacts)) {
    d.reactions[e] = chatType === 'channel' ? { n: v.length, me: v.includes(uid) } : { n: v.length, me: v.includes(uid), users: v.slice(0, 3) };
  }
  if (chatType === 'channel') d.views = qv('SELECT COUNT(*) FROM views WHERE msg_id=?', m.id);
  if (m.type === 'poll') {
    const votes = q('SELECT user_id, opt FROM votes WHERE msg_id=?', m.id);
    const n = (data.opts || []).length;
    const counts = Array(n).fill(0); const voters = {}; const mine = [];
    for (const v of votes) {
      if (v.opt >= 0 && v.opt < n) {
        counts[v.opt]++; (voters[v.opt] ||= []).push(v.user_id);
        if (v.user_id === uid) mine.push(v.opt);
      }
    }
    const total = new Set(votes.map((v) => v.user_id)).size;
    d.poll = { counts, total, mine, voters: data.anon ? null : Object.fromEntries(Object.entries(voters).map(([k, v]) => [k, v.slice(0, 10)])) };
    if (data.quiz && !mine.length && !data.closed && m.sender_id !== uid) {
      const { correct, explain, ...rest } = data; d.data = rest;
    }
  }
  return d;
}

export function chatJson(c, uid) {
  const mem = q1('SELECT * FROM members WHERE chat_id=? AND user_id=?', c.id, uid);
  const V = vis(uid);
  const cleared = mem ? mem.cleared : 0;
  const last = q1(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? ${V} AND m.sched_at IS NULL ORDER BY m.id DESC LIMIT 1`, c.id, cleared);
  const d = {
    id: c.id, type: c.type, title: c.title, description: c.description || '', username: c.username,
    photo: fileUrl(c.photo), color: J(c.color) || COLORS[c.id % COLORS.length], owner_id: c.owner_id,
    is_public: !!c.is_public, created_at: c.created_at, frozen: !!c.frozen,
    last_message: last ? messageJson(last, uid, c.type) : null,
  };
  if (mem && !mem.left) {
    const unread = qv(`SELECT COUNT(*) FROM messages m WHERE m.chat_id=? AND m.id>? AND m.id>? AND m.sender_id<>? AND m.sched_at IS NULL ${V}`,
      c.id, mem.last_read, cleared, uid);
    let mentions = 0;
    if (unread) {
      const me = rowUser(uid);
      if (me) mentions = qv(`SELECT COUNT(*) FROM messages m WHERE m.chat_id=? AND m.id>? AND m.sender_id<>? AND m.sched_at IS NULL AND m.text LIKE ? ${V}`,
        c.id, mem.last_read, uid, `%@${me.username}%`);
    }
    Object.assign(d, {
      member: true, role: mem.role, muted: !!mem.muted, pinned: mem.pinned, archived: !!mem.archived, draft: mem.draft || '',
      mark_unread: !!mem.mark_unread, unread, mentions, last_read: mem.last_read,
    });
    if (mem.role === 'owner' || mem.role === 'admin') d.invite = c.invite;
  } else Object.assign(d, { member: false, role: null, unread: 0 });
  d.members_count = qv('SELECT COUNT(*) FROM members WHERE chat_id=? AND left=0', c.id);
  if (c.type === 'private') {
    const peer = privatePeer(c, uid);
    d.peer_id = peer;
    const pm = q1('SELECT last_read FROM members WHERE chat_id=? AND user_id=?', c.id, peer);
    const pu = rowUser(peer), mu = rowUser(uid);
    const receipts = pu && mu ? privacyOf(pu).readReceipts && privacyOf(mu).readReceipts : true;
    d.peer_read = receipts || peer === uid ? (pm ? pm.last_read : 0) : null;
  } else if (c.type === 'group') {
    d.peer_read = qv('SELECT MAX(last_read) FROM members WHERE chat_id=? AND user_id<>? AND left=0', c.id, uid) || 0;
    d.online_count = chatMemberIds(c.id).filter((x) => hub.online(x)).length;
  } else if (c.type === 'saved') d.title = 'پیام‌های ذخیره‌شده';
  return d;
}

export function chatUsers(c, uid) {
  const ids = new Set();
  if (c.type === 'private') ids.add(privatePeer(c, uid));
  const last = q1('SELECT sender_id FROM messages WHERE chat_id=? AND deleted=0 ORDER BY id DESC LIMIT 1', c.id);
  if (last) ids.add(last.sender_id);
  return [...ids].map((i) => userJson(rowUser(i), uid)).filter(Boolean);
}

export const canPost = (c, mem) => !!mem && !c.frozen && (c.type !== 'channel' || mem.role === 'owner' || mem.role === 'admin');

export function getOrCreatePrivate(a, b) {
  const key = a !== b ? `p:${Math.min(a, b)}:${Math.max(a, b)}` : `s:${a}`;
  const ids = [...new Set([a, b])];
  const c = q1('SELECT id FROM chats WHERE pkey=?', key);
  if (c) {
    for (const u of ids) {
      ex("INSERT OR IGNORE INTO members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", c.id, u, now());
      run('UPDATE members SET left=0 WHERE chat_id=? AND user_id=?', c.id, u);
    }
    return c.id;
  }
  const cid = ex('INSERT INTO chats(type,title,pkey,created_at) VALUES(?,?,?,?)', a === b ? 'saved' : 'private', '', key, now());
  for (const u of ids) ex("INSERT INTO members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", cid, u, now());
  return cid;
}

export function pushChat(cid, uids) {
  const c = rowChat(cid);
  if (!c) return;
  for (const uid of new Set(uids || chatMemberIds(cid))) {
    if (hub.online(uid)) hub.send(uid, 'chat:update', { chat: chatJson(c, uid), users: chatUsers(c, uid) });
  }
}

export function presenceChanged(uid) {
  const u = rowUser(uid);
  if (!u) return;
  const peers = new Set();
  for (const r of q(`SELECT DISTINCT b.user_id FROM members a JOIN members b ON b.chat_id=a.chat_id AND b.left=0
                     WHERE a.user_id=? AND a.left=0`, uid)) peers.add(r.user_id);
  for (const r of q('SELECT owner FROM contacts WHERE contact=?', uid)) peers.add(r.owner);
  peers.delete(uid);
  for (const p of peers) if (hub.online(p)) hub.send(p, 'user:update', userJson(u, p));
}
export function broadcastUser(uid) {
  presenceChanged(uid);
  const u = rowUser(uid);
  if (u && hub.online(uid)) hub.send(uid, 'me:update', meJson(u));
}

/** Releases a scheduled message: re-inserted with a fresh id so it sorts at the end of the chat. */
export function releaseScheduled(mid) {
  const m = q1('SELECT * FROM messages WHERE id=? AND sched_at IS NOT NULL AND deleted=0', mid);
  if (!m) return null;
  const nid = ex('INSERT INTO messages(chat_id,sender_id,type,text,data,reply_to,fwd,created_at,silent,ttl) VALUES(?,?,?,?,?,?,?,?,?,?)',
    m.chat_id, m.sender_id, m.type, m.text, m.data, m.reply_to, m.fwd, now(), m.silent, m.ttl || 0);
  run('DELETE FROM messages WHERE id=?', mid);
  hub.send(m.sender_id, 'message:delete', { chat_id: m.chat_id, ids: [mid], scheduled: true });
  deliverMessage(nid);
  return nid;
}

export function deliverMessage(mid) {
  const m = rowMsg(mid);
  if (!m) return;
  const c = rowChat(m.chat_id);
  const sender = m.sender_id ? rowUser(m.sender_id) : null;
  for (const uid of chatMemberIds(c.id)) {
    if (!hub.online(uid)) continue;
    if (c.type === 'private' && uid !== m.sender_id && blocked(uid, m.sender_id)) continue;
    hub.send(uid, 'message:new', {
      message: messageJson(m, uid, c.type), chat: chatJson(c, uid),
      users: sender ? [userJson(sender, uid)] : [],
    });
  }
  if (m.type !== 'service') adminHub.broadcast('tick', { kind: 'message', chat_type: c.type });
}

export function updateMessage(mid, ev = 'message:update') {
  const m = rowMsg(mid);
  if (!m) return;
  const c = rowChat(m.chat_id);
  for (const uid of chatMemberIds(c.id)) {
    if (!hub.online(uid) || (m.sched_at && uid !== m.sender_id)) continue;
    hub.send(uid, ev, { message: messageJson(m, uid, c.type) });
  }
}

export const service = (cid, actor, text) =>
  ex("INSERT INTO messages(chat_id,sender_id,type,text,data,created_at) VALUES(?,?,'service',?,'{}',?)", cid, actor, text, now());

export const insertMessage = (cid, sender, type, text, data = {}, extra = {}) =>
  ex('INSERT INTO messages(chat_id,sender_id,type,text,data,reply_to,fwd,created_at,sched_at,silent,ttl) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    cid, sender, type, text || '', JSON.stringify(data || {}), extra.reply_to || null, extra.fwd ? JSON.stringify(extra.fwd) : null,
    now(), extra.sched_at || null, extra.silent ? 1 : 0, extra.ttl || 0);

export const pickColor = () => COLORS[crypto.randomInt(COLORS.length)];
