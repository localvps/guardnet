import { Router } from 'express';
import crypto from 'node:crypto';
import { q, q1, qv, ex, run, now } from '../db.js';
import { h, body, str, auth } from '../lib/http.js';
import {
  err, hashPassword, verifyPassword, passwordProblem, totpOk, randomToken, hashToken, encrypt, decrypt,
  clientIp, deviceName, rateHit, faNum,
} from '../lib/security.js';
import { sec, loginAttempt } from '../lib/settings.js';
import { USERNAME_RE, DEFAULT_PRIVACY } from '../config.js';
import { meJson, rowUser, getOrCreatePrivate, pickColor } from '../domain.js';
import { systemMessage } from '../system.js';
import { hub, adminHub } from '../realtime/hub.js';

export const router = Router();
const cleanName = (s) => str(s, 64).replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, '').trim();
const cleanUser = (s) => str(s, 40).trim().replace(/^@/, '');

export function newSession(uid, req, remember, visitorOverride, uaOverride, ipOverride) {
  const tok = randomToken(32);
  const visitor = remember ? (visitorOverride ?? req.headers['x-visitor-id'] ?? null) : null;
  if (visitor) run('UPDATE sessions SET remember=0, token_enc=NULL WHERE visitor=?', String(visitor).slice(0, 128));
  const sid = ex('INSERT INTO sessions(token_hash,token_enc,user_id,device,ip,visitor,remember,created_at,last_active) VALUES(?,?,?,?,?,?,?,?,?)',
    hashToken(tok), visitor ? encrypt(tok, 'sess') : null, uid, deviceName(uaOverride ?? req.headers['user-agent'] ?? ''),
    ipOverride ?? clientIp(req), visitor ? String(visitor).slice(0, 128) : null, visitor ? 1 : 0, now(), now());
  // cap concurrent sessions per account (oldest first)
  const max = sec().max_sessions_per_user;
  const extra = q('SELECT id FROM sessions WHERE user_id=? ORDER BY last_active DESC LIMIT -1 OFFSET ?', uid, max);
  for (const r of extra) { run('DELETE FROM sessions WHERE id=?', r.id); hub.killSession(r.id); }
  return { tok, sid };
}

function ipGuard(req, bucket, limit, windowMs) {
  if (!rateHit(`${bucket}:${clientIp(req)}`, limit, windowMs)) err(429, 'درخواست‌های زیادی از این شبکه ارسال شد. کمی بعد دوباره تلاش کنید.');
}

function lockState(username) {
  const s = sec();
  const lastOk = qv("SELECT MAX(at) FROM login_attempts WHERE scope='user' AND username=? COLLATE NOCASE AND ok=1", username) || 0;
  const since = Math.max(lastOk, now() - s.user_lock_minutes * 60e3);
  const fails = q("SELECT at FROM login_attempts WHERE scope='user' AND username=? COLLATE NOCASE AND ok=0 AND at>? ORDER BY at DESC", username, since);
  if (fails.length >= s.user_max_fails) {
    const left = Math.max(1, Math.ceil((fails[s.user_max_fails - 1].at + s.user_lock_minutes * 60e3 - now()) / 60e3));
    return left;
  }
  return 0;
}

router.get('/config', h(() => ({ registration_open: sec().registration_open, password_min: sec().password_min, password_require_mix: sec().password_require_mix })));

/** Step 1 (like entering a phone number): does the account exist? */
router.post('/check', h((req) => {
  ipGuard(req, 'check', 40, 60e3);
  const username = cleanUser(body(req).username);
  if (!USERNAME_RE.test(username)) err(400, 'نام کاربری باید ۵ تا ۳۲ نویسه باشد، با حرف انگلیسی شروع شود و فقط شامل حروف انگلیسی، عدد و _ باشد.');
  const u = q1('SELECT id, is_bot, pass_hash, deleted FROM users WHERE username=?', username);
  const exists = !!(u && !u.deleted && u.pass_hash && !u.is_bot);
  const taken = !!u || !!q1('SELECT 1 FROM chats WHERE username=?', username);
  return { exists, taken, registration_open: sec().registration_open };
}));

router.post('/register', h(async (req) => {
  ipGuard(req, 'register', 6, 3600e3);
  const s = sec();
  if (!s.registration_open) err(403, 'ثبت‌نام حساب جدید در حال حاضر توسط مدیریت بسته شده است.');
  const b = body(req);
  const username = cleanUser(b.username);
  const first = cleanName(b.first_name ?? b.name);
  const last = cleanName(b.last_name || '');
  const name = (first + (last ? ' ' + last : '')).slice(0, 64);
  const pw = String(b.password || '');
  if (!USERNAME_RE.test(username)) err(400, 'نام کاربری باید ۵ تا ۳۲ نویسه باشد، با حرف انگلیسی شروع شود و فقط شامل حروف انگلیسی، عدد و _ باشد.');
  if (!first) err(400, 'نام را وارد کنید.');
  const pp = passwordProblem(pw, { min: s.password_min, mix: s.password_require_mix });
  if (pp) err(400, pp);
  if (pw.toLowerCase().includes(username.toLowerCase())) err(400, 'رمز عبور نباید شامل نام کاربری باشد.');
  if (q1('SELECT 1 FROM users WHERE username=?', username) || q1('SELECT 1 FROM chats WHERE username=?', username))
    err(409, 'این نام کاربری قبلاً گرفته شده است.');
  const hash = await hashPassword(pw);
  let uid;
  try {
    uid = ex('INSERT INTO users(username,name,pass_hash,color,created_at,last_seen,privacy,settings,reg_ip) VALUES(?,?,?,?,?,?,?,?,?)',
      username, name, hash, JSON.stringify(pickColor()), now(), now(), JSON.stringify(DEFAULT_PRIVACY), '{}', clientIp(req));
  } catch { err(409, 'این نام کاربری قبلاً گرفته شده است.'); }
  getOrCreatePrivate(uid, uid);
  const { tok } = newSession(uid, req, b.remember !== false);
  loginAttempt('user', username, clientIp(req), req.headers['user-agent'], true, 'register');
  setTimeout(() => systemMessage(uid, `سلام ${first} 👋\nبه GuardNet خوش آمدید 🛡\n\n• با جستجوی نام کاربری، دوستانتان را پیدا کنید\n• گروه و کانال بسازید\n• از تنظیمات، ظاهر را شخصی کنید\n• برای امنیت بیشتر، تأیید دو مرحله‌ای را فعال کنید\n\nنام کاربری شما: @${username}`), 400);
  adminHub.broadcast('tick', { kind: 'user' });
  return { token: tok, me: meJson(rowUser(uid)) };
}));

router.post('/login', h(async (req) => {
  ipGuard(req, 'login', 30, 600e3);
  const b = body(req);
  const username = cleanUser(b.username);
  const ip = clientIp(req); const ua = req.headers['user-agent'];
  const locked = lockState(username);
  if (locked) err(429, `به دلیل تلاش‌های ناموفق زیاد، ورود به این حساب ${faNum(locked)} دقیقه قفل شد.`);
  const u = q1('SELECT * FROM users WHERE username=? AND deleted=0 AND is_bot=0', username);
  const ok = await verifyPassword(String(b.password || ''), u?.pass_hash);
  if (!u || !ok) {
    loginAttempt('user', username, ip, ua, false, 'password');
    err(401, 'رمز عبور اشتباه است.', { code: 'bad_password' });
  }
  if (u.banned) {
    loginAttempt('user', username, ip, ua, false, 'banned');
    err(403, `این حساب توسط مدیریت مسدود شده است.${u.ban_reason ? ' دلیل: ' + u.ban_reason : ''}`, { code: 'banned' });
  }
  if (u.totp_on) {
    if (!b.totp) return { need_2fa: true };
    if (!totpOk(decrypt(u.totp_secret, 'totp:' + u.id), b.totp)) {
      loginAttempt('user', username, ip, ua, false, 'totp');
      err(401, 'کد تأیید دو مرحله‌ای نادرست است.', { code: 'bad_totp' });
    }
  }
  loginAttempt('user', username, ip, ua, true, 'password');
  const { tok } = newSession(u.id, req, b.remember !== false);
  const dev = deviceName(ua || '');
  setTimeout(() => systemMessage(u.id, `🔐 ورود جدید به حساب شما\nدستگاه: ${dev}\nIP: ${ip}\nزمان (UTC): ${new Date().toISOString().replace('T', ' ').slice(0, 16)}\n\nاگر این شما نبودید، از تنظیمات › دستگاه‌ها نشست را خاتمه دهید و رمز عبور را تغییر دهید.`), 400);
  adminHub.broadcast('tick', { kind: 'login' });
  return { token: tok, me: meJson(u) };
}));

router.get('/resume', h((req) => {
  const v = req.headers['x-visitor-id'];
  if (!v) return { token: null };
  const s = q1('SELECT * FROM sessions WHERE visitor=? AND remember=1 ORDER BY last_active DESC LIMIT 1', String(v).slice(0, 128));
  if (!s) return { token: null };
  const u = rowUser(s.user_id);
  const tok = decrypt(s.token_enc, 'sess');
  if (!u || u.deleted || u.banned || !tok || hashToken(tok) !== s.token_hash) return { token: null };
  return { token: tok, me: meJson(u) };
}));

router.post('/logout', h((req) => {
  auth(req);
  run('DELETE FROM sessions WHERE id=?', req.sess.id);
  hub.killSession(req.sess.id);
  return { ok: true };
}));

/* ------------------------------------------------------------------ QR login (like Telegram) */
const QR_TTL = 60e3;
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode = () => Array.from({ length: 8 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join('');

router.post('/qr', h((req) => {
  ipGuard(req, 'qr', 40, 600e3);
  const tok = randomToken(24);
  let code;
  for (let i = 0; i < 5; i++) { code = shortCode(); if (!q1('SELECT 1 FROM qr_logins WHERE code=?', code)) break; }
  ex('INSERT INTO qr_logins(token_hash,code,ip,ua,visitor,remember,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
    hashToken(tok), code, clientIp(req), str(req.headers['user-agent'], 300), req.headers['x-visitor-id'] || null,
    body(req).remember === false ? 0 : 1, now(), now() + QR_TTL);
  return { token: tok, code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_in: QR_TTL };
}));

router.get('/qr/:token', h((req) => {
  const r = q1('SELECT * FROM qr_logins WHERE token_hash=?', hashToken(req.params.token));
  if (!r) return { status: 'expired' };
  if (r.status === 'approved') {
    const tok = decrypt(r.session_token_enc, 'qr');
    run("UPDATE qr_logins SET status='consumed', session_token_enc=NULL WHERE id=?", r.id);
    const u = rowUser(r.user_id);
    if (!tok || !u) return { status: 'expired' };
    return { status: 'approved', token: tok, me: meJson(u) };
  }
  if (r.status !== 'pending' || r.expires_at < now()) return { status: 'expired' };
  return { status: 'pending' };
}));

/** Called by a signed-in device after scanning the QR (or typing the code). */
router.post('/qr/approve', h((req) => {
  const u = auth(req);
  if (!rateHit(`qrapprove:${u.id}`, 10, 600e3)) err(429, 'تلاش زیاد؛ کمی بعد دوباره امتحان کنید.');
  const b = body(req);
  let r = null;
  if (b.token) r = q1('SELECT * FROM qr_logins WHERE token_hash=?', hashToken(str(b.token, 100)));
  else if (b.code) r = q1('SELECT * FROM qr_logins WHERE code=?', str(b.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (!r || r.status !== 'pending' || r.expires_at < now()) err(404, 'کد QR نامعتبر یا منقضی شده است. کد جدید را اسکن کنید.');
  const { tok } = newSession(u.id, req, !!r.remember, r.visitor, r.ua, r.ip);
  run("UPDATE qr_logins SET status='approved', user_id=?, session_token_enc=? WHERE id=?", u.id, encrypt(tok, 'qr'), r.id);
  loginAttempt('user', u.username, r.ip, r.ua, true, 'qr');
  setTimeout(() => systemMessage(u.id, `🔐 ورود جدید با کد QR\nدستگاه: ${deviceName(r.ua || '')}\nIP: ${r.ip}\n\nاگر این شما نبودید، فوراً از تنظیمات › دستگاه‌ها نشست را خاتمه دهید.`), 300);
  return { ok: true, device: deviceName(r.ua || '') };
}));
