import { q1, run, now } from '../db.js';
import { err, hashToken, HttpError, clientIp } from './security.js';

/** Wraps an async handler: return value → JSON; thrown HttpError → {error}. */
export const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out === undefined ? { ok: true } : out);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    else if (e?.type === 'entity.parse.failed') res.status(400).json({ error: 'بدنه درخواست نامعتبر است.' });
    else { console.error(e); res.status(500).json({ error: 'خطای داخلی سرور. دوباره تلاش کنید.' }); }
  }
};

export const int = (v, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n < 2 ** 53 ? n : def;
};
export const str = (v, max = 1000) => (v == null ? '' : String(v)).slice(0, max);
export const body = (req) => (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {});

export function bearer(req) {
  const a = String(req.headers.authorization || '');
  return a.startsWith('Bearer ') ? a.slice(7).trim() : '';
}

/** Authenticates a messenger user session; attaches req.user / req.sess. */
export function auth(req) {
  if (req.user) return req.user;
  const tok = bearer(req);
  const s = tok ? q1('SELECT * FROM sessions WHERE token_hash=?', hashToken(tok)) : null;
  if (!s) err(401, 'نشست نامعتبر است؛ دوباره وارد شوید.', { code: 'unauthorized' });
  const u = q1('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || u.deleted) err(401, 'حساب یافت نشد.', { code: 'unauthorized' });
  if (u.banned) {
    run('DELETE FROM sessions WHERE user_id=?', u.id);
    err(403, `حساب شما مسدود شده است.${u.ban_reason ? ' دلیل: ' + u.ban_reason : ''}`, { code: 'banned' });
  }
  if (now() - (s.last_active || 0) > 60e3) run('UPDATE sessions SET last_active=?, ip=? WHERE id=?', now(), clientIp(req), s.id);
  req.user = u; req.sess = s;
  return u;
}
