import { Router } from 'express';
import { q, q1, ex, run, now, likeEsc } from '../db.js';
import { h, body, str, int, auth } from '../lib/http.js';
import { err, rateHit } from '../lib/security.js';
import { sec } from '../lib/settings.js';
import { PREMIUM_STICKERS, STICKER_PACK_SIZES, GIF_COUNT, MSG_TYPES } from '../config.js';
import {
  J, userJson, messageJson, rowUser, rowChat, rowMsg, member, chatMemberIds, privatePeer, vis, canPost, blocked,
  allowed, privacyOf, limits, isPremium, pushChat, deliverMessage, updateMessage, service, fileUrl, insertMessage, releaseScheduled,
} from '../domain.js';
import { requireMember } from './chats.js';
import { BOT_ID, botHandle } from '../system.js';
import { hub } from '../realtime/hub.js';

export const chatScoped = Router();
export const router = Router();

chatScoped.get('/:cid/messages', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  const limit = Math.min(Math.max(int(req.query.limit, 50), 1), 100);
  const cleared = m ? m.cleared : 0; const V = vis(u.id);
  let rows; let hasNewer = false;
  if (req.query.after) {
    rows = q(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? AND m.id>? ${V} ORDER BY m.id ASC LIMIT ?`, cid, cleared, int(req.query.after), limit);
    hasNewer = rows.length === limit;
    if (!rows.length) return { messages: [], has_older: true, has_newer: false, users: [] };
  } else if (req.query.around) {
    const a = int(req.query.around); const half = Math.floor(limit / 2);
    const older = q(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? AND m.id<=? ${V} ORDER BY m.id DESC LIMIT ?`, cid, cleared, a, half);
    const newer = q(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? ${V} ORDER BY m.id ASC LIMIT ?`, cid, a, half);
    rows = [...older.reverse(), ...newer]; hasNewer = newer.length === half;
  } else {
    const before = req.query.before ? int(req.query.before) : Number.MAX_SAFE_INTEGER;
    rows = q(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? AND m.id<? ${V} ORDER BY m.id DESC LIMIT ?`, cid, cleared, before, limit).reverse();
  }
  const hasOlder = !!rows.length && !!q1(`SELECT 1 FROM messages m WHERE m.chat_id=? AND m.id>? AND m.id<? ${V} LIMIT 1`, cid, cleared, rows[0].id);
  const uids = new Set(rows.map((r) => r.sender_id).filter(Boolean));
  for (const r of rows) if (r.type === 'contact') { const id = J(r.data, {})?.user_id; if (id) uids.add(id); }
  return {
    messages: rows.map((r) => messageJson(r, u.id, c.type)), has_older: hasOlder, has_newer: hasNewer,
    users: [...uids].map((i) => userJson(rowUser(i), u.id)).filter(Boolean),
  };
}));

chatScoped.get('/:cid/pinned', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  return { messages: q(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? AND m.pinned=1 AND m.sched_at IS NULL ${vis(u.id)} ORDER BY m.id DESC LIMIT 100`, cid, m ? m.cleared : 0).map((r) => messageJson(r, u.id, c.type)) };
}));

chatScoped.get('/:cid/scheduled', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c } = requireMember(cid, u.id);
  return { messages: q('SELECT * FROM messages WHERE chat_id=? AND sender_id=? AND sched_at IS NOT NULL AND deleted=0 ORDER BY sched_at LIMIT 100', cid, u.id).map((r) => messageJson(r, u.id, c.type)) };
}));

chatScoped.get('/:cid/search', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { m } = requireMember(cid, u.id);
  const s = str(req.query.q, 100).trim();
  if (!s) return { ids: [] };
  const like = likeEsc(s);
  return {
    ids: q(`SELECT m.id FROM messages m WHERE m.chat_id=? AND m.id>? AND m.type<>'service' AND (m.text LIKE ? ESCAPE '\\' OR (m.type IN ('file','poll') AND m.data LIKE ? ESCAPE '\\')) ${vis(u.id)} ORDER BY m.id DESC LIMIT 200`,
      cid, m ? m.cleared : 0, like, like).map((r) => r.id),
  };
}));

chatScoped.get('/:cid/media', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  const cond = {
    image: "m.type IN ('image','video')", file: "m.type='file'", voice: "m.type='voice'",
    link: "m.type='text' AND (m.text LIKE '%http://%' OR m.text LIKE '%https://%')",
  }[req.query.kind] || "m.type IN ('image','video')";
  return { messages: q(`SELECT m.* FROM messages m WHERE m.chat_id=? AND m.id>? AND ${cond} ${vis(u.id)} ORDER BY m.id DESC LIMIT 200`, cid, m ? m.cleared : 0).map((r) => messageJson(r, u.id, c.type)) };
}));

const num = (v) => typeof v === 'number' && Number.isFinite(v);
function validatePayload(u, type, text, data) {
  if (!MSG_TYPES.has(type)) err(400, 'نوع پیام نامعتبر است.');
  if ([...text].length > 4096) err(400, 'متن پیام حداکثر ۴۰۹۶ نویسه است.');
  data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  let clean = {};
  if (['image', 'video', 'file', 'voice'].includes(type)) {
    const f = q1('SELECT * FROM files WHERE id=? AND done=1', str(data.file, 40));
    if (!f) err(400, 'فایل پیوست یافت نشد.');
    if (f.owner !== u.id) err(403, 'دسترسی به فایل ندارید.');
    if (f.size > limits(u).upload) err(403, 'حجم فایل از سقف مجاز بیشتر است.');
    clean = { file: f.id, url: fileUrl(f.id), name: f.name, size: f.size, mime: f.mime };
    for (const k of ['w', 'h', 'dur']) if (num(data[k])) clean[k] = Math.max(0, Math.min(1e6, data[k]));
    if (type === 'voice' && Array.isArray(data.wave)) clean.wave = data.wave.slice(0, 64).map((x) => Math.round(Math.max(0, Math.min(1, +x || 0)) * 100) / 100);
    if (data.spoiler) clean.spoiler = true;
    if (typeof data.thumb === 'string' && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]{1,20000}$/.test(data.thumb)) clean.thumb = data.thumb;
  } else if (type === 'sticker') {
    if (data.sticker != null) {
      const id = data.sticker;
      const match = typeof id === 'string' && /^([123]):(0|[1-9]\d{0,2})$/.exec(id);
      if (!match || Number(match[2]) >= STICKER_PACK_SIZES[match[1]]) err(400, 'استیکر نامعتبر است.');
      clean = { sticker: id };
    } else {
      const e = str(data.e, 16);
      if (!e) err(400, 'استیکر نامعتبر است.');
      if (PREMIUM_STICKERS.has(e) && !isPremium(u)) err(403, 'این استیکر مخصوص کاربران پریمیوم است.');
      clean = { e, premium: PREMIUM_STICKERS.has(e) };
    }
  } else if (type === 'gif') {
    if (data.gif != null) {
      if (!Number.isInteger(data.gif) || data.gif < 0 || data.gif >= GIF_COUNT) err(400, 'گیف نامعتبر است.');
      clean = { gif: data.gif };
    } else {
      const bg = Array.isArray(data.bg) ? data.bg : ['#4f8cff', '#8b5cf6'];
      clean = { t: str(data.t, 24), bg: bg.slice(0, 2).map((x) => (/^#[0-9a-fA-F]{3,8}$/.test(x) ? x : '#4f8cff')) };
    }
  } else if (type === 'poll') {
    const qs = str(data.q, 255).trim();
    const opts = (Array.isArray(data.opts) ? data.opts : []).map((o) => str(o, 100).trim()).filter(Boolean).slice(0, 10);
    if (!qs || opts.length < 2) err(400, 'نظرسنجی باید سؤال و دست‌کم دو گزینه داشته باشد.');
    clean = { q: qs, opts, anon: data.anon !== false, multi: !!data.multi, quiz: !!data.quiz };
    if (clean.quiz) {
      if (!Number.isInteger(data.correct) || data.correct < 0 || data.correct >= opts.length) err(400, 'در حالت آزمون، گزینه درست را مشخص کنید.');
      Object.assign(clean, { correct: data.correct, multi: false, explain: str(data.explain, 200) });
    }
  } else if (type === 'location') {
    const lat = +data.lat, lng = +data.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) err(400, 'موقعیت نامعتبر است.');
    clean = { lat, lng, name: str(data.name, 120), acc: num(data.acc) ? Math.round(data.acc) : null };
  } else if (type === 'contact') {
    const t = rowUser(int(data.user_id));
    if (!t || t.deleted) err(400, 'مخاطب نامعتبر است.');
    clean = { user_id: t.id, name: t.name, username: t.username };
  } else if (type === 'text' && !text.trim()) err(400, 'پیام خالی است.');
  return clean;
}

chatScoped.post('/:cid/messages', h((req) => {
  const u = auth(req); const cid = int(req.params.cid);
  const { c, m } = requireMember(cid, u.id);
  if (c.frozen) err(403, 'این گفتگو توسط مدیریت GuardNet مسدود شده است.');
  if (!canPost(c, m)) err(403, 'اجازه ارسال پیام در این گفتگو را ندارید.');
  if (!rateHit(`msg:${u.id}`, sec().message_rate_per_min, 60e3)) err(429, 'پیام‌های زیادی فرستادید؛ چند لحظه صبر کنید.');
  const b = body(req);
  const type = str(b.type || 'text', 20); const text = str(b.text, 20000);
  const data = validatePayload(u, type, text, b.data);
  if (c.type === 'private') {
    const peer = privatePeer(c, u.id);
    if (peer !== u.id) {
      if (blocked(u.id, peer)) err(403, 'این کاربر را مسدود کرده‌اید.');
      const pu = rowUser(peer);
      if (pu?.deleted) err(403, 'این حساب حذف شده است.');
    }
  }
  let replyTo = b.reply_to ? int(b.reply_to) : null;
  if (replyTo && !q1('SELECT 1 FROM messages WHERE id=? AND chat_id=?', replyTo, cid)) replyTo = null;
  let sched = b.sched_at ? int(b.sched_at) : null;
  if (sched) {
    if (sched <= now() + 5000) sched = null;
    else if (sched > now() + 365 * 86400e3) err(400, 'زمان‌بندی حداکثر تا یک سال آینده ممکن است.');
  }
  // Self-destructing messages (TTL) — only in private chats, not for service/scheduled
  let ttl = 0;
  if (b.ttl && c.type === 'private' && !sched && type !== 'service') {
    ttl = int(b.ttl);
    const TTL_OPTS = [0, 3, 10, 30, 60, 300, 3600, 86400, 604800];
    if (!TTL_OPTS.includes(ttl)) err(400, 'زمان خودمخفی نامعتبر است.');
  }
  const mid = insertMessage(cid, u.id, type, text, data, { reply_to: replyTo, sched_at: sched, silent: !!b.silent, ttl: ttl });
  // Set expires_at for self-destructing messages (timer starts at send time)
  if (ttl) run('UPDATE messages SET expires_at=? WHERE id=?', now() + ttl * 1000, mid);
  run("UPDATE members SET draft='', last_read=MAX(last_read, ?) WHERE chat_id=? AND user_id=?", sched ? 0 : mid, cid, u.id);
  if (c.type === 'private') run('UPDATE members SET left=0 WHERE chat_id=?', cid);
  if (!sched) {
    deliverMessage(mid);
    if (c.type === 'private' && privatePeer(c, u.id) === BOT_ID && type === 'text') botHandle(cid, u.id, text).catch(() => {});
  }
  return { message: messageJson(rowMsg(mid), u.id, c.type) };
}));

router.post('/forward', h((req) => {
  const u = auth(req); const b = body(req);
  const src = int(b.from_chat);
  const { c: sc } = requireMember(src, u.id);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter(Boolean).slice(0, 100);
  const rows = ids.length ? q(`SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND type<>'service' AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, src, ...ids) : [];
  if (!rows.length) err(400, 'پیامی برای بازارسال انتخاب نشده است.');
  let sent = 0;
  for (const t of (Array.isArray(b.to) ? b.to : []).slice(0, 20)) {
    const tc = rowChat(int(t)); const tm = tc ? member(tc.id, u.id) : null;
    if (!tc || !canPost(tc, tm)) continue;
    if (tc.type === 'private') { const p = privatePeer(tc, u.id); if (p !== u.id && blocked(u.id, p)) continue; }
    for (const r of rows) {
      const su = rowUser(r.sender_id);
      let fwd;
      if (r.fwd) fwd = J(r.fwd);
      else if (sc.type === 'channel') fwd = { name: sc.title, chat_id: sc.id, msg_id: r.id };
      else {
        const hide = su && !allowed(privacyOf(su).forwards, su.id, u.id);
        fwd = { name: su ? su.name : 'ناشناس', user_id: hide ? null : r.sender_id };
      }
      if (b.hide_sender) fwd = null;
      const data = J(r.data, {}) || {}; delete data.kb;
      deliverMessage(insertMessage(tc.id, u.id, r.type, r.text, data, { fwd, silent: !!b.silent }));
      sent++;
    }
    if (tc.type === 'private') run('UPDATE members SET left=0 WHERE chat_id=?', tc.id);
  }
  return { sent };
}));

function ownMsg(mid, uid) {
  const m = q1('SELECT * FROM messages WHERE id=? AND deleted=0', mid);
  if (!m) err(404, 'پیام یافت نشد.');
  const c = rowChat(m.chat_id); const mem = member(c.id, uid);
  if (!mem && !c.is_public) err(403, 'دسترسی ندارید.');
  return { m, c, mem };
}

router.post('/delete', h((req) => {
  const u = auth(req); const b = body(req);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter(Boolean).slice(0, 200);
  const forAll = !!b.for_all; let done = 0;
  for (const mid of ids) {
    const m = q1('SELECT * FROM messages WHERE id=? AND deleted=0', mid);
    if (!m) continue;
    const c = rowChat(m.chat_id); const mem = member(c.id, u.id);
    if (!mem) continue;
    const isAdmin = ['owner', 'admin'].includes(mem.role);
    const canAll = m.sender_id === u.id || (['group', 'channel'].includes(c.type) && isAdmin);
    if (c.type === 'channel' && !isAdmin) continue;
    if ((forAll || ['channel', 'saved'].includes(c.type) || m.sched_at) && canAll) {
      run('UPDATE messages SET deleted=1 WHERE id=?', mid);
      chatMemberIds(c.id).forEach((uid) => hub.send(uid, 'message:delete', { chat_id: c.id, ids: [mid] }));
      pushChat(c.id);
    } else {
      ex('INSERT OR IGNORE INTO hidden(msg_id,user_id) VALUES(?,?)', mid, u.id);
      hub.send(u.id, 'message:delete', { chat_id: c.id, ids: [mid] });
      pushChat(c.id, [u.id]);
    }
    done++;
  }
  return { deleted: done };
}));

router.patch('/:mid', h((req) => {
  const u = auth(req); const mid = int(req.params.mid);
  const { m, c } = ownMsg(mid, u.id);
  if (m.sender_id !== u.id) err(403, 'فقط پیام‌های خودتان را می‌توانید ویرایش کنید.');
  if (!['text', 'image', 'video', 'file', 'voice'].includes(m.type)) err(400, 'این پیام قابل ویرایش نیست.');
  if (now() - m.created_at > 48 * 3600e3 && !m.sched_at) err(400, 'مهلت ویرایش (۴۸ ساعت) گذشته است.');
  const b = body(req); const text = str(b.text, 20000);
  if (m.type === 'text' && !text.trim()) err(400, 'پیام خالی است.');
  if ([...text].length > 4096) err(400, 'متن طولانی است.');
  run('UPDATE messages SET text=?, edited_at=? WHERE id=?', text, m.sched_at ? null : now(), mid);
  if ('sched_at' in b && m.sched_at) {
    const s = int(b.sched_at);
    if (s > now() + 5000 && s < now() + 365 * 86400e3) run('UPDATE messages SET sched_at=? WHERE id=?', s, mid);
  }
  updateMessage(mid);
  return messageJson(rowMsg(mid), u.id, c.type);
}));

router.post('/:mid/react', h((req) => {
  const u = auth(req); const mid = int(req.params.mid);
  const { m, c, mem } = ownMsg(mid, u.id);
  if (!mem) err(403, 'برای واکنش ابتدا عضو شوید.');
  const e = str(body(req).emoji, 16);
  const cur = q1('SELECT emoji FROM reactions WHERE msg_id=? AND user_id=?', mid, u.id);
  if (!e || cur?.emoji === e) run('DELETE FROM reactions WHERE msg_id=? AND user_id=?', mid, u.id);
  else {
    ex('INSERT OR REPLACE INTO reactions(msg_id,user_id,emoji,at) VALUES(?,?,?,?)', mid, u.id, e, now());
    if (m.sender_id !== u.id && c.type !== 'channel') hub.send(m.sender_id, 'reaction:notify', { chat_id: c.id, msg_id: mid, user_id: u.id, emoji: e });
  }
  updateMessage(mid);
  return messageJson(rowMsg(mid), u.id, c.type);
}));

router.post('/:mid/pin', h((req) => {
  const u = auth(req); const mid = int(req.params.mid);
  const { c, mem } = ownMsg(mid, u.id);
  if (!mem) err(403, 'دسترسی ندارید.');
  if (['group', 'channel'].includes(c.type) && !['owner', 'admin'].includes(mem.role)) err(403, 'فقط مدیران می‌توانند پیام سنجاق کنند.');
  const b = body(req); const p = b.pinned !== false;
  run('UPDATE messages SET pinned=? WHERE id=?', p ? 1 : 0, mid);
  if (p && !b.silent) deliverMessage(service(c.id, u.id, `${c.type !== 'channel' ? u.name : c.title} یک پیام را سنجاق کرد`));
  updateMessage(mid);
  return { ok: true };
}));

router.post('/:mid/vote', h((req) => {
  const u = auth(req); const mid = int(req.params.mid);
  const { m, c, mem } = ownMsg(mid, u.id);
  if (!mem) err(403, 'برای رأی دادن ابتدا عضو شوید.');
  if (m.type !== 'poll') err(400, 'این پیام نظرسنجی نیست.');
  const data = J(m.data, {});
  if (data.closed) err(400, 'نظرسنجی بسته شده است.');
  let opts = [...new Set((Array.isArray(body(req).opts) ? body(req).opts : []).map((x) => Number.parseInt(x, 10)))]
    .filter((x) => Number.isInteger(x) && x >= 0 && x < data.opts.length);
  if (data.quiz && q1('SELECT 1 FROM votes WHERE msg_id=? AND user_id=?', mid, u.id)) err(400, 'در آزمون امکان تغییر پاسخ نیست.');
  if (!data.multi) opts = opts.slice(0, 1);
  run('DELETE FROM votes WHERE msg_id=? AND user_id=?', mid, u.id);
  for (const o of opts) ex('INSERT OR IGNORE INTO votes(msg_id,user_id,opt) VALUES(?,?,?)', mid, u.id, o);
  updateMessage(mid);
  return messageJson(rowMsg(mid), u.id, c.type);
}));

router.post('/:mid/close', h((req) => {
  const u = auth(req); const mid = int(req.params.mid);
  const { m } = ownMsg(mid, u.id);
  if (m.sender_id !== u.id || m.type !== 'poll') err(403, 'فقط سازنده می‌تواند نظرسنجی را ببندد.');
  const data = J(m.data, {}); data.closed = true;
  run('UPDATE messages SET data=? WHERE id=?', JSON.stringify(data), mid);
  updateMessage(mid);
  return { ok: true };
}));

router.post('/:mid/send-now', h((req) => {
  const u = auth(req); const mid = int(req.params.mid);
  const { m, c } = ownMsg(mid, u.id);
  if (m.sender_id !== u.id || !m.sched_at) err(400, 'این پیام زمان‌بندی‌شده نیست.');
  releaseScheduled(mid);
  return { ok: true };
}));
