import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, TRUST_PROXY } from '../config.js';

/* ------------------------------------------------------------------ errors */
export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const err = (status, message, extra) => { throw new HttpError(status, message, extra); };

/* ------------------------------------------------------------------ master key (AES-256-GCM at rest) */
function loadMasterKey() {
  const env = process.env.GUARDNET_MASTER_KEY;
  if (env) {
    const k = Buffer.from(env, env.length === 64 ? 'hex' : 'base64');
    if (k.length !== 32) throw new Error('GUARDNET_MASTER_KEY must be 32 bytes (hex or base64)');
    return k;
  }
  const f = path.join(DATA_DIR, 'master.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  const k = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64');
  if (k.length !== 32) throw new Error('data/master.key is corrupt');
  return k;
}
const MASTER = loadMasterKey();
const subKey = (label) => crypto.createHmac('sha256', MASTER).update('guardnet:' + label).digest();
const ENC_KEY = subKey('aes-gcm-v1');
const TOKEN_PEPPER = subKey('token-pepper-v1');

/** Authenticated encryption; output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain, aad = '') {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
export function decrypt(blob, aad = '') {
  if (!blob) return null;
  try {
    const [v, iv, tag, ct] = String(blob).split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'base64url'));
    if (aad) d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

/* ------------------------------------------------------------------ tokens */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
/** Tokens are never stored in plaintext: keyed SHA-256 (HMAC with a server pepper). */
export const hashToken = (t) => crypto.createHmac('sha256', TOKEN_PEPPER).update(String(t || '')).digest('hex');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ------------------------------------------------------------------ passwords (scrypt, memory-hard) */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const scryptAsync = (pw, salt, len, opts) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(pw).normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
const DUMMY = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
/** Constant-work verification: runs scrypt even for unknown accounts to avoid user-enumeration timing. */
export async function verifyPassword(pw, stored) {
  const s = stored || DUMMY;
  const [alg, N, r, p, salt, key] = s.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scryptAsync(String(pw ?? '').normalize('NFKC'), Buffer.from(salt, 'base64'), want.length,
    { N: +N, r: +r, p: +p, maxmem: 96 * 1024 * 1024 });
  return !!stored && crypto.timingSafeEqual(got, want);
}

export function passwordProblem(pw, { min = 8, mix = false } = {}) {
  pw = String(pw || '');
  if (pw.length < min) return `رمز عبور باید دست‌کم ${faNum(min)} نویسه باشد.`;
  if (pw.length > 256) return 'رمز عبور بیش از حد طولانی است.';
  if (mix && !(/[A-Za-z\u0600-\u06FF]/.test(pw) && /\d/.test(pw))) return 'رمز عبور باید ترکیبی از حرف و عدد باشد.';
  if (/^(.)\1+$/.test(pw) || ['12345678', 'password', 'qwertyui', '11111111', '87654321'].includes(pw.toLowerCase()))
    return 'این رمز عبور بسیار ساده است.';
  return null;
}
export const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* ------------------------------------------------------------------ TOTP (RFC 6238) */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(crypto.randomBytes(20));
export function totpCode(secret, t = Date.now()) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / 30)));
  const mac = crypto.createHmac('sha1', unbase32(secret)).update(ctr).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
/** returns matched time-step or -1 (±1 step window) */
export function totpStep(secret, code) {
  code = String(code || '').replace(/\D/g, '');
  if (!secret || code.length !== 6) return -1;
  for (const d of [0, -1, 1]) {
    const t = Date.now() + d * 30000;
    if (safeEqual(totpCode(secret, t), code)) return Math.floor(t / 30000);
  }
  return -1;
}
export const totpOk = (secret, code) => totpStep(secret, code) >= 0;

/* ------------------------------------------------------------------ request helpers */
export function clientIp(req) {
  const xf = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = xf || req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}
export function deviceName(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'مرورگر';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}

/* ------------------------------------------------------------------ in-memory sliding-window rate limiter */
const buckets = new Map();
export function rateHit(key, limit, windowMs) {
  const t = Date.now();
  let arr = buckets.get(key);
  if (!arr) { arr = []; buckets.set(key, arr); }
  while (arr.length && t - arr[0] > windowMs) arr.shift();
  if (arr.length >= limit) return false;
  arr.push(t);
  return true;
}
export function rateCount(key, windowMs) {
  const arr = buckets.get(key) || [];
  const t = Date.now();
  return arr.filter((x) => t - x <= windowMs).length;
}
export const rateReset = (key) => buckets.delete(key);
setInterval(() => {
  const t = Date.now();
  for (const [k, arr] of buckets) if (!arr.length || t - arr[arr.length - 1] > 3600e3) buckets.delete(k);
}, 600e3).unref();

/* ------------------------------------------------------------------ security headers */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
}
