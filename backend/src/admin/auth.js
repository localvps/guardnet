import { Router } from 'express';
import crypto from 'node:crypto';
import { q, q1, run, now } from '../db.js';
import { h, body, str, int } from '../lib/http.js';
import {
  err, hashPassword, verifyPassword, newTotpSecret, totpStep, encrypt, decrypt, clientIp, rateHit, hashToken, deviceName,
} from '../lib/security.js';
import { sec, ipAllowed, ipBlocked, loginAttempt } from '../lib/settings.js';
import { BRAND } from '../config.js';
import {
  requireAdmin, createAdminSession, promote, adminLockMsg, adminFail, adminPasswordProblem, listAdminSessions, ROLE_FA, REAUTH_TTL,
} from './session.js';
import { audit } from './audit.js';
import { adminHub } from '../realtime/hub.js';

export const router = Router();
const lastStep = new Map(); // admin id -> last accepted TOTP step (replay protection)

function checkTotp(a, code) {
  const secret = decrypt(a.totp_enc, 'admin-totp:' + a.id);
  const step = totpStep(secret, code);
  if (step < 0 || step <= (lastStep.get(a.id) ?? -1)) return false;
  lastStep.set(a.id, step);
  return true;
}
async function checkRecovery(a, code) {
  const list = JSON.parse(decrypt(a.recovery_enc, 'admin-rec:' + a.id) || '[]');
  const hsh = hashToken('rec:' + String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const i = list.indexOf(hsh);
  if (i < 0) return false;
  list.splice(i, 1);
  run('UPDATE admins SET recovery_enc=? WHERE id=?', encrypt(JSON.stringify(list), 'admin-rec:' + a.id), a.id);
  return true;
}
function newRecoveryCodes(a) {
  const codes = Array.from({ length: 10 }, () => {
    const s = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  });
  const hashes = codes.map((c) => hashToken('rec:' + c.replace(/-/g, '')));
  run('UPDATE admins SET recovery_enc=? WHERE id=?', encrypt(JSON.stringify(hashes), 'admin-rec:' + a.id), a.id);
  return codes;
}
export const adminJson = (a) => ({
  id: a.id, username: a.username, role: a.role, role_fa: ROLE_FA[a.role], totp_on: !!a.totp_on, must_change: !!a.must_change,
  disabled: !!a.disabled, created_at: a.created_at, last_login: a.last_login, last_ip: a.last_ip, pw_changed_at: a.pw_changed_at,
  locked: a.locked_until > now(),
});
const nextStage = (a) => (a.must_change ? 'password' : !a.totp_on ? 'enroll' : 'full');

router.post('/login', h(async (req) => {
  const ip = clientIp(req); const ua = req.headers['user-agent'];
  if (ipBlocked(ip)) err(403, 'دسترسی از این IP مسدود است.');
  if (!ipAllowed(ip, sec().admin_ip_allowlist)) {
    loginAttempt('admin', body(req).username, ip, ua, false, 'ip_denied');
    err(403, 'IP شما در فهرست مجاز پنل مدیریت نیست.');
  }
  if (!rateHit(`alogin:${ip}`, 10, 900e3)) err(429, 'تلاش‌های ورود زیاد بود. ۱۵ دقیقه بعد دوباره امتحان کنید.');
  const b = body(req); const username = str(b.username, 64).trim();
  const a = q1('SELECT * FROM admins WHERE username=?', username);
  const lock = adminLockMsg(a);
  if (lock) { loginAttempt('admin', username, ip, ua, false, 'locked'); err(423, lock); }
  const ok = await verifyPassword(String(b.password || ''), a?.pass_hash);
  if (!a || !ok || a.disabled) {
    adminFail(a);
    loginAttempt('admin', username, ip, ua, false, a?.disabled ? 'disabled' : 'password');
    adminHub.broadcast('security', { kind: 'admin_login_failed', username, ip });
    err(401, 'نام کاربری یا رمز عبور نادرست است.');
  }
  run('UPDATE admins SET fails=0 WHERE id=?', a.id);
  const stage = a.totp_on ? 'totp' : nextStage(a);
  const { tok } = createAdminSession(a, stage, req);
  loginAttempt('admin', username, ip, ua, true, 'password');
  if (stage === 'full') { run('UPDATE admins SET last_login=?, last_ip=? WHERE id=?', now(), ip, a.id); }
  req.admin = a; audit(req, 'auth.password_ok', a.username, { stage, device: deviceName(ua) });
  return { token: tok, stage, admin: adminJson(a) };
}));

router.post('/totp', requireAdmin({ stage: 'totp' }), h(async (req) => {
  const a = req.admin; const b = body(req); const ip = clientIp(req);
  if (!rateHit(`atotp:${a.id}`, 6, 300e3)) err(429, 'تلاش زیاد؛ ۵ دقیقه بعد دوباره امتحان کنید.');
  const ok = b.recovery ? await checkRecovery(a, b.recovery) : checkTotp(a, b.code);
  if (!ok) {
    adminFail(a); loginAttempt('admin', a.username, ip, req.headers['user-agent'], false, 'totp');
    err(401, b.recovery ? 'کد بازیابی نامعتبر است.' : 'کد تأیید نادرست است یا قبلاً استفاده شده است.');
  }
  run('UPDATE admins SET fails=0, last_login=?, last_ip=? WHERE id=?', now(), ip, a.id);
  const stage = nextStage(a);
  promote(req.asess.id, stage);
  loginAttempt('admin', a.username, ip, req.headers['user-agent'], true, b.recovery ? 'recovery' : 'totp');
  audit(req, b.recovery ? 'auth.recovery_code_used' : 'auth.login', a.username);
  return { stage, admin: adminJson(q1('SELECT * FROM admins WHERE id=?', a.id)) };
}));

router.post('/password', requireAdmin({ stage: ['password', 'full'] }), h(async (req) => {
  const a = req.admin; const b = body(req);
  if (!rateHit(`apw:${a.id}`, 8, 600e3)) err(429, 'تلاش زیاد؛ کمی بعد دوباره امتحان کنید.');
  if (req.asess.stage === 'full' && !(await verifyPassword(b.old, a.pass_hash))) err(400, 'رمز فعلی اشتباه است.');
  const pp = adminPasswordProblem(b.new, a.username);
  if (pp) err(400, pp);
  if (await verifyPassword(b.new, a.pass_hash)) err(400, 'رمز جدید باید با رمز فعلی متفاوت باشد.');
  run('UPDATE admins SET pass_hash=?, must_change=0, pw_changed_at=? WHERE id=?', await hashPassword(b.new), now(), a.id);
  // terminate all other admin sessions of this account
  for (const s of q('SELECT id FROM admin_sessions WHERE admin_id=? AND id<>?', a.id, req.asess.id)) adminHub.killSession(s.id);
  run('DELETE FROM admin_sessions WHERE admin_id=? AND id<>?', a.id, req.asess.id);
  const fresh = q1('SELECT * FROM admins WHERE id=?', a.id);
  const stage = req.asess.stage === 'full' ? 'full' : nextStage(fresh);
  promote(req.asess.id, stage);
  audit(req, 'auth.password_changed', a.username);
  return { stage, admin: adminJson(fresh) };
}));

router.post('/enroll/start', requireAdmin({ stage: 'enroll' }), h((req) => {
  const a = req.admin; const secret = newTotpSecret();
  run('UPDATE admins SET totp_pending_enc=? WHERE id=?', encrypt(secret, 'admin-totp:' + a.id), a.id);
  return { secret, uri: `otpauth://totp/${BRAND}%20Admin:${encodeURIComponent(a.username)}?secret=${secret}&issuer=${BRAND}%20Admin&digits=6&period=30` };
}));
router.post('/enroll/finish', requireAdmin({ stage: 'enroll' }), h((req) => {
  const a = req.admin;
  const secret = decrypt(a.totp_pending_enc, 'admin-totp:' + a.id);
  const step = totpStep(secret, body(req).code);
  if (!secret || step < 0) err(400, 'کد نادرست است. ساعت دستگاه را بررسی کنید.');
  lastStep.set(a.id, step);
  run('UPDATE admins SET totp_enc=?, totp_pending_enc=NULL, totp_on=1 WHERE id=?', encrypt(secret, 'admin-totp:' + a.id), a.id);
  const codes = newRecoveryCodes(a);
  run('UPDATE admins SET last_login=?, last_ip=? WHERE id=?', now(), clientIp(req), a.id);
  promote(req.asess.id, 'full');
  audit(req, 'auth.totp_enrolled', a.username);
  return { stage: 'full', recovery_codes: codes, admin: adminJson(q1('SELECT * FROM admins WHERE id=?', a.id)) };
}));

router.get('/me', requireAdmin({ stage: ['totp', 'password', 'enroll', 'full'] }), h((req) => ({
  admin: adminJson(req.admin), stage: req.asess.stage,
  session: { id: req.asess.id, created_at: req.asess.created_at, expires_at: req.asess.expires_at, idle_minutes: sec().admin_idle_minutes,
    reauth_valid_until: (req.asess.reauth_at || 0) + REAUTH_TTL },
})));

router.post('/logout', requireAdmin({ stage: ['totp', 'password', 'enroll', 'full'] }), h((req) => {
  run('DELETE FROM admin_sessions WHERE id=?', req.asess.id);
  adminHub.killSession(req.asess.id);
  audit(req, 'auth.logout', req.admin.username);
  return { ok: true };
}));

/** Step-up authentication for dangerous actions: password + TOTP. */
router.post('/reauth', requireAdmin(), h(async (req) => {
  const a = req.admin; const b = body(req);
  if (!rateHit(`areauth:${a.id}`, 6, 300e3)) err(429, 'تلاش زیاد؛ کمی بعد دوباره امتحان کنید.');
  const okPw = await verifyPassword(b.password, a.pass_hash);
  const okCode = okPw && checkTotp(a, b.code);
  if (!okPw || !okCode) {
    adminFail(a); audit(req, 'auth.reauth_failed', a.username);
    err(401, 'رمز یا کد تأیید نادرست است.');
  }
  run('UPDATE admin_sessions SET reauth_at=? WHERE id=?', now(), req.asess.id);
  audit(req, 'auth.reauth', a.username);
  return { ok: true, valid_until: now() + REAUTH_TTL };
}));

router.post('/recovery/regenerate', requireAdmin({ reauth: true }), h((req) => {
  const codes = newRecoveryCodes(req.admin);
  audit(req, 'auth.recovery_regenerated', req.admin.username);
  return { recovery_codes: codes };
}));

router.get('/sessions', requireAdmin(), h((req) => listAdminSessions(req.admin.id).map((s) => ({ ...s, current: s.id === req.asess.id }))));
router.delete('/sessions/:id', requireAdmin(), h((req) => {
  const id = int(req.params.id);
  run('DELETE FROM admin_sessions WHERE id=? AND admin_id=?', id, req.admin.id);
  adminHub.killSession(id);
  audit(req, 'auth.session_revoked', String(id));
  return { ok: true };
}));
