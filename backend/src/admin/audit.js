import crypto from 'node:crypto';
import { q, q1, ex, now } from '../db.js';
import { adminHub } from '../realtime/hub.js';

const digest = (prev, e) => crypto.createHash('sha256')
  .update([prev, e.admin_id, e.admin_name, e.action, e.target, e.detail, e.ip, e.at].map((x) => String(x ?? '')).join('\u241f'))
  .digest('hex');

/** Append-only, hash-chained audit log (tamper-evident). */
export function audit(req, action, target = '', detail = null) {
  const prev = q1('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')?.hash || 'GENESIS';
  const e = {
    admin_id: req?.admin?.id ?? null, admin_name: req?.admin?.username ?? req?.auditName ?? 'system',
    action, target: String(target ?? ''), detail: detail == null ? null : JSON.stringify(detail).slice(0, 4000),
    ip: req ? (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '') : '', at: now(),
  };
  const hash = digest(prev, e);
  const id = ex('INSERT INTO audit_log(admin_id,admin_name,action,target,detail,ip,at,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)',
    e.admin_id, e.admin_name, e.action, e.target, e.detail, e.ip, e.at, prev, hash);
  adminHub.broadcast('audit', { id, ...e });
  return id;
}

export function verifyChain() {
  let prev = 'GENESIS'; let n = 0;
  for (const r of q('SELECT * FROM audit_log ORDER BY id')) {
    if (r.prev_hash !== prev || digest(prev, r) !== r.hash) return { ok: false, broken_at: r.id, checked: n };
    prev = r.hash; n++;
  }
  return { ok: true, checked: n };
}
