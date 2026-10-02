import { Fragment } from 'react';

export const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const fa = (n) => String(n ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const cx = (...a) => a.filter(Boolean).join(' ');

const dtf = (o) => new Intl.DateTimeFormat('fa-IR', o);
const fTime = dtf({ hour: '2-digit', minute: '2-digit', hour12: false });
const fWeek = dtf({ weekday: 'long' });
const fWeekShort = dtf({ weekday: 'short' });
const fDay = dtf({ day: 'numeric', month: 'long' });
const fDayY = dtf({ day: 'numeric', month: 'long', year: 'numeric' });
const fShort = dtf({ year: '2-digit', month: '2-digit', day: '2-digit' });

export const fmtTime = (t) => (t ? fTime.format(new Date(t)) : '');
export function sameDay(a, b) { const x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString(); }
export function fmtDay(t) {
  const d = new Date(t); const n = new Date();
  if (sameDay(d, n)) return 'امروز';
  if (sameDay(d, n.getTime() - DAY)) return 'دیروز';
  return d.getFullYear() === n.getFullYear() ? fDay.format(d) : fDayY.format(d);
}
export function fmtListTime(t) {
  if (!t) return '';
  const d = new Date(t); const n = Date.now();
  if (sameDay(d, n)) return fTime.format(d);
  if (n - t < 6 * DAY) return fWeekShort.format(d);
  return fShort.format(d);
}
export const fmtFull = (t) => (t ? `${fDayY.format(new Date(t))}، ${fTime.format(new Date(t))}` : '');
export function ago(t) {
  const s = Date.now() - t;
  if (s < MIN) return 'لحظاتی پیش';
  if (s < HOUR) return `${fa(Math.floor(s / MIN))} دقیقه پیش`;
  if (s < DAY && sameDay(t, Date.now())) return `امروز ساعت ${fmtTime(t)}`;
  if (sameDay(t, Date.now() - DAY)) return `دیروز ساعت ${fmtTime(t)}`;
  if (s < 7 * DAY) return `${fWeek.format(new Date(t))} ساعت ${fmtTime(t)}`;
  return fDayY.format(new Date(t));
}
export function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return `${fa(b)} بایت`;
  if (b < 1024 * 1024) return `${fa((b / 1024).toFixed(1))} کیلوبایت`;
  if (b < 1024 ** 3) return `${fa((b / 1024 / 1024).toFixed(1))} مگابایت`;
  return `${fa((b / 1024 ** 3).toFixed(2))} گیگابایت`;
}
export const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return fa(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); };
export function fmtNum(n) {
  if (n < 1000) return fa(n);
  if (n < 1e6) return fa((n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')) + 'K';
  return fa((n / 1e6).toFixed(1).replace(/\.0$/, '')) + 'M';
}
export const initials = (name) => {
  const p = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
};
export const plural = (n, word) => `${fa(n)} ${word}`;

/* ------------------------------------------------------------------ safe rich text → React */
const TOKEN = /(```[\s\S]+?```|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\|\|[^|\n]+\|\||https?:\/\/[^\s<>"']+[^\s<>"'.,!?؟،:;)\]]|@[A-Za-z][A-Za-z0-9_]{3,31}|#[\p{L}\p{N}_]{2,40}|\/[a-z]{2,20}\b)/gu;

/** Only allow http/https URLs — blocks javascript:, data:, file: etc. */
function safeUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch { /* invalid */ }
  return null;
}

export function RichText({ text, onMention, onHashtag, onCommand, highlight }) {
  const out = [];
  const src = String(text || '');
  let last = 0; let k = 0;
  const push = (s) => {
    if (!s) return;
    if (highlight) {
      const re = new RegExp(highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let i = 0; let m;
      while ((m = re.exec(s))) { if (m.index > i) out.push(<Fragment key={k++}>{s.slice(i, m.index)}</Fragment>); out.push(<mark key={k++}>{m[0]}</mark>); i = m.index + m[0].length; if (!m[0].length) break; }
      if (i < s.length) out.push(<Fragment key={k++}>{s.slice(i)}</Fragment>);
    } else out.push(<Fragment key={k++}>{s}</Fragment>);
  };
  for (const m of src.matchAll(TOKEN)) {
    push(src.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('```')) out.push(<pre key={k++} dir="ltr"><code>{t.slice(3, -3).replace(/^\n/, '')}</code></pre>);
    else if (t.startsWith('`')) out.push(<code key={k++} dir="ltr">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<b key={k++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('__')) out.push(<i key={k++}>{t.slice(2, -2)}</i>);
    else if (t.startsWith('~~')) out.push(<s key={k++}>{t.slice(2, -2)}</s>);
    else if (t.startsWith('||')) out.push(<Spoiler key={k++} text={t.slice(2, -2)} />);
    else if (t.startsWith('http')) { const safe = safeUrl(t); if (safe) out.push(<a key={k++} href={safe} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" onClick={(e) => e.stopPropagation()}>{t.length > 60 ? t.slice(0, 57) + '…' : t}</a>); else out.push(<Fragment key={k++}>{t}</Fragment>); }
    else if (t.startsWith('@')) out.push(<a key={k++} className="mention" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMention?.(t.slice(1)); }} href="#" dir="ltr">{t}</a>);
    else if (t.startsWith('#')) out.push(<a key={k++} className="mention" href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHashtag?.(t); }}>{t}</a>);
    else if (t.startsWith('/') && onCommand) out.push(<a key={k++} className="mention" href="#" dir="ltr" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCommand(t); }}>{t}</a>);
    else push(t);
    last = m.index + t.length;
  }
  push(src.slice(last));
  return <>{out}</>;
}

import { useState } from 'react';
function Spoiler({ text }) {
  const [open, setOpen] = useState(false);
  return <span className={cx('spoiler', open && 'open')} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{text}</span>;
}

/** Plain-text preview (for chat list / reply bars). */
export function previewText(m) {
  if (!m) return '';
  const d = m.data || {};
  switch (m.type) {
    case 'image': return `🖼 ${m.text || 'عکس'}`;
    case 'video': return `🎬 ${m.text || 'ویدیو'}`;
    case 'file': return `📎 ${d.name || 'فایل'}`;
    case 'voice': return `🎤 پیام صوتی ${d.dur ? fmtDur(d.dur) : ''}`;
    case 'sticker': return d.sticker ? 'استیکر' : `${d.e || ''} استیکر`;
    case 'gif': return d.gif != null ? 'GIF' : `GIF ${d.t || ''}`;
    case 'poll': return `📊 ${d.q || 'نظرسنجی'}`;
    case 'location': return '📍 موقعیت مکانی';
    case 'contact': return `👤 ${d.name || 'مخاطب'}`;
    case 'call': return d.video ? '📹 تماس تصویری' : '📞 تماس صوتی';
    default: return String(m.text || '').replace(/```|\*\*|__|~~|\|\|/g, '').replace(/\s+/g, ' ');
  }
}
export const isEmojiOnly = (t) => {
  const s = String(t || '').trim();
  if (!s || s.length > 24) return 0;
  const segs = [...new Intl.Segmenter('fa', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment).filter((x) => x.trim());
  if (segs.length > 3) return 0;
  return segs.every((g) => /\p{Extended_Pictographic}/u.test(g)) ? segs.length : 0;
};
