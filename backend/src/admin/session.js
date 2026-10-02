import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { q, q1, ex, run, now } from '../db.js';
import { hashToken, randomToken, hashPassword, clientIp, err, faNum, deviceName } from '../lib/security.js';
import { sec, ipAllowed, ipBlocked } from '../lib/settings.js';
import { DATA_DIR } from '../config.js';
import { bearer } from '../lib/http.js';

export const ROLES = ['viewer', 'moderator', 'superadmin'];
export const ROLE_FA = { viewer: 'ناظر (فقط خواندنی)', moderator: 'ناظر محتوا', superadmin: 'مدیر ارشد' };
const RANK = { viewer: 1, moderator: 2, superadmin: 3 };
export const PRE_STAGE_TTL = 10 * 60e3;
export const REAUTH_TTL = 5 * 60e3;
const uaHash = (ua) => crypto.createHash('sha256').update(String(ua || '')).digest('hex').slice(0, 32);

export function adminPasswordProblem(pw, username = '') {
  pw = String(pw || '');
  if (pw.length < 12) return 'رمز مدیر باید دست‌کم ۱۲ نویسه باشد.';
  if (pw.length > 256) return 'رمز بیش از حد طولانی است.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw))
    return 'رمز مدیر باید شامل حرف کوچک، حرف بزرگ، عدد و نماد باشد.';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'رمز نباید شامل نام کاربری باشد.';
  return null;
}
/** Strong random password that satisfies the policy. */
export function generatePassword(len = 20) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < len) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

export function createAdminSession(admin, stage, req) {
  const tok = randomToken(32);
  const t = now();
  const exp = stage === 'full' ? t + sec().admin_absolute_hours * 3600e3 : t + PRE_STAGE_TTL;
  const id = ex('INSERT INTO admin_sessions(token_hash,admin_id,stage,ip,ua,created_at,last_active,expires_at,reauth_at) VALUES(?,?,?,?,?,?,?,?,?)',
    hashToken(tok), admin.id, stage, clientIp(req), uaHash(req.headers['user-agent']), t, t, exp, stage === 'full' ? t : 0);
  return { tok, id };
}
export function promote(sessId, stage) {
  const t = now();
  const exp = stage === 'full' ? t + sec().admin_absolute_hours * 3600e3 : t + PRE_STAGE_TTL;
  run('UPDATE admin_sessions SET stage=?, expires_at=?, last_active=?, reauth_at=? WHERE id=?', stage, exp, t, stage === 'full' ? t : 0, sessId);
}

/** Validates an admin token (idle/absolute timeout, UA binding, allowlist). Returns {admin, sess} or null. */
export function adminFromToken(tok, ip, ua, { touch = true } = {}) {
  if (!tok) return null;
  const s = q1('SELECT * FROM admin_sessions WHERE token_hash=?', hashToken(tok));
  if (!s) return null;
  const t = now(); const cfg = sec();
  const idle = s.stage === 'full' ? cfg.admin_idle_minutes * 60e3 : PRE_STAGE_TTL;
  if (s.expires_at < t || t - s.last_active > idle || s.ua !== uaHash(ua)) {
    run('DELETE FROM admin_sessions WHERE id=?', s.id);
    return null;
  }
  if (!ipAllowed(ip, cfg.admin_ip_allowlist)) return null;
  const a = q1('SELECT * FROM admins WHERE id=?', s.admin_id);
  if (!a || a.disabled) { run('DELETE FROM admin_sessions WHERE id=?', s.id); return null; }
  if (touch) run('UPDATE admin_sessions SET last_active=?, ip=? WHERE id=?', t, ip, s.id);
  return { admin: a, sess: s };
}

/** Express middleware factory: requires a session at a given stage (default full) and minimum role. */
export function requireAdmin({ stage = 'full', role = 'viewer', reauth = false } = {}) {
  return (req, res, next) => {
    const ip = clientIp(req);
    if (ipBlocked(ip)) return res.status(403).json({ error: 'دسترسی از این IP مسدود است.' });
    if (!ipAllowed(ip, sec().admin_ip_allowlist)) return res.status(403).json({ error: 'IP شما در فهرست مجاز پنل مدیریت نیست.', code: 'ip_denied' });
    const a = adminFromToken(bearer(req), ip, req.headers['user-agent']);
    if (!a) return res.status(401).json({ error: 'نشست مدیریت منقضی شده است؛ دوباره وارد شوید.', code: 'unauthorized' });
    const stages = Array.isArray(stage) ? stage : [stage];
    if (!stages.includes(a.sess.stage)) return res.status(403).json({ error: 'ابتدا مراحل ورود را کامل کنید.', code: 'stage', stage: a.sess.stage });
    if (RANK[a.admin.role] < RANK[role]) return res.status(403).json({ error: 'نقش شما اجازه این کار را ندارد.', code: 'forbidden' });
    if (reauth && now() - (a.sess.reauth_at || 0) > REAUTH_TTL)
      return res.status(428).json({ error: 'برای این عملیات حساس، هویت خود را دوباره تأیید کنید.', code: 'reauth' });
    req.admin = a.admin; req.asess = a.sess;
    next();
  };
}

/** Account lockout on the admin row itself + per-IP counter. */
export function adminLockMsg(a) {
  if (a && a.locked_until > now()) {
    const m = Math.ceil((a.locked_until - now()) / 60e3);
    return `این حساب مدیریتی به دلیل تلاش‌های ناموفق تا ${faNum(m)} دقیقه دیگر قفل است.`;
  }
  return null;
}
export function adminFail(a) {
  if (!a) return;
  const fails = (a.fails || 0) + 1; const cfg = sec();
  if (fails >= cfg.admin_max_fails) run('UPDATE admins SET fails=0, locked_until=? WHERE id=?', now() + cfg.admin_lock_minutes * 60e3, a.id);
  else run('UPDATE admins SET fails=? WHERE id=?', fails, a.id);
}

/* ------------------------------------------------------------------ bootstrap first superadmin */
export async function bootstrapAdmin() {
  if (q1('SELECT 1 FROM admins LIMIT 1')) return null;
  const username = 'superadmin';
  const password = generatePassword(20);
  ex("INSERT INTO admins(username,pass_hash,role,must_change,created_at) VALUES(?,?,'superadmin',1,?)", username, await hashPassword(password), now());
  const f = path.join(DATA_DIR, 'INITIAL_ADMIN.txt');
  fs.writeFileSync(f, `GuardNet admin panel — initial superadmin (one-time)\nusername: ${username}\npassword: ${password}\n\nYou must change this password and enroll TOTP on first login. Delete this file afterwards.\n`, { mode: 0o600 });
  console.log(`\n[GuardNet] Initial admin created → username: ${username}  password: ${password}\n           (also saved to ${f}; change on first login)\n`);
  return { username, password };
}
export const listAdminSessions = (adminId) => q('SELECT id, stage, ip, ua, created_at, last_active, expires_at FROM admin_sessions WHERE admin_id=? ORDER BY last_active DESC', adminId)
  .map(({ ua, ...s }) => ({ ...s, device: deviceName(ua) }));
