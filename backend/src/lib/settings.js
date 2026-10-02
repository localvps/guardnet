import { q, q1, ex, run, now } from '../db.js';
import { SECURITY_DEFAULTS } from '../config.js';

let cache = null;
export function sec() {
  if (!cache) {
    cache = { ...SECURITY_DEFAULTS };
    for (const r of q('SELECT key, value FROM security_settings')) {
      if (r.key in SECURITY_DEFAULTS) {
        try { cache[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt value */ }
      }
    }
  }
  return cache;
}

const RULES = {
  registration_open: (v) => typeof v === 'boolean',
  password_require_mix: (v) => typeof v === 'boolean',
  password_min: (v) => Number.isInteger(v) && v >= 6 && v <= 64,
  user_max_fails: (v) => Number.isInteger(v) && v >= 3 && v <= 50,
  user_lock_minutes: (v) => Number.isInteger(v) && v >= 1 && v <= 1440,
  admin_max_fails: (v) => Number.isInteger(v) && v >= 3 && v <= 20,
  admin_lock_minutes: (v) => Number.isInteger(v) && v >= 5 && v <= 1440,
  admin_idle_minutes: (v) => Number.isInteger(v) && v >= 5 && v <= 120,
  admin_absolute_hours: (v) => Number.isInteger(v) && v >= 1 && v <= 24,
  admin_ip_allowlist: (v) => typeof v === 'string' && v.length <= 2000 &&
    v.split(/[\s,]+/).filter(Boolean).every((ip) => /^[0-9a-fA-F:.]{2,45}(\/\d{1,3})?$/.test(ip)),
  max_sessions_per_user: (v) => Number.isInteger(v) && v >= 1 && v <= 200,
  message_rate_per_min: (v) => Number.isInteger(v) && v >= 5 && v <= 600,
};

/** Validates and persists; returns list of changed keys or throws a message. */
export function updateSec(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in RULES)) continue;
    if (!RULES[k](v)) throw new Error(`مقدار «${k}» نامعتبر است.`);
    if (JSON.stringify(sec()[k]) === JSON.stringify(v)) continue;
    ex('INSERT INTO security_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
    changed.push(k);
  }
  cache = null;
  return changed;
}

/* ------------------------------------------------------------------ IP blocklist */
let ipCache = null;
function loadIps() {
  run('DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at<?', now());
  ipCache = new Map(q('SELECT * FROM ip_blocks').map((r) => [r.ip, r]));
}
export function ipBlocked(ip) {
  if (!ipCache) loadIps();
  const r = ipCache.get(ip);
  if (!r) return null;
  if (r.expires_at && r.expires_at < now()) { loadIps(); return ipBlocked(ip); }
  return r;
}
export const invalidateIps = () => { ipCache = null; };
setInterval(() => { ipCache = null; }, 60e3).unref();

/* ------------------------------------------------------------------ IP allowlist matching (IPv4 CIDR + exact) */
function v4(ip) {
  const p = ip.split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || +x > 255)) return null;
  return p.reduce((a, x) => (a << 8) + +x, 0) >>> 0;
}
export function ipAllowed(ip, list) {
  const rules = String(list || '').split(/[\s,]+/).filter(Boolean);
  if (!rules.length) return true;
  return rules.some((r) => {
    if (!r.includes('/')) return r === ip;
    const [base, bits] = r.split('/');
    const a = v4(base), b = v4(ip), n = +bits;
    if (a == null || b == null || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

export const loginAttempt = (scope, username, ip, ua, ok, reason) =>
  ex('INSERT INTO login_attempts(scope,username,ip,ua,ok,reason,at) VALUES(?,?,?,?,?,?,?)',
    scope, String(username || '').slice(0, 64), ip, String(ua || '').slice(0, 200), ok ? 1 : 0, reason || null, now());

export const recentFails = (scope, field, value, minutes) =>
  q1(`SELECT COUNT(*) n FROM login_attempts WHERE scope=? AND ${field === 'ip' ? 'ip' : 'username'}=? COLLATE NOCASE AND ok=0 AND at>?`,
    scope, value, now() - minutes * 60e3).n;
