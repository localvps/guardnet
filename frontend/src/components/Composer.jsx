import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, setState, getState, toast } from '../lib/store.js';
import { sendMessage, sendFile, editMessage, sendTyping, getDraft, setDraft, userName, userOf, openModal, settings, setSetting, meId } from '../lib/actions.js';
import { api } from '../lib/api.js';
import { cx, fmtDur, previewText } from '../lib/format.jsx';
import { Icon, IconBtn, Avatar } from './ui.jsx';
import { openMenu } from './overlay.jsx';
import EmojiPanel from './Emoji.jsx';

export default function Composer({ c }) {
  const reply = useStore((s) => s.reply);
  const edit = useStore((s) => s.edit);
  const [text, setText] = useState(() => getDraft(c.id));
  const [emoji, setEmoji] = useState(false);
  const [rec, setRec] = useState(null);
  const [mention, setMention] = useState(null);
  const [ttl, setTtl] = useState(0);
  const ta = useRef(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const sendBtn = useRef(null);
  const attachBtn = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => { if (edit) { setText(edit.text || ''); ta.current?.focus(); } }, [edit]);
  useEffect(() => { if (reply) ta.current?.focus(); }, [reply]);
  useEffect(() => { if (window.matchMedia('(pointer:fine)').matches) ta.current?.focus(); }, [c.id]);
  useLayoutEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);
  useEffect(() => () => sendTyping(c.id, 'text', true), [c.id]);

  const onChange = (v) => {
    setText(v);
    if (!edit) setDraft(c.id, v);
    if (v.trim()) sendTyping(c.id);
    // @mention autocomplete (groups)
    const el = ta.current; const pos = el?.selectionStart ?? v.length;
    const mm = /(^|\s)@([A-Za-z0-9_]{0,32})$/.exec(v.slice(0, pos));
    if (mm && c.type === 'group') setMention({ q: mm[2].toLowerCase(), start: pos - mm[2].length - 1 });
    else setMention(null);
  };
  const cancelEdit = () => { setState({ edit: null }); setText(getDraft(c.id)); };

  async function submit(opts = {}) {
    const t = text.trim();
    if (edit) {
      if (!t && edit.type === 'text') return;
      if (t !== (edit.text || '').trim()) { const ok = await editMessage(edit.id, t); if (!ok) return; }
      setState({ edit: null }); setText(getDraft(c.id) || ''); return;
    }
    if (!t) return;
    if ([...t].length > 4096) { toast('متن پیام حداکثر ۴۰۹۶ نویسه است.', 'error'); return; }
    const r = reply;
    setText(''); setDraft(c.id, ''); setState({ reply: null }); setMention(null);
    sendTyping(c.id, 'text', true);
    if (c.draft) api(`/chats/${c.id}/me`, { method: 'PATCH', body: { draft: '' } }).catch(() => {});
    await sendMessage(c.id, { text: t, reply_to: r?.id, ttl: c.type === 'private' ? ttl : 0, ...opts });
  }
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const enter = settings().sendEnter;
      if ((enter && !e.ctrlKey && !e.metaKey) || (!enter && (e.ctrlKey || e.metaKey))) { e.preventDefault(); submit(); }
    } else if (e.key === 'Escape') {
      if (edit) { e.preventDefault(); cancelEdit(); } else if (reply) { e.preventDefault(); setState({ reply: null }); }
    } else if (e.key === 'ArrowUp' && !text) {
      const list = getState().msgs.get(c.id)?.list || [];
      const last = [...list].reverse().find((m) => m.sender_id === meId() && m.type === 'text' && m.id > 0 && Date.now() - m.created_at < 48 * 3600e3);
      if (last) { e.preventDefault(); setState({ edit: last, reply: null }); }
    }
  };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); openModal({ type: 'sendFiles', chatId: c.id, files, caption: text }); }
  };
  const insert = (s) => {
    const el = ta.current; const a = el?.selectionStart ?? text.length; const b = el?.selectionEnd ?? text.length;
    const v = text.slice(0, a) + s + text.slice(b);
    onChange(v);
    requestAnimationFrame(() => { if (el) { el.focus({ preventScroll: true }); el.selectionStart = el.selectionEnd = a + s.length; } });
  };
  const TTL_OPTS = [
    [0, 'بدون خودمخفی'], [3, '۳ ثانیه'], [10, '۱۰ ثانیه'], [30, '۳۰ ثانیه'],
    [60, '۱ دقیقه'], [300, '۵ دقیقه'], [3600, '۱ ساعت'], [86400, '۲۴ ساعت'], [604800, '۷ روز'],
  ];
  const sendMenu = (e) => openMenu(e, [
    { icon: 'bellOff', label: 'ارسال بی‌صدا', onClick: () => submit({ silent: true }) },
    { icon: 'clock', label: 'زمان‌بندی پیام', onClick: () => openModal({ type: 'schedule', onPick: (ts) => submit({ sched_at: ts }) }) },
    ...(c.type === 'private' ? [{ sep: true }, ...TTL_OPTS.map(([v, l]) => ({ icon: v === ttl ? 'check' : 'shield', label: l, onClick: () => setTtl(v) }))] : []),
  ], { anchor: sendBtn.current });
  const attachMenu = (e) => openMenu(e, [
    { icon: 'image', label: 'عکس یا ویدیو', onClick: () => mediaRef.current?.click() },
    { icon: 'file', label: 'فایل', onClick: () => fileRef.current?.click() },
    { icon: 'poll', label: 'نظرسنجی', onClick: () => openModal({ type: 'poll', chatId: c.id }) },
    { icon: 'mapPin', label: 'موقعیت مکانی', onClick: () => openModal({ type: 'location', chatId: c.id }) },
    { icon: 'contact', label: 'مخاطب', onClick: () => openModal({ type: 'shareContact', chatId: c.id }) },
  ], { anchor: attachBtn.current, alignStart: true });
  const pickFiles = (e, asFile) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (files.length) openModal({ type: 'sendFiles', chatId: c.id, files, asFile, caption: text });
  };

  /* ------------------------------ voice recording */
  async function startRec() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند.', 'error'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { toast('دسترسی به میکروفون داده نشد.', 'error'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = []; const peaks = [];
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
    const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const started = Date.now();
    const state = { mr, stream, ac, chunks, peaks, started, level: 0, cancel: false };
    const sample = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let max = 0; for (const v of buf) max = Math.max(max, Math.abs(v - 128));
      const lv = Math.min(1, max / 90); peaks.push(lv);
      setRec((r) => (r ? { ...r, t: (Date.now() - started) / 1000, level: lv } : r));
      sendTyping(c.id, 'voice');
    }, 100);
    state.sample = sample;
    mr.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    mr.onstop = async () => {
      clearInterval(sample); stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {});
      sendTyping(c.id, 'voice', true);
      const dur = (Date.now() - started) / 1000;
      if (state.cancel || dur < 0.7) { setRec(null); if (!state.cancel) toast('برای ضبط، کمی بیشتر نگه دارید.'); return; }
      const type = (mr.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type });
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
      const wave = []; const step = peaks.length / 48;
      for (let i = 0; i < 48; i++) { const s = peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1)); wave.push(s.length ? Math.max(...s) : 0); }
      setRec(null);
      const r = getState().reply; setState({ reply: null });
      await sendFile(c.id, file, { kind: 'voice', reply_to: r?.id, extra: { dur: Math.round(dur), wave } });
    };
    mr.start(250);
    setRec({ t: 0, level: 0, state });
  }
  const stopRec = (cancel) => { if (!rec) return; rec.state.cancel = cancel; try { rec.state.mr.stop(); } catch { setRec(null); } };
  useEffect(() => () => { if (rec) { rec.state.cancel = true; try { rec.state.mr.stop(); } catch { /* */ } } }, []); // eslint-disable-line

  const mentionList = mention ? mentionCandidates(c, mention.q) : [];
  const hasText = !!text.trim();
  return (
    <div className="composer-wrap" ref={wrapRef}>
      {mentionList.length > 0 && (
        <div className="mention-list glass">
          {mentionList.map((u) => (
            <button key={u.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => {
              const v = `${text.slice(0, mention.start)}@${u.username} ${text.slice(ta.current?.selectionStart ?? text.length)}`;
              onChange(v); setMention(null); ta.current?.focus();
            }}>
              <Avatar src={u.avatar} name={u.name} color={u.color} size={30} /><span className="ml-name">{userName(u)}</span><span className="ml-user" dir="ltr">@{u.username}</span>
            </button>
          ))}
        </div>
      )}
      {(reply || edit) && (
        <div className="compose-ctx glass">
          <Icon name={edit ? 'pencil' : 'reply'} className="cc-ic" />
          <div className="cc-body">
            <div className="cc-title">{edit ? 'ویرایش پیام' : `پاسخ به ${userName(userOf(reply.sender_id))}`}</div>
            <div className="cc-text">{previewText(edit || reply)}</div>
          </div>
          <IconBtn icon="x" label="لغو" onClick={() => (edit ? cancelEdit() : setState({ reply: null }))} />
        </div>
      )}
      {ttl > 0 && c.type === 'private' && !edit && (
        <div className="compose-ctx glass ttl-bar">
          <Icon name="shield" className="cc-ic" />
          <div className="cc-body">
            <div className="cc-title">پیام خودمخفی</div>
            <div className="cc-text">پس از {TTL_OPTS.find((x) => x[0] === ttl)?.[1]} حذف می‌شود</div>
          </div>
          <IconBtn icon="x" label="لغو" onClick={() => setTtl(0)} />
        </div>
      )}
      <div className={cx('composer glass', rec && 'recording')}>
        {rec ? (
          <>
            <span className="rec-dot" style={{ transform: `scale(${1 + rec.level * 0.8})` }} />
            <span className="rec-time">{fmtDur(rec.t)}</span>
            <button type="button" className="rec-cancel" onClick={() => stopRec(true)}>لغو</button>
          </>
        ) : (
          <>
            <IconBtn icon="smile" label="شکلک و استیکر" active={emoji} onClick={() => setEmoji(!emoji)} className="emoji-toggle" />
            <textarea ref={ta} className="compose-input" rows={1} dir="auto" value={text} placeholder={c.type === 'channel' ? 'انتشار پیام…' : 'پیام'} aria-label="متن پیام"
              onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} onPaste={onPaste} maxLength={8000} onFocus={() => { if (window.innerWidth <= 720) setEmoji(false); }} />
            {!edit && <IconBtn ref={attachBtn} icon="clip" label="پیوست" onClick={attachMenu} />}
            <input ref={mediaRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pickFiles(e, false)} />
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => pickFiles(e, true)} />
          </>
        )}
      </div>
      {rec ? (
        <button type="button" className="send-btn rec" onClick={() => stopRec(false)} aria-label="ارسال پیام صوتی"><Icon name="send2" /></button>
      ) : hasText || edit ? (
        <button ref={sendBtn} type="button" className="send-btn" onClick={() => submit()} onContextMenu={(e) => { e.preventDefault(); if (!edit) sendMenu(e); }} aria-label={edit ? 'ذخیره' : 'ارسال'}>
          <Icon name={edit ? 'check' : 'send2'} />
        </button>
      ) : (
        <button type="button" className="send-btn mic" onClick={startRec} aria-label="ضبط پیام صوتی"><Icon name="mic" /></button>
      )}
      {emoji && !rec && <EmojiPanel onClose={() => setEmoji(false)} onEmoji={insert} chat={c}
        onSticker={(sticker) => { const r = getState().reply; setState({ reply: null }); sendMessage(c.id, { type: 'sticker', data: typeof sticker === 'string' ? { e: sticker } : sticker, reply_to: r?.id }); if (window.innerWidth <= 720) setEmoji(false); }}
        onGif={(g) => { sendMessage(c.id, { type: 'gif', data: g }); setEmoji(false); }} />}
    </div>
  );
}

function mentionCandidates(c, q) {
  const st = getState();
  const full = st.chatMembers?.get(c.id);
  const ids = full || [...new Set((st.msgs.get(c.id)?.list || []).map((m) => m.sender_id))];
  return ids.map((id) => st.users.get(id)).filter((u) => u && u.id !== st.me.id && !u.deleted && u.username && (!q || u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().includes(q))).slice(0, 6);
}
export { setSetting };
