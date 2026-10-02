import { Router } from 'express';
import crypto from 'node:crypto';
import { q, q1, run, now } from '../db.js';
import { h, body, str, int, auth } from '../lib/http.js';
import { err, hashPassword, verifyPassword, passwordProblem, newTotpSecret, totpOk, encrypt, decrypt } from '../lib/security.js';
import { sec } from '../lib/settings.js';
import { USERNAME_RE, BRAND } from '../config.js';
import { meJson, rowUser, limits, isPremium, privacyOf, broadcastUser, presenceChanged, J } from '../domain.js';
import { systemMessage } from '../system.js';
import { hub } from '../realtime/hub.js';

export const router = Router();

router.get('/me', h((req) => meJson(auth(req))));

router.patch('/me', h((req) => {
  const u = auth(req); const b = body(req); const lim = limits(u);
  const sets = []; const args = [];
  if ('name' in b) {
    const n = str(b.name, 64).replace(/[\u0000-\u001f\u202a-\u202e]/g, '').trim();
    if (!n) err(400, 'نام نمی‌تواند خالی باشد.');
    sets.push('name=?'); args.push(n);
  }
  if ('bio' in b) {
    const bio = str(b.bio, 1000);
    if ([...bio].length > lim.bio) err(400, `بیوگرافی حداکثر ${lim.bio} نویسه است.` + (isPremium(u) ? '' : ' با پریمیوم تا ۳۰۰ نویسه.'));
    sets.push('bio=?'); args.push(bio);
  }
  if ('username' in b) {
    const un = str(b.username, 40).trim().replace(/^@/, '');
    if (!USERNAME_RE.test(un)) err(400, 'نام کاربری نامعتبر است.');
    const other = q1('SELECT id FROM users WHERE username=?', un);
    if ((other && other.id !== u.id) || q1('SELECT 1 FROM chats WHERE username=?', un)) err(409, 'این نام کاربری قبلاً گرفته شده است.');
    sets.push('username=?'); args.push(un);
  }
  if (Array.isArray(b.color) && b.color.length === 2 && b.color.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) {
    sets.push('color=?'); args.push(JSON.stringify(b.color));
  }
  if ('avatar' in b) {
    const fid = b.avatar ? str(b.avatar, 40) : null;
    if (fid) {
      const f = q1('SELECT * FROM files WHERE id=? AND owner=? AND done=1', fid, u.id);
      if (!f || !/^image\/(png|jpe?g|webp|gif)$/.test(f.mime || '')) err(400, 'فایل تصویر نامعتبر است.');
    }
    sets.push('avatar=?'); args.push(fid);
  }
  if ('emoji_status' in b) {
    if (b.emoji_status && !isPremium(u)) err(403, 'وضعیت ایموجی مخصوص کاربران پریمیوم است.');
    sets.push('emoji_status=?'); args.push(b.emoji_status ? str(b.emoji_status, 8) : null);
  }
  if (sets.length) run(`UPDATE users SET ${sets.join(',')} WHERE id=?`, ...args, u.id);
  broadcastUser(u.id);
  return meJson(rowUser(u.id));
}));

router.patch('/me/settings', h((req) => {
  const u = auth(req); const b = body(req);
  const s = { ...(J(u.settings, {}) || {}) };
  for (const [k, v] of Object.entries(b)) if (/^[a-zA-Z_]{1,32}$/.test(k)) s[k] = v;
  if (Array.isArray(s.folders) && s.folders.length > limits(u).folders)
    err(403, `حداکثر ${limits(u).folders} پوشه مجاز است.` + (isPremium(u) ? '' : ' با پریمیوم تا ۱۵ پوشه.'));
  if (['aurora', 'gold'].includes(s.theme) && !isPremium(u)) err(403, 'این تم مخصوص کاربران پریمیوم است.');
  const raw = JSON.stringify(s);
  if (raw.length > 60000) err(400, 'تنظیمات بیش از حد بزرگ است.');
  run('UPDATE users SET settings=? WHERE id=?', raw, u.id);
  hub.send(u.id, 'me:update', meJson(rowUser(u.id)));
  return { settings: s };
}));

router.patch('/me/privacy', h((req) => {
  const u = auth(req); const b = body(req); const p = privacyOf(u);
  for (const k of ['lastSeen', 'photo', 'calls', 'groups', 'forwards']) if (['all', 'contacts', 'none'].includes(b[k])) p[k] = b[k];
  if ('readReceipts' in b) p.readReceipts = !!b.readReceipts;
  run('UPDATE users SET privacy=? WHERE id=?', JSON.stringify(p), u.id);
  broadcastUser(u.id);
  return { privacy: p };
}));

router.post('/me/password', h(async (req) => {
  const u = auth(req); const b = body(req);
  if (!(await verifyPassword(b.old, u.pass_hash))) err(400, 'رمز فعلی اشتباه است.');
  const pp = passwordProblem(b.new, { min: sec().password_min, mix: sec().password_require_mix });
  if (pp) err(400, pp);
  run('UPDATE users SET pass_hash=? WHERE id=?', await hashPassword(b.new), u.id);
  const others = q('SELECT id FROM sessions WHERE user_id=? AND id<>?', u.id, req.sess.id);
  run('DELETE FROM sessions WHERE user_id=? AND id<>?', u.id, req.sess.id);
  others.forEach((o) => hub.killSession(o.id));
  systemMessage(u.id, '🔑 رمز عبور حساب شما تغییر کرد و همه نشست‌های دیگر خاتمه یافتند.');
  return { ok: true, terminated: others.length };
}));

router.delete('/me', h(async (req) => {
  const u = auth(req); const b = body(req);
  if (!(await verifyPassword(b.password, u.pass_hash))) err(400, 'رمز عبور اشتباه است.');
  const sess = q('SELECT id FROM sessions WHERE user_id=?', u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  run("UPDATE users SET deleted=1, username=?, name='حساب حذف‌شده', bio='', avatar=NULL, pass_hash=NULL, totp_on=0, totp_secret=NULL WHERE id=?",
    `deleted_${u.id}_${crypto.randomBytes(3).toString('hex')}`, u.id);
  run('DELETE FROM contacts WHERE owner=? OR contact=?', u.id, u.id);
  run('DELETE FROM stories WHERE user_id=?', u.id);
  sess.forEach((o) => hub.killSession(o.id));
  presenceChanged(u.id);
  return { ok: true };
}));

/* sessions */
router.get('/sessions', h((req) => {
  const u = auth(req);
  const online = hub.onlineSessions();
  return q('SELECT id, device, ip, created_at, last_active FROM sessions WHERE user_id=? ORDER BY last_active DESC', u.id)
    .map((r) => ({ ...r, current: r.id === req.sess.id, online: online.has(r.id) }));
}));
router.delete('/sessions/:sid', h((req) => {
  const u = auth(req); const sid = int(req.params.sid);
  if (sid === req.sess.id) err(400, 'برای خروج از این دستگاه از گزینه خروج استفاده کنید.');
  run('DELETE FROM sessions WHERE id=? AND user_id=?', sid, u.id);
  hub.killSession(sid);
  return { ok: true };
}));
router.delete('/sessions', h((req) => {
  const u = auth(req);
  const rows = q('SELECT id FROM sessions WHERE user_id=? AND id<>?', u.id, req.sess.id);
  run('DELETE FROM sessions WHERE user_id=? AND id<>?', u.id, req.sess.id);
  rows.forEach((r) => hub.killSession(r.id));
  return { ok: true, count: rows.length };
}));

/* 2FA — secrets are AES-256-GCM encrypted at rest, bound to the user id */
router.post('/2fa/setup', h((req) => {
  const u = auth(req);
  const secret = newTotpSecret();
  run('UPDATE users SET totp_pending=? WHERE id=?', encrypt(secret, 'totp:' + u.id), u.id);
  return { secret, uri: `otpauth://totp/${BRAND}:${encodeURIComponent(u.username)}?secret=${secret}&issuer=${BRAND}&digits=6&period=30` };
}));
router.post('/2fa/enable', h((req) => {
  const u = auth(req);
  const pending = decrypt(u.totp_pending, 'totp:' + u.id);
  if (!pending || !totpOk(pending, body(req).code)) err(400, 'کد وارد شده نادرست است. زمان گوشی را بررسی کنید.');
  run('UPDATE users SET totp_secret=totp_pending, totp_pending=NULL, totp_on=1 WHERE id=?', u.id);
  systemMessage(u.id, '🛡 تأیید دو مرحله‌ای برای حساب شما فعال شد.');
  return meJson(rowUser(u.id));
}));
router.post('/2fa/disable', h(async (req) => {
  const u = auth(req);
  if (!(await verifyPassword(body(req).password, u.pass_hash))) err(400, 'رمز عبور اشتباه است.');
  run('UPDATE users SET totp_on=0, totp_secret=NULL WHERE id=?', u.id);
  systemMessage(u.id, '⚠️ تأیید دو مرحله‌ای حساب شما غیرفعال شد.');
  return meJson(rowUser(u.id));
}));

/* premium */
router.post('/premium/trial', h((req) => {
  const u = auth(req);
  if (u.trial_used) err(400, 'دوره آزمایشی پریمیوم قبلاً برای این حساب استفاده شده است.');
  run('UPDATE users SET premium_until=?, trial_used=1 WHERE id=?', Math.max(now(), u.premium_until || 0) + 30 * 86400e3, u.id);
  systemMessage(u.id, '⭐ GuardNet Premium برای ۳۰ روز فعال شد\n\n• آپلود تا ۲۰۰ مگابایت\n• بیوگرافی تا ۳۰۰ نویسه\n• سنجاق ۲۰ گفتگو\n• ۱۵ پوشه\n• وضعیت ایموجی\n• استیکرها و تم‌های ویژه\n• استوری ۴۸ ساعته و حالت مخفی');
  broadcastUser(u.id);
  return meJson(rowUser(u.id));
}));
router.post('/premium/cancel', h((req) => {
  const u = auth(req);
  run('UPDATE users SET premium_until=0, emoji_status=NULL WHERE id=?', u.id);
  const s = J(u.settings, {}) || {};
  if (['aurora', 'gold'].includes(s.theme)) { s.theme = 'dark'; run('UPDATE users SET settings=? WHERE id=?', JSON.stringify(s), u.id); }
  broadcastUser(u.id);
  return meJson(rowUser(u.id));
}));
