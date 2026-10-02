import { memo, useEffect, useRef, useState } from 'react';
import { useStore, setState, getState, toast } from '../lib/store.js';
import {
  meId, userName, userOf, react, pinMessage, openModal, deleteMessages, vote, retryMessage, cancelUpload, openPrivate, resolveAndOpen,
  sendMessage, settings, setSetting, forwardMessages, isGifSaved, toggleSavedGif,
} from '../lib/actions.js';
import { api, assetUrl } from '../lib/api.js';
import { cx, fa, fmtTime, fmtFull, fmtSize, fmtDur, RichText, isEmojiOnly, previewText, fmtNum } from '../lib/format.jsx';
import { Avatar, Icon, Spinner, Verified } from './ui.jsx';
import { openMenu, useLongPress, confirmDialog } from './overlay.jsx';
import { jumpTo } from './Chat.jsx';
import { startCall } from './Calls.jsx';
import Sticker from './Sticker.jsx';

export const QUICK = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '👏', '🎉', '🤩', '👎', '💯'];

function Message({ m, c, first, last, flash, hl }) {
  const myId = meId();
  const sel = useStore((s) => s.select);
  const sender = useStore((s) => s.users.get(m.sender_id));
  const peerRead = c.peer_read;
  const out = m.sender_id === myId && c.type !== 'channel';
  const lp = useLongPress((e) => msgMenu(e, m, c));
  if (m.type === 'service') return <div className="svc" data-mid={m.id}><span className="glass-chip">{m.text}</span></div>;
  const selected = sel?.has(m.id);
  const toggleSel = () => { const s = new Set(getState().select); if (s.has(m.id)) s.delete(m.id); else s.add(m.id); setState({ select: s }); };
  const showName = c.type === 'group' && !out && first;
  const showAvatar = c.type === 'group' && !out;
  const emojiN = m.type === 'text' && settings().bigEmoji && !m.reply && !m.fwd ? isEmojiOnly(m.text) : 0;
  const bare = m.type === 'sticker' || emojiN;
  const media = (m.type === 'image' || m.type === 'video') && !m.text;
  const onClickCapture = sel ? toggleSel : undefined;
  const ltr = !!m.text && /^[^A-Za-z\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]*[A-Za-z]/.test(m.text);
  return (
    <div className={cx('msg', out ? 'out' : 'in', first && 'first', last && 'last', selected && 'selected', flash && 'flash', sel && 'selecting')}
      data-mid={m.id} onClickCapture={onClickCapture} onDoubleClick={() => !sel && m.id > 0 && react(m, settings().quickReaction || '👍')}>
      {sel && <span className={cx('msg-check', selected && 'on')}><Icon name="check" /></span>}
      {showAvatar && (
        <div className="msg-av">{last && <Avatar src={sender?.avatar} name={sender?.name} color={sender?.color} size={34} onClick={(e) => { e.stopPropagation(); setState({ panel: { type: 'user', id: m.sender_id } }); }} />}</div>
      )}
      <div className={cx('bubble', bare && 'bare', media && 'media-only', m.type === 'poll' && 'wide', m.failed && 'failed', emojiN && `emoji-${emojiN}`, ltr && 'ltr', `t-${m.type}`)} {...(sel ? {} : lp)}>
        {showName && !bare && (
          <div className="b-name" style={{ color: sender?.color?.[0] }} onClick={(e) => { e.stopPropagation(); setState({ panel: { type: 'user', id: m.sender_id } }); }}>
            {userName(sender)}{sender?.verified && <Verified size={13} />}
            {c.type === 'group' && sender && (c.owner_id === sender.id) && <span className="b-role">مالک</span>}
          </div>
        )}
        {m.fwd && <Forwarded fwd={m.fwd} />}
        {m.reply && <ReplyQuote r={m.reply} c={c} />}
        <Body m={m} c={c} out={out} emojiN={emojiN} hl={hl} />
        {Object.keys(m.reactions || {}).length > 0 && <Reactions m={m} c={c} />}
        <Meta m={m} out={out} read={out && peerRead != null && peerRead >= m.id} channel={c.type === 'channel'} overlay={media || bare} />
        {m.ttl > 0 && <TtlTimer m={m} />}
      </div>
    </div>
  );
}
export default memo(Message);

function Forwarded({ fwd }) {
  const click = (e) => { e.stopPropagation(); if (fwd.user_id) openPrivate(fwd.user_id); };
  return <div className="b-fwd" onClick={click}><Icon name="forward" /><span>بازارسال از <b>{fwd.name || 'ناشناس'}</b></span></div>;
}
function ReplyQuote({ r, c }) {
  const u = useStore((s) => s.users.get(r.sender_id));
  if (r.deleted) return <div className="b-reply deleted"><span className="r-name">پیام حذف‌شده</span></div>;
  const thumb = r.type === 'image' && r.data?.url ? assetUrl(r.data.url) : null;
  return (
    <div className="b-reply" onClick={(e) => { e.stopPropagation(); jumpTo(c.id, r.id); }} style={u?.color ? { '--rc': u.color[0] } : undefined}>
      {thumb && <img src={thumb} alt="" />}
      <span className="r-body"><span className="r-name">{userName(u)}</span><span className="r-text">{previewText(r) || '…'}</span></span>
    </div>
  );
}

function Meta({ m, out, read, channel, overlay }) {
  return (
    <span className={cx('b-meta', overlay && 'overlay')} title={fmtFull(m.created_at)}>
      {m.silent && <Icon name="bellOff" className="m-ic" />}
      {m.pinned && <Icon name="pin" className="m-ic" />}
      {channel && m.views != null && <><Icon name="eye" className="m-ic" /><span>{fmtNum(m.views)}</span></>}
      {m.edited_at && <span className="m-edited">ویرایش‌شده</span>}
      <span>{fmtTime(m.created_at)}</span>
      {out && (m.failed ? <Icon name="alert" className="m-fail" /> : m.pending ? <Icon name="clock" className="m-ic" /> : <Icon name={read ? 'checks' : 'check'} className={cx('m-check', read && 'read')} />)}
    </span>
  );
}
/** Invisible spacer so the floating meta never overlaps the text's last line. */
const Spacer = ({ m, out }) => <span className={cx('meta-space', m.edited_at && 'ed', out && 'out', m.pinned && 'pin')} aria-hidden="true" />;

function Body({ m, c, out, emojiN, hl }) {
  const d = m.data || {};
  const rt = (t) => <RichText text={t} highlight={hl} onMention={(u) => resolveAndOpen(u)} onHashtag={(h) => setState({ search: h })}
    onCommand={userOf(c.peer_id)?.bot ? (cmd) => sendMessage(c.id, { text: cmd }) : undefined} />;
  switch (m.type) {
    case 'text':
      if (emojiN) return <div className="b-emoji">{m.text}</div>;
      return <div className="b-text" dir="auto">{rt(m.text)}<Spacer m={m} out={out} /></div>;
    case 'image': case 'video':
      return (
        <>
          <MediaBox m={m} />
          {m.text && <div className="b-text caption" dir="auto">{rt(m.text)}<Spacer m={m} out={out} /></div>}
        </>
      );
    case 'file': return <><FileBox m={m} />{m.text ? <div className="b-text caption" dir="auto">{rt(m.text)}<Spacer m={m} out={out} /></div> : <Spacer m={m} out={out} />}</>;
    case 'voice': return <Voice m={m} out={out} />;
    case 'sticker': return <div className={cx('b-sticker', d.sticker && 'image', d.premium && 'premium')}>{d.sticker ? <Sticker id={d.sticker} /> : d.e}</div>;
    case 'gif': return d.gif != null
      ? <div className="b-gif real"><img src={Number.isInteger(d.gif) && d.gif >= 0 && d.gif < 16 ? `/gifs/${d.gif}.gif` : undefined} alt="گیف" loading="lazy" draggable="false" /><em>GIF</em></div>
      : <div className="b-gif" style={{ background: `linear-gradient(135deg, ${d.bg?.[0] || '#4f8cff'}, ${d.bg?.[1] || '#8b5cf6'})` }}><span>{d.t}</span><em>GIF</em></div>;
    case 'poll': return <Poll m={m} c={c} out={out} />;
    case 'location': return <Location d={d} />;
    case 'contact': return <ContactCard d={d} />;
    case 'call': return <CallBubble m={m} out={out} />;
    default: return <div className="b-text">{m.text || 'این نوع پیام پشتیبانی نمی‌شود'}<Spacer m={m} out={out} /></div>;
  }
}

function MediaBox({ m }) {
  const d = m.data || {};
  const [revealed, setRevealed] = useState(!d.spoiler);
  const [loaded, setLoaded] = useState(false);
  const w = d.w || 320; const h = d.h || 240;
  const maxW = 340; const maxH = 400;
  const scale = Math.min(maxW / w, maxH / h, 1);
  const bw = Math.max(160, Math.round(w * scale)); const bh = Math.max(110, Math.round(h * scale));
  const url = d.local ? d.url : assetUrl(d.url);
  const open = (e) => {
    e.stopPropagation();
    if (getState().select) return;
    if (!revealed) { setRevealed(true); return; }
    if (!m.pending) setState({ viewer: { chatId: m.chat_id, mid: m.id } });
  };
  return (
    <div className={cx('b-media', !revealed && 'spoiler', loaded && 'loaded')} style={{ '--mw': `${bw}px`, aspectRatio: `${bw} / ${bh}` }} onClick={open}>
      {m.type === 'image'
        ? <img src={url} alt={d.name || ''} loading="lazy" onLoad={() => setLoaded(true)} draggable="false" />
        : <video src={url} preload="metadata" muted playsInline onLoadedData={() => setLoaded(true)} />}
      {m.type === 'video' && revealed && !m.pending && <span className="play-ov"><Icon name="play" fill="currentColor" /></span>}
      {m.type === 'video' && d.dur ? <span className="media-dur">{fmtDur(d.dur)}</span> : null}
      {!revealed && <span className="spoiler-ov"><span>نمایش محتوا</span></span>}
      {m.pending && <Progress m={m} />}
    </div>
  );
}
function Progress({ m }) {
  const p = m.progress || 0;
  return (
    <button type="button" className="up-progress" onClick={(e) => { e.stopPropagation(); cancelUpload(m.id); }} aria-label="لغو بارگذاری">
      <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" className="trk" /><circle cx="24" cy="24" r="20" className="bar" style={{ strokeDashoffset: 125.7 * (1 - Math.max(0.03, p)) }} /></svg>
      <Icon name="x" />
    </button>
  );
}
function FileBox({ m }) {
  const d = m.data || {};
  const ext = (d.name || '').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';
  const isAudio = d.mime?.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'webm', 'opus'].includes((d.name || '').split('.').pop()?.toLowerCase());
  if (isAudio) return <AudioFileBox m={m} />;
  return (
    <div className="b-file">
      {m.pending ? <span className="file-ic"><Progress m={m} /></span>
        : <a className="file-ic" href={assetUrl(d.url)} download={d.name} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label="دانلود"><Icon name="download" /></a>}
      <span className="file-info">
        <span className="file-name" dir="auto" title={d.name}>{d.name}</span>
        <span className="file-size">{m.pending ? `${fmtSize(Math.round((m.progress || 0) * d.size))} از ${fmtSize(d.size)}` : `${fmtSize(d.size)} · ${ext}`}</span>
      </span>
    </div>
  );
}

let playing = null;
const SPEEDS = [1, 1.5, 2];
function Voice({ m, out }) {
  const d = m.data || {};
  const a = useRef(null);
  const [st, setSt] = useState({ play: false, t: 0, speed: settings().voicePlaybackSpeed || 1 });
  const wave = d.wave?.length ? d.wave : Array.from({ length: 40 }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(i * 1.7 + (m.id % 7))));
  const dur = d.dur || 0;
  useEffect(() => () => { if (playing === a.current) playing = null; a.current?.pause(); }, []);
  useEffect(() => { if (a.current) a.current.playbackRate = st.speed; }, [st.speed]);
  const toggle = (e) => {
    e.stopPropagation();
    if (m.pending) { cancelUpload(m.id); return; }
    const el = a.current; if (!el) return;
    if (el.paused) { if (playing && playing !== el) playing.pause(); playing = el; el.playbackRate = st.speed; el.play().catch(() => toast('پخش ممکن نشد.', 'error')); } else el.pause();
  };
  const cycleSpeed = (e) => {
    e.stopPropagation();
    setSt((s) => { const next = SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length]; setSetting('voicePlaybackSpeed', next); return { ...s, speed: next }; });
  };
  const seek = (e) => {
    e.stopPropagation();
    const el = a.current; if (!el || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (r.right - e.clientX) / r.width; // RTL: progress grows right → left
    el.currentTime = Math.max(0, Math.min(1, x)) * (el.duration && Number.isFinite(el.duration) ? el.duration : dur);
  };
  const p = dur ? Math.min(1, st.t / dur) : 0;
  return (
    <div className="b-voice">
      <button type="button" className="v-play" onClick={toggle} aria-label={st.play ? 'توقف' : 'پخش'}>{m.pending ? <Spinner size={22} /> : <Icon name={st.play ? 'pause' : 'play'} fill="currentColor" />}</button>
      <div className="v-body">
        <div className="v-wave" onClick={seek} role="slider" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="پیشرفت پخش" tabIndex={0}>
          {wave.map((v, i) => <span key={i} style={{ height: `${Math.max(12, v * 100)}%` }} className={cx(i / wave.length < p && 'on')} />)}
        </div>
        <span className="v-time">{fmtDur(st.play || st.t ? st.t : dur)}<Spacer m={m} out={out} /></span>
        <button type="button" className="v-speed" onClick={cycleSpeed} aria-label="سرعت پخش">{st.speed}×</button>
      </div>
      {!m.pending && <audio ref={a} src={assetUrl(d.url)} preload="none" onPlay={() => setSt((s) => ({ ...s, play: true }))} onPause={() => setSt((s) => ({ ...s, play: false }))}
        onEnded={() => setSt((s) => ({ ...s, play: false, t: 0 }))} onTimeUpdate={() => { const el = a.current; if (el) setSt((s) => ({ ...s, t: el.currentTime })); }} />}
    </div>
  );
}

function Poll({ m, c, out }) {
  const d = m.data || {}; const p = m.poll || { counts: [], total: 0, mine: [] };
  const [pick, setPick] = useState([]);
  const voted = p.mine.length > 0; const closed = !!d.closed;
  const showRes = voted || closed;
  const doVote = (i) => {
    if (voted || closed || m.id < 0) return;
    if (d.multi) setPick((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]));
    else vote(m, [i]);
  };
  return (
    <div className="b-poll" onClick={(e) => e.stopPropagation()}>
      <div className="poll-q" dir="auto">{d.q}</div>
      <div className="poll-kind">{closed ? 'نتایج نهایی' : d.quiz ? (d.anon ? 'آزمون ناشناس' : 'آزمون') : d.anon ? 'نظرسنجی ناشناس' : 'نظرسنجی عمومی'}{d.multi ? ' · چند گزینه‌ای' : ''}</div>
      <div className="poll-opts">
        {(d.opts || []).map((o, i) => {
          const n = p.counts[i] || 0; const pct = p.total ? Math.round((n / p.total) * 100) : 0;
          const mine = p.mine.includes(i);
          const correct = d.quiz && showRes && d.correct === i; const wrong = d.quiz && showRes && mine && d.correct !== i;
          return (
            <button key={i} type="button" className={cx('poll-opt', showRes && 'res', mine && 'mine', correct && 'correct', wrong && 'wrong')} onClick={() => doVote(i)} disabled={showRes}>
              {showRes ? <span className="po-pct">{fa(pct)}٪</span> : <span className={cx(d.multi ? 'check' : 'radio', pick.includes(i) && 'on')}>{pick.includes(i) && d.multi && <Icon name="check" />}</span>}
              <span className="po-body">
                <span className="po-text" dir="auto">{o}{mine && !d.quiz && <Icon name="checkCircle" className="po-mine" />}{correct && <Icon name="checkCircle" className="po-mine" />}{wrong && <Icon name="x" className="po-mine" />}</span>
                {showRes && <span className="po-bar"><i style={{ width: `${Math.max(pct, 2)}%` }} /></span>}
              </span>
            </button>
          );
        })}
      </div>
      {d.quiz && showRes && d.explain && <div className="poll-explain"><Icon name="info" />{d.explain}</div>}
      <div className="poll-foot">
        <span>{p.total ? `${fa(p.total)} رأی` : 'هنوز رأی داده نشده'}</span>
        {d.multi && !voted && !closed && <button type="button" className="poll-btn" disabled={!pick.length} onClick={() => vote(m, pick)}>ثبت رأی</button>}
        {voted && !closed && !d.quiz && <button type="button" className="poll-btn" onClick={() => vote(m, [])}>پس گرفتن رأی</button>}
        {m.sender_id === meId() && !closed && m.id > 0 && <button type="button" className="poll-btn" onClick={async () => { if (await confirmDialog({ title: 'پایان نظرسنجی', text: 'پس از پایان، دیگر امکان رأی دادن نیست.', ok: 'پایان' })) api(`/messages/${m.id}/close`, { method: 'POST', body: {} }).catch((e) => toast(e.message, 'error')); }}>پایان</button>}
      </div>
    </div>
  );
}

function Location({ d }) {
  const z = 15; const n = 2 ** z;
  const x = ((d.lng + 180) / 360) * n;
  const lat = (d.lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  const tx = Math.floor(x); const ty = Math.floor(y);
  const fx = x - tx; const fy = y - ty;
  const tiles = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) tiles.push({ i, j, src: `https://tile.openstreetmap.org/${z}/${tx + i}/${ty + j}.png` });
  const href = `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=16/${d.lat}/${d.lng}`;
  return (
    <a className="b-loc" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      <div className="loc-map">
        <div className="loc-tiles" style={{ transform: `translate(calc(50% - ${(1 + fx) * 256}px), calc(50% - ${(1 + fy) * 256}px))` }} dir="ltr">
          {tiles.map((t) => <img key={`${t.i}${t.j}`} src={t.src} alt="" style={{ left: (t.i + 1) * 256, top: (t.j + 1) * 256 }} loading="lazy" referrerPolicy="no-referrer" />)}
        </div>
        <span className="loc-pin"><Icon name="mapPin" /></span>
      </div>
      <div className="loc-cap"><b>{d.name || 'موقعیت مکانی'}</b><span dir="ltr">{d.lat.toFixed(5)}, {d.lng.toFixed(5)}{d.acc ? ` ±${d.acc}m` : ''}</span></div>
    </a>
  );
}
function ContactCard({ d }) {
  const u = useStore((s) => s.users.get(d.user_id));
  return (
    <div className="b-contact">
      <Avatar src={u?.avatar} name={d.name} color={u?.color} size={44} />
      <span className="bc-info"><b>{d.name}</b><span dir="ltr">@{d.username}</span></span>
      {d.user_id !== meId() && <button type="button" className="poll-btn" onClick={(e) => { e.stopPropagation(); openPrivate(d.user_id); }}>پیام</button>}
    </div>
  );
}
function CallBubble({ m, out }) {
  const d = m.data || {};
  const ok = d.status === 'ended';
  const label = `${d.video ? 'تماس تصویری' : 'تماس صوتی'} ${out ? 'خروجی' : 'ورودی'}`;
  const sub = ok ? fmtDur(d.dur) : { missed: 'بی‌پاسخ', declined: 'رد شد', cancelled: 'لغو شد', busy: 'مشغول', offline: 'در دسترس نبود', failed: 'ناموفق' }[d.status] || '';
  const peer = out ? null : userOf(m.sender_id);
  return (
    <div className="b-call">
      <button type="button" className={cx('call-ic', !ok && !out && 'bad')} aria-label="تماس دوباره" onClick={(e) => { e.stopPropagation(); const c = getState().chats.get(m.chat_id); const u = userOf(c?.peer_id) || peer; if (u) startCall(u, !!d.video); }}>
        <Icon name={d.video ? 'video' : 'phone'} />
      </button>
      <span className="bc-info"><b>{label}</b><span className={cx(!ok && !out && 'bad')}><Icon name={out ? 'arrowUpRight' : 'download'} />{sub}<Spacer m={m} out={out} /></span></span>
    </div>
  );
}

function Reactions({ m, c }) {
  const users = useStore((s) => s.users);
  return (
    <div className="b-reacts">
      {Object.entries(m.reactions).map(([e, v]) => (
        <button key={e} type="button" className={cx('react', v.me && 'mine')} onClick={(ev) => { ev.stopPropagation(); react(m, e); }} aria-label={`${e} ${fa(v.n)}`}>
          <span className="re-e">{e}</span>
          {v.users && v.n <= 3 && c.type !== 'channel'
            ? <span className="re-avs">{v.users.map((u) => { const x = users.get(u) || (u === meId() ? getState().me : null); return <Avatar key={u} src={x?.avatar} name={x?.name} color={x?.color} size={18} />; })}</span>
            : <span className="re-n">{fmtNum(v.n)}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ audio file player */
let afPlaying = null;
function AudioFileBox({ m }) {
  const d = m.data || {};
  const a = useRef(null);
  const [st, setSt] = useState({ play: false, t: 0, dur: 0, speed: settings().voicePlaybackSpeed || 1 });
  useEffect(() => () => { if (afPlaying === a.current) afPlaying = null; a.current?.pause(); }, []);
  useEffect(() => { if (a.current) a.current.playbackRate = st.speed; }, [st.speed]);
  const toggle = (e) => {
    e.stopPropagation();
    if (m.pending) { cancelUpload(m.id); return; }
    const el = a.current; if (!el) return;
    if (el.paused) {
      if (afPlaying && afPlaying !== el) afPlaying.pause();
      afPlaying = el;
      el.playbackRate = st.speed;
      el.play().catch(() => toast('پخش ممکن نشد.', 'error'));
    } else el.pause();
  };
  const seek = (e) => {
    e.stopPropagation();
    const el = a.current; if (!el || !el.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (r.right - e.clientX) / r.width;
    el.currentTime = Math.max(0, Math.min(1, x)) * el.duration;
  };
  const cycleSpeed = (e) => {
    e.stopPropagation();
    setSt((s) => {
      const next = SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length];
      setSetting('voicePlaybackSpeed', next);
      return { ...s, speed: next };
    });
  };
  const p = st.dur ? Math.min(1, st.t / st.dur) : 0;
  const ext = (d.name || '').split('.').pop()?.slice(0, 4).toUpperCase() || 'AUDIO';
  const fmtDur2 = (s) => {
    if (!s || !Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  return (
    <div className="b-file b-audio">
      <button type="button" className="af-play" onClick={toggle} aria-label={st.play ? 'توقف' : 'پخش'}>
        {m.pending ? <Spinner size={22} /> : <Icon name={st.play ? 'pause' : 'play'} fill="currentColor" />}
      </button>
      <div className="af-body">
        <div className="af-info">
          <span className="af-title" dir="auto" title={d.name}>{d.name}</span>
          <span className="af-meta">{m.pending ? `${fmtSize(Math.round((m.progress || 0) * d.size))} از ${fmtSize(d.size)}` : `${fmtSize(d.size)} · ${ext}`}</span>
        </div>
        <div className="af-wave" onClick={seek} role="slider" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="پیشرفت پخش" tabIndex={0}>
          <span className="af-progress" style={{ width: `${Math.max(p * 100, 2)}%` }} />
          <span className="af-thumb" style={{ right: `${p * 100}%` }} />
        </div>
        <div className="af-foot">
          <span className="af-time">{fmtDur2(st.play || st.t ? st.t : 0)} / {fmtDur2(st.dur)}</span>
          <button type="button" className="v-speed" onClick={cycleSpeed} aria-label="سرعت پخش">{st.speed}×</button>
        </div>
      </div>
      {!m.pending && (
        <a className="file-ic af-dl" href={assetUrl(d.url)} download={d.name} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label="دانلود"><Icon name="download" /></a>
      )}
      {!m.pending && <audio ref={a} src={assetUrl(d.url)} preload="metadata"
        onPlay={() => setSt((s) => ({ ...s, play: true }))}
        onPause={() => setSt((s) => ({ ...s, play: false }))}
        onEnded={() => setSt((s) => ({ ...s, play: false, t: 0 }))}
        onTimeUpdate={() => { const el = a.current; if (el) setSt((s) => ({ ...s, t: el.currentTime })); }}
        onLoadedMetadata={() => { const el = a.current; const du = el && el.duration; setSt((s) => ({ ...s, dur: Number.isFinite(du) ? du : 0 })); }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ self-destructing timer */
function TtlTimer({ m }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!m.expires_at) return;
    const iv = setInterval(() => {
      const left = m.expires_at - Date.now();
      if (left <= 0) { clearInterval(iv); return; }
      force((x) => x + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, [m.expires_at]);
  if (!m.expires_at) return null;
  const left = Math.max(0, Math.ceil((m.expires_at - Date.now()) / 1000));
  if (left <= 0) return null;
  const fmtTtl = (s) => s < 60 ? `${fa(s)} ثانیه` : s < 3600 ? `${fa(Math.ceil(s / 60))} دقیقه` : s < 86400 ? `${fa(Math.ceil(s / 3600))} ساعت` : `${fa(Math.ceil(s / 86400))} روز`;
  return <span className="b-ttl" title="زمان باقی‌مانده تا حذف"><Icon name="shield" className="m-ic" />{fmtTtl(left)}</span>;
}

/* ------------------------------------------------------------------ message context menu */
export function msgMenu(e, m, c) {
  if (getState().select) return;
  const mine = m.sender_id === meId();
  const admin = ['owner', 'admin'].includes(c.role);
  const canPost = c.member && !c.frozen && (c.type !== 'channel' || admin);
  const canPin = c.type === 'private' || c.type === 'saved' || admin;
  const canEdit = mine && ['text', 'image', 'video', 'file'].includes(m.type) && Date.now() - m.created_at < 48 * 3600e3 && m.id > 0 && !m.fwd;
  const copyText = m.text || (m.type === 'location' ? `${m.data.lat},${m.data.lng}` : '');
  if (m.id < 0) {
    openMenu(e, [
      m.failed && { icon: 'refresh', label: 'ارسال دوباره', onClick: () => retryMessage(m) },
      { icon: 'trash', danger: true, label: m.pending ? 'لغو' : 'حذف', onClick: () => { if (m.pending) cancelUpload(m.id); deleteMessages([m.id]); } },
    ]);
    return;
  }
  openMenu(e, [
    canPost && { icon: 'reply', label: 'پاسخ', onClick: () => setState({ reply: m, edit: null }) },
    canEdit && { icon: 'pencil', label: 'ویرایش', onClick: () => setState({ edit: m, reply: null }) },
    copyText && { icon: 'copy', label: 'کپی متن', onClick: () => navigator.clipboard?.writeText(copyText).then(() => toast('کپی شد.', 'ok'), () => toast('کپی ممکن نشد.', 'error')) },
    m.data?.url && { icon: 'download', label: 'دانلود', onClick: () => { const a = document.createElement('a'); a.href = assetUrl(m.data.url); a.download = m.data.name || 'file'; a.target = '_blank'; a.rel = 'noopener'; a.click(); } },
    m.type === 'gif' && Number.isInteger(m.data?.gif) && m.data.gif >= 0 && m.data.gif < 16 && {
      icon: 'bookmark', label: isGifSaved(m.data.gif) ? 'حذف از گیف‌های من' : 'افزودن به گیف‌های من',
      onClick: () => toggleSavedGif(m.data.gif),
    },
    canPin && { icon: 'pin', label: m.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن', onClick: () => pinMessage(m, !m.pinned) },
    { icon: 'forward', label: 'بازارسال', onClick: () => openModal({ type: 'forward', chatId: c.id, ids: [m.id] }) },
    c.type !== 'saved' && { icon: 'bookmark', label: 'ذخیره در پیام‌های ذخیره‌شده', onClick: () => { const s = [...getState().chats.values()].find((x) => x.type === 'saved'); if (s) forwardMessages(c.id, [m.id], [s.id]); } },
    { icon: 'select', label: 'انتخاب', onClick: () => setState({ select: new Set([m.id]) }) },
    { icon: 'info', label: fmtFull(m.created_at), disabled: true },
    !mine && c.type !== 'saved' && { icon: 'flag', label: 'گزارش', onClick: () => openModal({ type: 'report', kind: 'message', targetId: m.id }) },
    { sep: true },
    { icon: 'trash', danger: true, label: 'حذف', onClick: async () => {
      const canAll = (mine || admin) && c.type !== 'saved' && c.type !== 'channel';
      const peerName = c.type === 'private' ? userName(userOf(c.peer_id)) : 'همه';
      const r = await confirmDialog({ title: 'حذف پیام', text: 'این پیام حذف شود؟', ok: 'حذف', danger: true, check: canAll ? `حذف برای ${peerName}${c.type === 'private' ? ' هم' : ''}` : null });
      if (r) deleteMessages([m.id], c.type === 'channel' ? admin : !!r.check);
    } },
  ], { reactions: m.type !== 'service' && c.member ? QUICK.slice(0, 7) : null, onReact: (em) => react(m, em) });
}
