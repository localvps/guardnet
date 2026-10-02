import { Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, q1, ex, run, now } from '../db.js';
import { h, body, str, int, auth } from '../lib/http.js';
import { err, faNum } from '../lib/security.js';
import { UPLOADS, CHUNK, MB } from '../config.js';
import { J, userJson, rowUser, limits, isPremium, blocked, fileUrl } from '../domain.js';
import { hub } from '../realtime/hub.js';

/* ------------------------------------------------------------------ chunked uploads */
export const files = Router();
const MIME_OK = /^(image\/(png|jpe?g|webp|gif|avif|heic|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/[a-z0-9.+-]+|application\/[a-z0-9.+-]+|text\/(plain|csv|markdown)|font\/[a-z0-9]+)$/i;
const fpath = (fid) => path.join(UPLOADS, fid);

files.post('/', h((req) => {
  const u = auth(req); const b = body(req);
  const size = int(b.size); const lim = limits(u).upload;
  if (size <= 0) err(400, 'فایل خالی است.');
  if (size > lim) err(403, `حداکثر حجم فایل ${faNum(lim / MB)} مگابایت است.` + (isPremium(u) ? '' : ' با پریمیوم تا ۲۰۰ مگابایت.'));
  const pending = q1('SELECT COUNT(*) n FROM files WHERE owner=? AND done=0 AND created_at>?', u.id, now() - 3600e3).n;
  if (pending > 30) err(429, 'بارگذاری‌های نیمه‌تمام زیادی دارید.');
  const fid = crypto.randomBytes(16).toString('hex');
  const name = path.basename(str(b.name || 'file', 180)).replace(/[\u0000-\u001f"\\/<>]/g, '_') || 'file';
  let mime = str(b.mime, 100).toLowerCase();
  if (!MIME_OK.test(mime)) mime = 'application/octet-stream';
  ex('INSERT INTO files(id,owner,name,mime,size,created_at) VALUES(?,?,?,?,?,?)', fid, u.id, name, mime, size, now());
  fs.writeFileSync(fpath(fid), '', { mode: 0o600 });
  return { id: fid, chunk: CHUNK };
}));

files.put('/:fid', express.raw({ type: () => true, limit: CHUNK + 1024 }), h((req) => {
  const u = auth(req); const fid = str(req.params.fid, 40);
  if (!/^[0-9a-f]{32}$/.test(fid)) err(404, 'بارگذاری یافت نشد.');
  const f = q1('SELECT * FROM files WHERE id=? AND owner=?', fid, u.id);
  if (!f || f.done) err(404, 'بارگذاری یافت نشد.');
  const offset = int(req.query.offset, -1);
  if (offset !== f.received) err(409, `offset:${f.received}`, { received: f.received });
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!data.length) err(400, 'داده‌ای دریافت نشد.');
  if (f.received + data.length > f.size) err(400, 'حجم داده بیش از اندازه اعلام‌شده است.');
  fs.appendFileSync(fpath(fid), data);
  run('UPDATE files SET received=received+? WHERE id=?', data.length, fid);
  return { received: f.received + data.length };
}));

/** Very small magic-byte sniff so a mislabelled upload can't be served inline as a different type. */
function sniff(fid, declared) {
  const fd = fs.openSync(fpath(fid), 'r'); const b = Buffer.alloc(16);
  fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd);
  const hex = b.toString('hex');
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (declared.startsWith('image/')) {
    if (b.slice(4, 8).toString() === 'ftyp') return declared; // heic/avif
    return 'application/octet-stream';
  }
  return declared;
}

files.post('/:fid/done', h((req) => {
  const u = auth(req); const fid = str(req.params.fid, 40);
  const f = q1('SELECT * FROM files WHERE id=? AND owner=?', fid, u.id);
  if (!f) err(404, 'بارگذاری یافت نشد.');
  if (f.received !== f.size) err(400, 'بارگذاری کامل نشده است.');
  const mime = sniff(fid, f.mime);
  run('UPDATE files SET done=1, mime=? WHERE id=?', mime, fid);
  return { id: fid, url: fileUrl(fid), name: f.name, size: f.size, mime };
}));

/** Public (capability URL: 128-bit random id). Served with a locked-down CSP. */
export function serveFile(req, res) {
  const fid = String(req.params.fid || '');
  if (!/^[0-9a-f]{32}$/.test(fid)) return res.status(404).json({ error: 'یافت نشد' });
  const f = q1('SELECT * FROM files WHERE id=? AND done=1', fid);
  if (!f || !fs.existsSync(fpath(fid))) return res.status(404).json({ error: 'یافت نشد' });
  const top = (f.mime || '').split('/')[0];
  const inline = ['image', 'video', 'audio'].includes(top) && f.mime !== 'image/svg+xml';
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.type(inline ? f.mime : 'application/octet-stream');
  res.sendFile(fpath(fid), { acceptRanges: true, dotfiles: 'deny' });
}

/* ------------------------------------------------------------------ stories */
export const stories = Router();
function audience(author) {
  const aud = new Set(q('SELECT owner FROM contacts WHERE contact=?', author).map((r) => r.owner));
  for (const r of q(`SELECT b.user_id FROM members a JOIN chats c ON c.id=a.chat_id AND c.type='private'
      JOIN members b ON b.chat_id=c.id AND b.user_id<>a.user_id WHERE a.user_id=?`, author)) aud.add(r.user_id);
  return new Set([...aud].filter((x) => !blocked(author, x)));
}
function storyJson(s, viewer) {
  const d = { id: s.id, user_id: s.user_id, kind: s.kind, data: J(s.data, {}), created_at: s.created_at, expires_at: s.expires_at,
    seen: !!q1('SELECT 1 FROM story_views WHERE story_id=? AND user_id=?', s.id, viewer) };
  if (s.user_id === viewer) d.views = q1('SELECT COUNT(*) n FROM story_views WHERE story_id=?', s.id).n;
  return d;
}
stories.get('/', h((req) => {
  const u = auth(req); const groups = new Map(); const audCache = new Map();
  for (const s of q('SELECT * FROM stories WHERE expires_at>? ORDER BY created_at', now())) {
    if (!audCache.has(s.user_id)) audCache.set(s.user_id, audience(s.user_id));
    if (s.user_id === u.id || audCache.get(s.user_id).has(u.id)) {
      if (!groups.has(s.user_id)) groups.set(s.user_id, []);
      groups.get(s.user_id).push(storyJson(s, u.id));
    }
  }
  return { groups: [...groups].map(([k, v]) => ({ user: userJson(rowUser(k), u.id), items: v })).filter((g) => g.user && !g.user.deleted) };
}));
stories.post('/', h((req) => {
  const u = auth(req); const b = body(req); const kind = str(b.kind || 'text', 10);
  const data = b.data && typeof b.data === 'object' ? b.data : {};
  if (q1('SELECT COUNT(*) n FROM stories WHERE user_id=? AND expires_at>?', u.id, now()).n >= 50) err(429, 'حداکثر ۵۰ استوری فعال مجاز است.');
  let clean;
  if (kind === 'text') {
    const bg = Array.isArray(data.bg) ? data.bg : ['#4f8cff', '#8b5cf6'];
    clean = { t: str(data.t, 200), e: str(data.e, 8), bg: bg.slice(0, 2).map((x) => (/^#[0-9a-fA-F]{3,8}$/.test(x) ? x : '#4f8cff')) };
    if (!clean.t && !clean.e) err(400, 'استوری خالی است.');
  } else if (kind === 'image' || kind === 'video') {
    const f = q1('SELECT * FROM files WHERE id=? AND owner=? AND done=1', str(data.file, 40), u.id);
    if (!f || !f.mime.startsWith(kind + '/')) err(400, 'فایل یافت نشد.');
    clean = { url: fileUrl(f.id), cap: str(data.cap, 200) };
  } else err(400, 'نوع استوری نامعتبر است.');
  const sid = ex('INSERT INTO stories(user_id,kind,data,created_at,expires_at) VALUES(?,?,?,?,?)', u.id, kind, JSON.stringify(clean), now(), now() + limits(u).story_hours * 3600e3);
  for (const uid of [...audience(u.id), u.id]) hub.send(uid, 'story:new', { user_id: u.id });
  return storyJson(q1('SELECT * FROM stories WHERE id=?', sid), u.id);
}));
stories.post('/:sid/view', h((req) => {
  const u = auth(req); const sid = int(req.params.sid);
  const s = q1('SELECT * FROM stories WHERE id=?', sid);
  if (!s) err(404, 'استوری یافت نشد.');
  if (s.user_id !== u.id && !audience(s.user_id).has(u.id)) err(403, 'دسترسی ندارید.');
  const b = body(req); const st = J(u.settings, {}) || {};
  if (st.stealth && isPremium(u) && !b.reaction) return { ok: true, stealth: true };
  if (s.user_id !== u.id) {
    ex('INSERT OR IGNORE INTO story_views(story_id,user_id,at) VALUES(?,?,?)', sid, u.id, now());
    if (b.reaction) run('UPDATE story_views SET reaction=? WHERE story_id=? AND user_id=?', str(b.reaction, 8), sid, u.id);
    hub.send(s.user_id, 'story:viewed', { story_id: sid });
  }
  return { ok: true };
}));
stories.get('/:sid/views', h((req) => {
  const u = auth(req); const sid = int(req.params.sid);
  if (!q1('SELECT 1 FROM stories WHERE id=? AND user_id=?', sid, u.id)) err(404, 'استوری یافت نشد.');
  return q('SELECT user_id, at, reaction FROM story_views WHERE story_id=? ORDER BY at DESC', sid)
    .map((r) => ({ user: userJson(rowUser(r.user_id), u.id), at: r.at, reaction: r.reaction }));
}));
stories.delete('/:sid', h((req) => {
  const u = auth(req);
  run('DELETE FROM stories WHERE id=? AND user_id=?', int(req.params.sid), u.id);
  return { ok: true };
}));

/* ------------------------------------------------------------------ call history */
export const calls = Router();
calls.get('/', h((req) => {
  const u = auth(req);
  const rows = q('SELECT * FROM calls WHERE caller=? OR callee=? ORDER BY started_at DESC LIMIT 100', u.id, u.id);
  const uids = new Set();
  const out = rows.map((r) => {
    const other = r.caller === u.id ? r.callee : r.caller; uids.add(other);
    return { id: r.id, user_id: other, out: r.caller === u.id, video: !!r.video, status: r.status, started_at: r.started_at,
      dur: r.answered_at && r.ended_at ? Math.floor((r.ended_at - r.answered_at) / 1000) : 0 };
  });
  return { calls: out, users: [...uids].map((i) => userJson(rowUser(i), u.id)).filter(Boolean) };
}));
calls.delete('/', h((req) => {
  const u = auth(req);
  run('DELETE FROM calls WHERE caller=? OR callee=?', u.id, u.id);
  return { ok: true };
}));

// ICE/TURN configuration for WebRTC calls
calls.get('/ice', h((req) => {
  auth(req); // require auth
  const stunUrls = process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';
  const turnUrls = process.env.WEBRTC_TURN_URLS || '';
  const turnUser = process.env.WEBRTC_TURN_USER || '';
  const turnPass = process.env.WEBRTC_TURN_PASS || '';
  const forceTurn = process.env.WEBRTC_FORCE_TURN === '1' || process.env.WEBRTC_FORCE_TURN === 'true';

  const iceServers = [];
  if (stunUrls) iceServers.push({ urls: stunUrls.split(',').map((s) => s.trim()).filter(Boolean) });
  if (turnUrls && turnUser && turnPass) {
    iceServers.push({ urls: turnUrls.split(',').map((s) => s.trim()).filter(Boolean), username: turnUser, credential: turnPass });
  }
  return { iceServers, iceTransportPolicy: forceTurn ? 'relay' : 'all' };
}));
