import { Router } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { q, q1, qv, ex, run, now, likeEsc, tx } from '../db.js';
import { h, body, str, int } from '../lib/http.js';
import { err, hashPassword, faNum } from '../lib/security.js';
import { sec, updateSec, invalidateIps } from '../lib/settings.js';
import { DB_PATH, UPLOADS } from '../config.js';
import { hub, adminHub } from '../realtime/hub.js';
import { J, rowUser, rowChat, isPremium, fileUrl, chatMemberIds, msgPreview, broadcastUser, presenceChanged, pushChat, userJson } from '../domain.js';
import { systemMessage, OFFICIAL_ID, BOT_ID } from '../system.js';
import { requireAdmin, generatePassword, ROLES, adminPasswordProblem } from './session.js';
import { audit, verifyChain } from './audit.js';
import { adminJson } from './auth.js';

export const router = Router();
const V = requireAdmin();
const MOD = requireAdmin({ role: 'moderator' });
const SUPER = requireAdmin({ role: 'superadmin' });
const SUPER_RE = requireAdmin({ role: 'superadmin', reauth: true });
const MOD_RE = requireAdmin({ role: 'moderator', reauth: true });
const page = (req, size = 25) => { const p = Math.max(1, int(req.query.page, 1)); return { p, size, off: (p - 1) * size }; };
const STARTED = now();

const uRow = (u) => ({
  id: u.id, username: u.username, name: u.name, avatar: fileUrl(u.avatar), color: J(u.color), bio: u.bio,
  created_at: u.created_at, last_seen: u.last_seen, online: hub.online(u.id), premium: isPremium(u), premium_until: u.premium_until,
  verified: !!u.verified, bot: !!u.is_bot, deleted: !!u.deleted, banned: !!u.banned, ban_reason: u.ban_reason, banned_at: u.banned_at,
  totp: !!u.totp_on, reg_ip: u.reg_ip, system: u.id === OFFICIAL_ID || u.id === BOT_ID,
});

/* ------------------------------------------------------------------ dashboard */
function stats() {
  const t = now(); const H = 3600e3; const D = 86400e3;
  const hours = []; for (let i = 23; i >= 0; i--) hours.push(Math.floor((t - i * H) / H) * H);
  const msgRows = q("SELECT (created_at/3600000)*3600000 AS b, COUNT(*) n FROM messages WHERE created_at>=? AND type NOT IN ('service') GROUP BY b", hours[0]);
  const mm = new Map(msgRows.map((r) => [r.b, r.n]));
  const days = []; for (let i = 13; i >= 0; i--) days.push(Math.floor((t - i * D) / D) * D);
  const sRows = q('SELECT (created_at/86400000)*86400000 AS b, COUNT(*) n FROM users WHERE created_at>=? AND is_bot=0 AND pass_hash IS NOT NULL GROUP BY b', days[0]);
  const sm = new Map(sRows.map((r) => [r.b, r.n]));
  const lRows = q("SELECT (at/3600000)*3600000 AS b, SUM(ok) ok, SUM(1-ok) bad FROM login_attempts WHERE at>=? GROUP BY b", hours[0]);
  const lm = new Map(lRows.map((r) => [r.b, r]));
  let dbSize = 0; try { dbSize = fs.statSync(DB_PATH).size + (fs.existsSync(DB_PATH + '-wal') ? fs.statSync(DB_PATH + '-wal').size : 0); } catch { /* */ }
  return {
    users: qv('SELECT COUNT(*) FROM users WHERE is_bot=0 AND deleted=0 AND pass_hash IS NOT NULL'),
    online: hub.onlineCount(), sockets: hub.socketCount(), admin_sockets: adminHub.count(),
    new_today: qv('SELECT COUNT(*) FROM users WHERE created_at>=? AND is_bot=0 AND pass_hash IS NOT NULL', Math.floor(t / D) * D),
    premium: qv('SELECT COUNT(*) FROM users WHERE premium_until>? AND deleted=0', t),
    banned: qv('SELECT COUNT(*) FROM users WHERE banned=1 AND deleted=0'),
    twofa: qv('SELECT COUNT(*) FROM users WHERE totp_on=1 AND deleted=0'),
    messages: qv("SELECT COUNT(*) FROM messages WHERE deleted=0 AND type<>'service'"),
    messages_24h: qv("SELECT COUNT(*) FROM messages WHERE created_at>=? AND type<>'service'", t - D),
    groups: qv("SELECT COUNT(*) FROM chats WHERE type='group'"), channels: qv("SELECT COUNT(*) FROM chats WHERE type='channel'"),
    privates: qv("SELECT COUNT(*) FROM chats WHERE type='private'"),
    files: qv('SELECT COUNT(*) FROM files WHERE done=1'), files_bytes: qv('SELECT COALESCE(SUM(size),0) FROM files WHERE done=1'),
    stories: qv('SELECT COUNT(*) FROM stories WHERE expires_at>?', t), calls_24h: qv('SELECT COUNT(*) FROM calls WHERE started_at>=?', t - D),
    reports_open: qv("SELECT COUNT(*) FROM reports WHERE status='open'"),
    failed_logins_24h: qv('SELECT COUNT(*) FROM login_attempts WHERE ok=0 AND at>=?', t - D),
    ip_blocks: qv('SELECT COUNT(*) FROM ip_blocks'),
    sessions: qv('SELECT COUNT(*) FROM sessions'),
    series: {
      messages: hours.map((b) => ({ t: b, n: mm.get(b) || 0 })),
      signups: days.map((b) => ({ t: b, n: sm.get(b) || 0 })),
      logins: hours.map((b) => ({ t: b, ok: lm.get(b)?.ok || 0, bad: lm.get(b)?.bad || 0 })),
    },
    server: { uptime: Math.floor((t - STARTED) / 1000), rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed, node: process.version, db_size: dbSize },
    now: t,
  };
}
router.get('/stats', V, h(() => stats()));
router.get('/activity', V, h(() => ({
  signups: q('SELECT id, username, name, created_at, reg_ip FROM users WHERE is_bot=0 AND pass_hash IS NOT NULL ORDER BY id DESC LIMIT 8'),
  logins: q("SELECT username, ip, ok, reason, at, scope FROM login_attempts ORDER BY id DESC LIMIT 12"),
  reports: q("SELECT id, kind, reason, created_at FROM reports WHERE status='open' ORDER BY id DESC LIMIT 6"),
})));

/* ------------------------------------------------------------------ users */
router.get('/users', V, h((req) => {
  const { p, size, off } = page(req);
  const s = str(req.query.q, 64).trim().replace(/^@/, '');
  const f = str(req.query.filter, 20);
  const where = ['u.is_bot=0 OR u.verified=1']; const args = [];
  if (s) {
    if (/^\d+$/.test(s)) { where.push('(u.id=? OR u.username LIKE ? ESCAPE \'\\\' OR u.name LIKE ? ESCAPE \'\\\')'); args.push(+s, likeEsc(s), likeEsc(s)); }
    else { where.push("(u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.reg_ip=?)"); args.push(likeEsc(s), likeEsc(s), s); }
  }
  const t = now();
  const filters = {
    banned: 'u.banned=1', premium: `u.premium_until>${t}`, verified: 'u.verified=1', twofa: 'u.totp_on=1', deleted: 'u.deleted=1',
    active: 'u.deleted=0 AND u.banned=0',
  };
  if (filters[f]) where.push(filters[f]);
  let ids = null;
  if (f === 'online') { ids = hub.onlineIds(); if (!ids.length) return { items: [], total: 0, page: p, size }; where.push(`u.id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  const W = where.map((w) => `(${w})`).join(' AND ');
  const total = qv(`SELECT COUNT(*) FROM users u WHERE ${W}`, ...args);
  const items = q(`SELECT u.* FROM users u WHERE ${W} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...args, size, off).map(uRow);
  return { items, total, page: p, size };
}));

router.get('/users/:id', V, h((req) => {
  const u = rowUser(int(req.params.id));
  if (!u) err(404, 'کاربر یافت نشد.');
  const online = hub.onlineSessions();
  return {
    user: uRow(u), privacy: J(u.privacy, {}),
    sessions: q('SELECT id, device, ip, created_at, last_active FROM sessions WHERE user_id=? ORDER BY last_active DESC', u.id).map((s) => ({ ...s, online: online.has(s.id) })),
    counts: {
      messages: qv("SELECT COUNT(*) FROM messages WHERE sender_id=? AND type<>'service'", u.id),
      chats: qv('SELECT COUNT(*) FROM members WHERE user_id=? AND left=0', u.id),
      contacts: qv('SELECT COUNT(*) FROM contacts WHERE owner=?', u.id),
      files: qv('SELECT COUNT(*) FROM files WHERE owner=? AND done=1', u.id),
      reports_against: qv("SELECT COUNT(*) FROM reports WHERE kind='user' AND target_id=?", u.id),
      blocked_by: qv('SELECT COUNT(*) FROM blocks WHERE blocked=?', u.id),
    },
    logins: q("SELECT ip, ua, ok, reason, at FROM login_attempts WHERE scope='user' AND username=? COLLATE NOCASE ORDER BY id DESC LIMIT 20", u.username),
    groups: q(`SELECT c.id, c.type, c.title, m.role FROM members m JOIN chats c ON c.id=m.chat_id WHERE m.user_id=? AND m.left=0 AND c.type IN ('group','channel') ORDER BY c.id DESC LIMIT 50`, u.id),
  };
}));

const guardSystem = (u) => { if (!u) err(404, 'کاربر یافت نشد.'); if (u.id === OFFICIAL_ID || u.id === BOT_ID) err(400, 'حساب‌های سیستمی قابل تغییر نیستند.'); };
function killAll(uid, reason) {
  const ids = q('SELECT id FROM sessions WHERE user_id=?', uid).map((r) => r.id);
  run('DELETE FROM sessions WHERE user_id=?', uid);
  hub.killUser(uid, reason);
  return ids.length;
}

router.post('/users/:id/ban', MOD, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  const reason = str(body(req).reason, 200).trim() || 'نقض قوانین GuardNet';
  run('UPDATE users SET banned=1, ban_reason=?, banned_at=? WHERE id=?', reason, now(), u.id);
  const n = killAll(u.id, { banned: true, reason });
  presenceChanged(u.id);
  audit(req, 'user.ban', `${u.id}:@${u.username}`, { reason, sessions: n });
  return { ok: true };
}));
router.post('/users/:id/unban', MOD, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  run('UPDATE users SET banned=0, ban_reason=NULL, banned_at=NULL WHERE id=?', u.id);
  audit(req, 'user.unban', `${u.id}:@${u.username}`);
  return { ok: true };
}));
router.post('/users/:id/logout', MOD, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  const n = killAll(u.id, { admin: true });
  audit(req, 'user.force_logout', `${u.id}:@${u.username}`, { sessions: n });
  return { ok: true, count: n };
}));
router.delete('/users/:id/sessions/:sid', MOD, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u); const sid = int(req.params.sid);
  run('DELETE FROM sessions WHERE id=? AND user_id=?', sid, u.id);
  hub.killSession(sid, { admin: true });
  audit(req, 'user.session_revoked', `${u.id}:@${u.username}`, { sid });
  return { ok: true };
}));
router.post('/users/:id/verify', MOD, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u); const v = !!body(req).verified;
  run('UPDATE users SET verified=? WHERE id=?', v ? 1 : 0, u.id);
  broadcastUser(u.id);
  audit(req, v ? 'user.verify' : 'user.unverify', `${u.id}:@${u.username}`);
  return { ok: true };
}));
router.post('/users/:id/premium', SUPER, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  const days = Math.min(Math.max(int(body(req).days), 0), 3650);
  const until = days ? Math.max(now(), u.premium_until || 0) + days * 86400e3 : 0;
  run('UPDATE users SET premium_until=? WHERE id=?', until, u.id);
  if (!days) run('UPDATE users SET emoji_status=NULL WHERE id=?', u.id);
  else systemMessage(u.id, `⭐ ${faNum(days)} روز GuardNet Premium از طرف تیم GuardNet به حساب شما اضافه شد.`);
  broadcastUser(u.id);
  audit(req, days ? 'user.premium_grant' : 'user.premium_revoke', `${u.id}:@${u.username}`, { days });
  return { ok: true, premium_until: until };
}));
router.post('/users/:id/reset-password', SUPER_RE, h(async (req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  if (u.deleted) err(400, 'حساب حذف شده است.');
  const pw = generatePassword(16);
  run('UPDATE users SET pass_hash=? WHERE id=?', await hashPassword(pw), u.id);
  const n = killAll(u.id, { admin: true });
  audit(req, 'user.password_reset', `${u.id}:@${u.username}`, { sessions: n });
  return { ok: true, password: pw };
}));
router.post('/users/:id/disable-2fa', SUPER_RE, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  run('UPDATE users SET totp_on=0, totp_secret=NULL, totp_pending=NULL WHERE id=?', u.id);
  systemMessage(u.id, '⚠️ تأیید دو مرحله‌ای حساب شما به درخواست پشتیبانی GuardNet غیرفعال شد. لطفاً دوباره فعالش کنید.');
  audit(req, 'user.2fa_disabled', `${u.id}:@${u.username}`);
  return { ok: true };
}));
router.delete('/users/:id', SUPER_RE, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  if (u.deleted) err(400, 'حساب قبلاً حذف شده است.');
  killAll(u.id, { deleted: true });
  run("UPDATE users SET deleted=1, username=?, name='حساب حذف‌شده', bio='', avatar=NULL, pass_hash=NULL, totp_on=0, totp_secret=NULL WHERE id=?",
    `deleted_${u.id}_${crypto.randomBytes(3).toString('hex')}`, u.id);
  run('DELETE FROM contacts WHERE owner=? OR contact=?', u.id, u.id);
  run('DELETE FROM stories WHERE user_id=?', u.id);
  presenceChanged(u.id);
  audit(req, 'user.delete', `${u.id}:@${u.username}`);
  return { ok: true };
}));
router.post('/users/:id/message', MOD, h((req) => {
  const u = rowUser(int(req.params.id)); guardSystem(u);
  const text = str(body(req).text, 4000).trim();
  if (!text) err(400, 'متن پیام را بنویسید.');
  systemMessage(u.id, text);
  audit(req, 'user.official_message', `${u.id}:@${u.username}`, { len: text.length });
  return { ok: true };
}));

/* ------------------------------------------------------------------ chats & messages */
router.get('/chats', V, h((req) => {
  const { p, size, off } = page(req);
  const s = str(req.query.q, 64).trim().replace(/^@/, ''); const type = str(req.query.type, 10);
  const where = ["c.type IN ('group','channel','private')"]; const args = [];
  if (['group', 'channel', 'private'].includes(type)) { where.push('c.type=?'); args.push(type); }
  if (s) { where.push("(c.title LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\' OR c.id=?)"); args.push(likeEsc(s), likeEsc(s), int(s, -1)); }
  if (req.query.frozen === '1') where.push('c.frozen=1');
  const W = where.join(' AND ');
  const total = qv(`SELECT COUNT(*) FROM chats c WHERE ${W}`, ...args);
  const items = q(`SELECT c.*, (SELECT COUNT(*) FROM members m WHERE m.chat_id=c.id AND m.left=0) members,
      (SELECT COUNT(*) FROM messages x WHERE x.chat_id=c.id AND x.deleted=0 AND x.type<>'service') msgs,
      (SELECT MAX(created_at) FROM messages x WHERE x.chat_id=c.id) last_at
      FROM chats c WHERE ${W} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...args, size, off)
    .map((c) => {
      let title = c.title;
      if (c.type === 'private') {
        const names = q('SELECT u.username FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=?', c.id).map((r) => '@' + r.username);
        title = names.join(' ↔ ');
      }
      return { id: c.id, type: c.type, title, username: c.username, photo: fileUrl(c.photo), color: J(c.color), is_public: !!c.is_public,
        frozen: !!c.frozen, owner: c.owner_id ? rowUser(c.owner_id)?.username : null, members: c.members, messages: c.msgs, last_at: c.last_at, created_at: c.created_at };
    });
  return { items, total, page: p, size };
}));

router.get('/chats/:id', V, h((req) => {
  const c = rowChat(int(req.params.id));
  if (!c) err(404, 'گفتگو یافت نشد.');
  const members = q(`SELECT m.user_id, m.role, m.joined_at, u.username, u.name, u.banned FROM members m JOIN users u ON u.id=m.user_id
      WHERE m.chat_id=? AND m.left=0 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 300`, c.id);
  return { chat: { id: c.id, type: c.type, title: c.title, description: c.description, username: c.username, is_public: !!c.is_public,
    frozen: !!c.frozen, invite: c.invite, created_at: c.created_at, photo: fileUrl(c.photo), color: J(c.color) }, members };
}));

router.get('/chats/:id/messages', MOD, h((req) => {
  const c = rowChat(int(req.params.id));
  if (!c) err(404, 'گفتگو یافت نشد.');
  const before = req.query.before ? int(req.query.before) : Number.MAX_SAFE_INTEGER;
  const rows = q("SELECT m.*, u.username, u.name FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.chat_id=? AND m.id<? ORDER BY m.id DESC LIMIT 50", c.id, before);
  audit(req, 'chat.read_messages', `${c.id}`, { count: rows.length });
  return { messages: rows.map((m) => ({ ...msgPreview(m), created_at: m.created_at, deleted: !!m.deleted, username: m.username, name: m.name, data: J(m.data, {}) })) };
}));

router.post('/chats/:id/freeze', MOD, h((req) => {
  const c = rowChat(int(req.params.id));
  if (!c) err(404, 'گفتگو یافت نشد.');
  const f = !!body(req).frozen;
  run('UPDATE chats SET frozen=? WHERE id=?', f ? 1 : 0, c.id);
  pushChat(c.id);
  audit(req, f ? 'chat.freeze' : 'chat.unfreeze', `${c.id}:${c.title || c.type}`);
  return { ok: true };
}));
router.delete('/chats/:id', SUPER_RE, h((req) => {
  const c = rowChat(int(req.params.id));
  if (!c) err(404, 'گفتگو یافت نشد.');
  if (c.type === 'saved') err(400, 'این گفتگو قابل حذف نیست.');
  const ids = chatMemberIds(c.id);
  run('DELETE FROM chats WHERE id=?', c.id);
  ids.forEach((uid) => hub.send(uid, 'chat:removed', { chat_id: c.id }));
  audit(req, 'chat.delete', `${c.id}:${c.title || c.type}`);
  return { ok: true };
}));
router.delete('/messages/:id', MOD, h((req) => {
  const m = q1('SELECT * FROM messages WHERE id=?', int(req.params.id));
  if (!m || m.deleted) err(404, 'پیام یافت نشد.');
  run('UPDATE messages SET deleted=1 WHERE id=?', m.id);
  chatMemberIds(m.chat_id).forEach((uid) => hub.send(uid, 'message:delete', { chat_id: m.chat_id, ids: [m.id] }));
  pushChat(m.chat_id);
  audit(req, 'message.delete', `${m.id}`, { chat: m.chat_id, sender: m.sender_id });
  return { ok: true };
}));

/* ------------------------------------------------------------------ reports */
router.get('/reports', V, h((req) => {
  const { p, size, off } = page(req);
  const st = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const total = qv('SELECT COUNT(*) FROM reports WHERE status=?', st);
  const items = q('SELECT r.*, u.username reporter_name FROM reports r LEFT JOIN users u ON u.id=r.reporter WHERE r.status=? ORDER BY r.id DESC LIMIT ? OFFSET ?', st, size, off)
    .map((r) => ({ ...r, snapshot: J(r.snapshot, {}), resolved_by_name: r.resolved_by ? q1('SELECT username FROM admins WHERE id=?', r.resolved_by)?.username : null }));
  return { items, total, page: p, size };
}));
router.post('/reports/:id/resolve', MOD, h((req) => {
  const r = q1('SELECT * FROM reports WHERE id=?', int(req.params.id));
  if (!r) err(404, 'گزارش یافت نشد.');
  if (r.status !== 'open') err(400, 'این گزارش قبلاً بررسی شده است.');
  const b = body(req); const action = str(b.action, 20); const note = str(b.note, 300);
  const snap = J(r.snapshot, {});
  tx(() => {
    if (action === 'delete_message' && r.kind === 'message') {
      const m = q1('SELECT * FROM messages WHERE id=?', r.target_id);
      if (m && !m.deleted) { run('UPDATE messages SET deleted=1 WHERE id=?', m.id); chatMemberIds(m.chat_id).forEach((uid) => hub.send(uid, 'message:delete', { chat_id: m.chat_id, ids: [m.id] })); pushChat(m.chat_id); }
    } else if (action === 'ban_user') {
      const uid = r.kind === 'user' ? r.target_id : r.kind === 'message' ? q1('SELECT sender_id FROM messages WHERE id=?', r.target_id)?.sender_id : null;
      const u = rowUser(uid);
      if (u && u.id !== OFFICIAL_ID && u.id !== BOT_ID) {
        run('UPDATE users SET banned=1, ban_reason=?, banned_at=? WHERE id=?', note || 'گزارش تأییدشده', now(), u.id);
        killAll(u.id, { banned: true });
      }
    } else if (action === 'freeze_chat' && r.chat_id) {
      run('UPDATE chats SET frozen=1 WHERE id=?', r.chat_id); pushChat(r.chat_id);
    } else if (action !== 'dismiss' && action !== 'resolve') err(400, 'اقدام نامعتبر است.');
    run('UPDATE reports SET status=?, resolved_by=?, resolved_at=?, resolution=? WHERE id=?',
      action === 'dismiss' ? 'dismissed' : 'resolved', req.admin.id, now(), `${action}${note ? ': ' + note : ''}`, r.id);
  });
  if (r.reporter) systemMessage(r.reporter, `🛡 گزارش شما (#${faNum(r.id)}) بررسی شد. ${action === 'dismiss' ? 'موردی خلاف قوانین یافت نشد.' : 'اقدام لازم انجام شد. از همراهی شما سپاسگزاریم.'}`);
  audit(req, 'report.' + action, `#${r.id}`, { kind: r.kind, target: r.target_id, note, snap });
  adminHub.broadcast('report:update', { id: r.id });
  return { ok: true };
}));

/* ------------------------------------------------------------------ broadcast */
router.post('/broadcast', SUPER_RE, h((req) => {
  const text = str(body(req).text, 4000).trim();
  if (!text) err(400, 'متن اطلاعیه را بنویسید.');
  const onlyOnline = !!body(req).online_only;
  const ids = q('SELECT id FROM users WHERE is_bot=0 AND deleted=0 AND banned=0 AND pass_hash IS NOT NULL').map((r) => r.id).filter((id) => !onlyOnline || hub.online(id));
  let i = 0;
  const step = () => { const end = Math.min(i + 50, ids.length); for (; i < end; i++) systemMessage(ids[i], text); if (i < ids.length) setImmediate(step); };
  step();
  audit(req, 'broadcast.send', `${ids.length} users`, { len: text.length, online_only: onlyOnline });
  return { ok: true, recipients: ids.length };
}));

/* ------------------------------------------------------------------ security */
router.get('/security', V, h(() => ({
  settings: sec(),
  ip_blocks: q('SELECT b.*, a.username by_name FROM ip_blocks b LEFT JOIN admins a ON a.id=b.created_by ORDER BY created_at DESC'),
  top_failed_ips: q('SELECT ip, COUNT(*) n, MAX(at) last FROM login_attempts WHERE ok=0 AND at>? GROUP BY ip ORDER BY n DESC LIMIT 10', now() - 86400e3),
  encryption: { at_rest: 'AES-256-GCM (TOTP secrets, remembered tokens)', passwords: 'scrypt N=2^15 r=8 p=1', tokens: 'HMAC-SHA256 hashed, 256-bit random' },
})));
router.patch('/security', SUPER_RE, h((req) => {
  let changed;
  try { changed = updateSec(body(req)); } catch (e) { err(400, e.message); }
  audit(req, 'security.update', changed.join(','), Object.fromEntries(changed.map((k) => [k, sec()[k]])));
  return { settings: sec(), changed };
}));
router.post('/security/ip-blocks', SUPER, h((req) => {
  const b = body(req); const ip = str(b.ip, 64).trim();
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) err(400, 'IP نامعتبر است.');
  const hours = Math.min(int(b.hours), 24 * 365);
  ex('INSERT OR REPLACE INTO ip_blocks(ip,reason,created_at,created_by,expires_at) VALUES(?,?,?,?,?)', ip, str(b.reason, 200), now(), req.admin.id, hours ? now() + hours * 3600e3 : null);
  invalidateIps();
  audit(req, 'security.ip_block', ip, { hours, reason: b.reason });
  return { ok: true };
}));
router.delete('/security/ip-blocks/:ip', SUPER, h((req) => {
  run('DELETE FROM ip_blocks WHERE ip=?', str(req.params.ip, 64));
  invalidateIps();
  audit(req, 'security.ip_unblock', req.params.ip);
  return { ok: true };
}));
router.get('/login-attempts', V, h((req) => {
  const { p, size, off } = page(req, 40);
  const where = ['1=1']; const args = [];
  if (['user', 'admin'].includes(req.query.scope)) { where.push('scope=?'); args.push(req.query.scope); }
  if (req.query.ok === '0' || req.query.ok === '1') { where.push('ok=?'); args.push(+req.query.ok); }
  const s = str(req.query.q, 64).trim();
  if (s) { where.push("(username LIKE ? ESCAPE '\\' OR ip=?)"); args.push(likeEsc(s), s); }
  const W = where.join(' AND ');
  return { items: q(`SELECT * FROM login_attempts WHERE ${W} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, size, off), total: qv(`SELECT COUNT(*) FROM login_attempts WHERE ${W}`, ...args), page: p, size };
}));

/* ------------------------------------------------------------------ audit */
router.get('/audit', SUPER, h((req) => {
  const { p, size, off } = page(req, 40);
  const s = str(req.query.q, 64).trim();
  const W = s ? "WHERE action LIKE ? ESCAPE '\\' OR admin_name LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\'" : '';
  const args = s ? [likeEsc(s), likeEsc(s), likeEsc(s)] : [];
  return { items: q(`SELECT * FROM audit_log ${W} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, size, off), total: qv(`SELECT COUNT(*) FROM audit_log ${W}`, ...args), page: p, size };
}));
router.get('/audit/verify', SUPER, h(() => verifyChain()));

/* ------------------------------------------------------------------ admins */
router.get('/admins', SUPER, h(() => q('SELECT * FROM admins ORDER BY id').map(adminJson)));
router.post('/admins', SUPER_RE, h(async (req) => {
  const b = body(req); const username = str(b.username, 32).trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{3,31}$/.test(username)) err(400, 'نام کاربری مدیر باید ۴ تا ۳۲ نویسه انگلیسی باشد.');
  if (!ROLES.includes(b.role)) err(400, 'نقش نامعتبر است.');
  if (q1('SELECT 1 FROM admins WHERE username=?', username)) err(409, 'این نام کاربری وجود دارد.');
  const pw = generatePassword(20);
  const id = ex('INSERT INTO admins(username,pass_hash,role,must_change,created_at,created_by) VALUES(?,?,?,1,?,?)', username, await hashPassword(pw), b.role, now(), req.admin.id);
  audit(req, 'admin.create', username, { role: b.role });
  return { admin: adminJson(q1('SELECT * FROM admins WHERE id=?', id)), password: pw };
}));
function lastSuper(excludeId) { return !qv("SELECT COUNT(*) FROM admins WHERE role='superadmin' AND disabled=0 AND id<>?", excludeId); }
router.patch('/admins/:id', SUPER_RE, h((req) => {
  const a = q1('SELECT * FROM admins WHERE id=?', int(req.params.id));
  if (!a) err(404, 'مدیر یافت نشد.');
  const b = body(req);
  if (a.id === req.admin.id) err(400, 'نقش یا وضعیت حساب خودتان را نمی‌توانید تغییر دهید.');
  if ('role' in b) {
    if (!ROLES.includes(b.role)) err(400, 'نقش نامعتبر است.');
    if (a.role === 'superadmin' && b.role !== 'superadmin' && lastSuper(a.id)) err(400, 'دست‌کم یک مدیر ارشد فعال باید باقی بماند.');
    run('UPDATE admins SET role=? WHERE id=?', b.role, a.id);
  }
  if ('disabled' in b) {
    if (b.disabled && a.role === 'superadmin' && lastSuper(a.id)) err(400, 'دست‌کم یک مدیر ارشد فعال باید باقی بماند.');
    run('UPDATE admins SET disabled=? WHERE id=?', b.disabled ? 1 : 0, a.id);
    if (b.disabled) { for (const s of q('SELECT id FROM admin_sessions WHERE admin_id=?', a.id)) adminHub.killSession(s.id); run('DELETE FROM admin_sessions WHERE admin_id=?', a.id); }
  }
  if (b.unlock) run('UPDATE admins SET locked_until=0, fails=0 WHERE id=?', a.id);
  audit(req, 'admin.update', a.username, b);
  return adminJson(q1('SELECT * FROM admins WHERE id=?', a.id));
}));
router.post('/admins/:id/reset', SUPER_RE, h(async (req) => {
  const a = q1('SELECT * FROM admins WHERE id=?', int(req.params.id));
  if (!a) err(404, 'مدیر یافت نشد.');
  if (a.id === req.admin.id) err(400, 'برای حساب خودتان از «حساب من» استفاده کنید.');
  const pw = generatePassword(20);
  run('UPDATE admins SET pass_hash=?, must_change=1, totp_on=0, totp_enc=NULL, recovery_enc=NULL, locked_until=0, fails=0 WHERE id=?', await hashPassword(pw), a.id);
  for (const s of q('SELECT id FROM admin_sessions WHERE admin_id=?', a.id)) adminHub.killSession(s.id);
  run('DELETE FROM admin_sessions WHERE admin_id=?', a.id);
  audit(req, 'admin.reset', a.username);
  return { ok: true, password: pw };
}));
router.delete('/admins/:id', SUPER_RE, h((req) => {
  const a = q1('SELECT * FROM admins WHERE id=?', int(req.params.id));
  if (!a) err(404, 'مدیر یافت نشد.');
  if (a.id === req.admin.id) err(400, 'حساب خودتان را نمی‌توانید حذف کنید.');
  if (a.role === 'superadmin' && lastSuper(a.id)) err(400, 'دست‌کم یک مدیر ارشد فعال باید باقی بماند.');
  for (const s of q('SELECT id FROM admin_sessions WHERE admin_id=?', a.id)) adminHub.killSession(s.id);
  run('DELETE FROM admins WHERE id=?', a.id);
  audit(req, 'admin.delete', a.username);
  return { ok: true };
}));

/* ------------------------------------------------------------------ analytics */
router.get('/analytics', V, h((req) => {
  const t = now(); const D = 86400e3;
  const days = []; for (let i = 29; i >= 0; i--) days.push(Math.floor((t - i * D) / D) * D);
  // user growth
  const sRows = q('SELECT (created_at/86400000)*86400000 AS b, COUNT(*) n FROM users WHERE created_at>=? AND is_bot=0 AND pass_hash IS NOT NULL GROUP BY b', days[0]);
  const sm = new Map(sRows.map((r) => [r.b, r.n]));
  // message activity by day
  const mRows = q("SELECT (created_at/86400000)*86400000 AS b, COUNT(*) n FROM messages WHERE created_at>=? AND type<>'service' GROUP BY b", days[0]);
  const mm = new Map(mRows.map((r) => [r.b, r.n]));
  // active users by day (users who sent at least 1 message)
  const aRows = q("SELECT (created_at/86400000)*86400000 AS b, COUNT(DISTINCT sender_id) n FROM messages WHERE created_at>=? AND type<>'service' GROUP BY b", days[0]);
  const am = new Map(aRows.map((r) => [r.b, r.n]));
  // top users by message count (30 days)
  const topUsers = q("SELECT m.sender_id, u.username, u.name, COUNT(*) n FROM messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.created_at>=? AND m.type<>'service' AND u.deleted=0 GROUP BY m.sender_id ORDER BY n DESC LIMIT 10", t - 30 * D);
  // top chats by message count (30 days)
  const topChats = q("SELECT m.chat_id, c.title, c.type, COUNT(*) n FROM messages m LEFT JOIN chats c ON c.id=m.chat_id WHERE m.created_at>=? AND m.type<>'service' GROUP BY m.chat_id ORDER BY n DESC LIMIT 10", t - 30 * D);
  // engagement: DAU/MAU ratio
  const mau = qv("SELECT COUNT(DISTINCT sender_id) FROM messages WHERE created_at>=? AND type<>'service'", t - 30 * D);
  const dau = qv("SELECT COUNT(DISTINCT sender_id) FROM messages WHERE created_at>=? AND type<>'service'", t - D);
  // media stats
  const mediaStats = {
    images: qv("SELECT COUNT(*) FROM files WHERE mime LIKE 'image/%' AND done=1"),
    videos: qv("SELECT COUNT(*) FROM files WHERE mime LIKE 'video/%' AND done=1"),
    audio: qv("SELECT COUNT(*) FROM files WHERE mime LIKE 'audio/%' AND done=1"),
    docs: qv("SELECT COUNT(*) FROM files WHERE mime NOT LIKE 'image/%' AND mime NOT LIKE 'video/%' AND mime NOT LIKE 'audio/%' AND done=1"),
    total_bytes: qv('SELECT COALESCE(SUM(size),0) FROM files WHERE done=1'),
  };
  // retention: users active in week 1 vs week 2
  const w1 = qv("SELECT COUNT(DISTINCT sender_id) FROM messages WHERE created_at>=? AND created_at<? AND type<>'service'", t - 14 * D, t - 7 * D);
  const w2 = qv("SELECT COUNT(DISTINCT sender_id) FROM messages WHERE created_at>=? AND type<>'service'", t - 7 * D);
  return {
    growth: days.map((b) => ({ t: b, users: sm.get(b) || 0, messages: mm.get(b) || 0, active: am.get(b) || 0 })),
    topUsers, topChats,
    engagement: { mau, dau, ratio: mau ? Math.round(dau / mau * 100) / 100 : 0, retention: w1 ? Math.round(w2 / w1 * 100) / 100 : 0 },
    media: mediaStats,
    totals: {
      users_30d: qv('SELECT COUNT(*) FROM users WHERE created_at>=? AND is_bot=0 AND pass_hash IS NOT NULL', t - 30 * D),
      messages_30d: qv("SELECT COUNT(*) FROM messages WHERE created_at>=? AND type<>'service'", t - 30 * D),
      chats_30d: qv('SELECT COUNT(*) FROM chats WHERE created_at>=?', t - 30 * D),
      calls_30d: qv('SELECT COUNT(*) FROM calls WHERE started_at>=?', t - 30 * D),
    },
  };
}));

/* ------------------------------------------------------------------ bulk operations */
router.post('/bulk-action', SUPER_RE, h((req) => {
  const b = body(req);
  const action = str(b.action, 30);
  const filter = str(b.filter, 20);
  const search = str(b.search, 64).trim().replace(/^@/, '');
  const t = now();
  const where = ['u.is_bot=0 AND u.deleted=0 AND u.pass_hash IS NOT NULL']; const args = [];
  if (search) { where.push("(u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.reg_ip=?)"); args.push(likeEsc(search), likeEsc(search), search); }
  const filters = { banned: 'u.banned=1', unbanned: 'u.banned=0', premium: `u.premium_until>${t}`, verified: 'u.verified=1', unverified: 'u.verified=0', twofa: 'u.totp_on=1', active: 'u.banned=0', inactive: 'u.last_seen<' + (t - 30 * 86400e3) };
  if (filters[filter]) where.push(filters[filter]);
  const W = where.join(' AND ');
  const ids = q(`SELECT u.id FROM users u WHERE ${W}`, ...args).map((r) => r.id);
  if (!ids.length) return { ok: true, affected: 0 };
  let affected = 0;
  const summary = { action, filter, search, count: ids.length };
  if (action === 'ban') {
    ids.forEach((uid) => { const u = rowUser(uid); if (u && u.id !== OFFICIAL_ID && u.id !== BOT_ID) { run('UPDATE users SET banned=1, ban_reason=?, banned_at=? WHERE id=?', b.reason || 'اقدام دسته‌جمعی', t, uid); killAll(uid, { banned: true }); affected++; } });
  } else if (action === 'unban') {
    ids.forEach((uid) => { run('UPDATE users SET banned=0, ban_reason=NULL, banned_at=NULL WHERE id=?', uid); affected++; });
  } else if (action === 'verify') {
    ids.forEach((uid) => { run('UPDATE users SET verified=1 WHERE id=?', uid); affected++; });
  } else if (action === 'unverify') {
    ids.forEach((uid) => { run('UPDATE users SET verified=0 WHERE id=?', uid); affected++; });
  } else if (action === 'premium') {
    const days = Math.min(int(b.days, 0), 3650);
    ids.forEach((uid) => { const u = rowUser(uid); const until = Math.max(t, u.premium_until || 0) + days * 86400e3; run('UPDATE users SET premium_until=? WHERE id=?', until, uid); affected++; });
  } else if (action === 'message') {
    const text = str(b.text, 4000).trim();
    if (!text) err(400, 'متن پیام را بنویسید.');
    let i = 0; const step = () => { const end = Math.min(i + 50, ids.length); for (; i < end; i++) systemMessage(ids[i], text); if (i < ids.length) setImmediate(step); }; step();
    affected = ids.length;
  } else if (action === 'force_logout') {
    ids.forEach((uid) => { killAll(uid, { admin: true }); affected++; });
  } else err(400, 'اقدام نامعتبر است.');
  ids.forEach((uid) => { presenceChanged(uid); broadcastUser(uid); });
  audit(req, 'bulk.' + action, `${affected} users`, summary);
  return { ok: true, affected };
}));

/* ------------------------------------------------------------------ system settings */
const sysDefaults = { maintenance: false, maintenance_msg: '', registrations: true, guest_read: true, max_upload_mb: 100, message_rate: 30, turn_configured: false };
router.get('/system-settings', V, h(() => {
  const row = q1('SELECT v FROM kv WHERE k=?', 'system_settings');
  const s = row ? J(row.v, sysDefaults) : { ...sysDefaults };
  s.turn_configured = !!(process.env.WEBRTC_TURN_URLS && process.env.WEBRTC_TURN_USER);
  s.turn_urls = process.env.WEBRTC_TURN_URLS || '';
  s.turn_user = process.env.WEBRTC_TURN_USER || '';
  s.force_turn = process.env.WEBRTC_FORCE_TURN === '1' || process.env.WEBRTC_FORCE_TURN === 'true';
  return s;
}));
router.patch('/system-settings', SUPER_RE, h((req) => {
  const b = body(req);
  const row = q1('SELECT v FROM kv WHERE k=?', 'system_settings');
  const s = row ? J(row.v, sysDefaults) : { ...sysDefaults };
  if (typeof b.maintenance === 'boolean') s.maintenance = b.maintenance;
  if (typeof b.maintenance_msg === 'string') s.maintenance_msg = str(b.maintenance_msg, 500).slice(0, 500);
  if (typeof b.registrations === 'boolean') s.registrations = b.registrations;
  if (typeof b.guest_read === 'boolean') s.guest_read = b.guest_read;
  if (typeof b.max_upload_mb === 'number') s.max_upload_mb = Math.min(Math.max(b.max_upload_mb, 1), 500);
  if (typeof b.message_rate === 'number') s.message_rate = Math.min(Math.max(b.message_rate, 5), 120);
  ex('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)', 'system_settings', JSON.stringify(s));
  audit(req, 'system.settings', JSON.stringify(Object.keys(b)), s);
  return { ok: true, settings: s };
}));

/* ------------------------------------------------------------------ media browser */
router.get('/media', V, h((req) => {
  const { p, size, off } = page(req, 30);
  const type = str(req.query.type, 10);
  const where = ['done=1']; const args = [];
  if (type === 'image') { where.push("mime LIKE 'image/%'"); }
  else if (type === 'video') { where.push("mime LIKE 'video/%'"); }
  else if (type === 'audio') { where.push("mime LIKE 'audio/%'"); }
  else if (type === 'doc') { where.push("mime NOT LIKE 'image/%' AND mime NOT LIKE 'video/%' AND mime NOT LIKE 'audio/%'"); }
  const W = where.join(' AND ');
  const total = qv(`SELECT COUNT(*) FROM files WHERE ${W}`, ...args);
  const items = q(`SELECT f.*, u.username owner_name FROM files f LEFT JOIN users u ON u.id=f.owner WHERE ${W} ORDER BY f.id DESC LIMIT ? OFFSET ?`, ...args, size, off)
    .map((f) => ({ id: f.id, mime: f.mime, size: f.size, owner: f.owner, owner_name: f.owner_name, url: fileUrl(f.id), created_at: f.created_at, name: f.name }));
  return { items, total, page: p, size };
}));
router.delete('/media/:id', SUPER, h((req) => {
  const f = q1('SELECT * FROM files WHERE id=?', int(req.params.id));
  if (!f) err(404, 'فایل یافت نشد.');
  try { fs.unlinkSync(f.path); } catch { /* */ }
  run('DELETE FROM files WHERE id=?', f.id);
  audit(req, 'media.delete', `${f.id}`, { mime: f.mime, size: f.size });
  return { ok: true };
}));

/* ------------------------------------------------------------------ global message search */
router.get('/search/messages', MOD, h((req) => {
  const { p, size, off } = page(req, 30);
  const s = str(req.query.q, 200).trim();
  if (!s || s.length < 2) return { items: [], total: 0, page: p, size };
  const pattern = '%' + s.replace(/[\%_]/g, (c) => '\\' + c) + '%';
  const items = q("SELECT m.id, m.chat_id, m.sender_id, m.type, m.text, m.created_at, u.username, u.name sender_name, c.title chat_title, c.type chat_type FROM messages m LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN chats c ON c.id=m.chat_id WHERE m.deleted=0 AND m.type<>'service' AND m.text LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT ? OFFSET ?", pattern, size, off);
  const total = qv("SELECT COUNT(*) FROM messages m WHERE m.deleted=0 AND m.type<>'service' AND m.text LIKE ? ESCAPE '\\'", pattern);
  return { items, total, page: p, size };
}));

// live stats push every 4 s while admins are connected
setInterval(() => { if (adminHub.count()) { try { adminHub.broadcast('stats', stats()); } catch (e) { console.error('admin stats', e); } } }, 4000).unref();
