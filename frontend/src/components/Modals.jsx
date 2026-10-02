import { useEffect, useMemo, useState } from 'react';
import { useStore, setState, getState, putChat, toast } from '../lib/store.js';
import { closeModal, sendFile, sendMessage, forwardMessages, sortedChats, chatTitle, chatAvatarProps, openChat, loadStories, settings, setSetting, userName } from '../lib/actions.js';
import { api, uploadFile } from '../lib/api.js';
import { cx, fa, fmtSize, fmtFull, previewText } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, Field, Button, Toggle, Check, Radio, Spinner, Empty, NameLine } from './ui.jsx';
import { Modal } from './overlay.jsx';
import { putUsers as _putUsers } from '../lib/store.js';
import { openPrivate as _openPrivate } from '../lib/actions.js';
import { UserPicker } from './Views.jsx';
import { LinkDevice } from './Settings.jsx';

export default function Modals() {
  const m = useStore((s) => s.modal);
  if (!m) return null;
  switch (m.type) {
    case 'sendFiles': return <SendFiles m={m} />;
    case 'poll': return <PollModal m={m} />;
    case 'schedule': return <ScheduleModal m={m} />;
    case 'scheduled': return <ScheduledList m={m} />;
    case 'location': return <LocationModal m={m} />;
    case 'addContact': return <AddContactModal />;
    case 'shareContact': return <Modal title="ارسال مخاطب" onClose={closeModal} noPad><UserPicker multi={false} onPick={([u]) => { sendMessage(m.chatId, { type: 'contact', data: { user_id: u.id } }); closeModal(); }} /></Modal>;
    case 'forward': return <ForwardModal m={m} />;
    case 'report': return <ReportModal m={m} />;
    case 'inviteLink': return <InviteLink m={m} />;
    case 'invite': return <JoinInvite m={m} />;
    case 'qrApprove': return <LinkDevice token={m.token} onClose={closeModal} />;
    case 'storyCreate': return <StoryCreate />;
    case 'addToFolder': return <AddToFolder m={m} />;
    default: return null;
  }
}

/* ------------------------------------------------------------------ send files */
function SendFiles({ m }) {
  const [files, setFiles] = useState(m.files);
  const [caption, setCaption] = useState(m.caption || '');
  const [asFile, setAsFile] = useState(!!m.asFile);
  const [spoiler, setSpoiler] = useState(false);
  const previews = useMemo(() => files.map((f) => ((f.type.startsWith('image/') || f.type.startsWith('video/')) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  const media = files.every((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
  const send = () => {
    const reply = getState().reply; setState({ reply: null });
    files.forEach((f, i) => sendFile(m.chatId, f, { caption: i === files.length - 1 ? caption.trim() : '', reply_to: i === 0 ? reply?.id : undefined, spoiler: spoiler && !asFile, kind: asFile ? 'file' : undefined }));
    closeModal();
  };
  if (!files.length) { closeModal(); return null; }
  return (
    <Modal title={`ارسال ${fa(files.length)} ${media && !asFile ? 'رسانه' : 'فایل'}`} onClose={closeModal}
      footer={<><button type="button" className="btn btn-text" onClick={closeModal}>انصراف</button><button type="button" className="btn btn-text primary" onClick={send}>ارسال</button></>}>
      <div className={cx('sf-list', media && !asFile && 'grid')}>
        {files.map((f, i) => (
          <div key={i} className="sf-item">
            {previews[i] && !asFile ? (f.type.startsWith('image/') ? <img src={previews[i]} alt="" className={cx(spoiler && 'blur')} /> : <video src={previews[i]} muted className={cx(spoiler && 'blur')} />)
              : <span className="sf-file"><span className="file-ic"><Icon name="file" /></span><span className="file-info"><span className="file-name" dir="auto">{f.name}</span><span className="file-size">{fmtSize(f.size)}</span></span></span>}
            <button type="button" className="sf-rm" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="حذف"><Icon name="x" /></button>
          </div>
        ))}
      </div>
      {media && <div className="row clickable" onClick={() => setAsFile(!asFile)}><span className="row-body"><span className="row-title">ارسال بدون فشرده‌سازی (به‌صورت فایل)</span></span><Check checked={asFile} /></div>}
      {media && !asFile && <div className="row clickable" onClick={() => setSpoiler(!spoiler)}><span className="row-body"><span className="row-title">پنهان کردن با اسپویلر</span></span><Check checked={spoiler} /></div>}
      <Field label="توضیح (اختیاری)" value={caption} onChange={setCaption} maxLength={4096} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ poll */
function PollModal({ m }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [anon, setAnon] = useState(true);
  const [multi, setMulti] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [explain, setExplain] = useState('');
  const [err, setErr] = useState('');
  const setOpt = (i, v) => { const o = opts.slice(); o[i] = v; if (i === o.length - 1 && v && o.length < 10) o.push(''); setOpts(o); };
  const valid = opts.map((o) => o.trim()).filter(Boolean);
  const send = async () => {
    if (!q.trim()) { setErr('سؤال را بنویسید'); return; }
    if (valid.length < 2) { setErr('دست‌کم دو گزینه لازم است'); return; }
    const r = await sendMessage(m.chatId, { type: 'poll', data: { q: q.trim(), opts: valid, anon, multi: quiz ? false : multi, quiz, correct: quiz ? Math.min(correct, valid.length - 1) : undefined, explain: quiz ? explain : undefined } });
    if (r) closeModal();
  };
  return (
    <Modal title="نظرسنجی جدید" onClose={closeModal} footer={<><button type="button" className="btn btn-text" onClick={closeModal}>انصراف</button><button type="button" className="btn btn-text primary" onClick={send}>ارسال</button></>}>
      <Field label="سؤال" value={q} onChange={(v) => { setQ(v); setErr(''); }} maxLength={255} error={err} autoFocus />
      <div className="sec-title">گزینه‌ها</div>
      {opts.map((o, i) => (
        <div key={i} className="poll-edit-opt">
          {quiz && <button type="button" className="po-correct" onClick={() => setCorrect(i)} aria-label="گزینه درست"><Radio checked={correct === i} /></button>}
          <Field label={`گزینه ${fa(i + 1)}`} value={o} onChange={(v) => setOpt(i, v)} maxLength={100} />
          {opts.length > 2 && o && <IconBtn icon="x" label="حذف گزینه" onClick={() => setOpts(opts.filter((_, j) => j !== i))} />}
        </div>
      ))}
      <div className="sec-title">تنظیمات</div>
      <div className="row clickable" onClick={() => setAnon(!anon)}><span className="row-body"><span className="row-title">رأی‌گیری ناشناس</span></span><Toggle checked={anon} onChange={setAnon} /></div>
      {!quiz && <div className="row clickable" onClick={() => setMulti(!multi)}><span className="row-body"><span className="row-title">چند پاسخی</span></span><Toggle checked={multi} onChange={setMulti} /></div>}
      <div className="row clickable" onClick={() => setQuiz(!quiz)}><span className="row-body"><span className="row-title">حالت آزمون</span><span className="row-sub">یک پاسخ درست دارد</span></span><Toggle checked={quiz} onChange={setQuiz} /></div>
      {quiz && <Field label="توضیح پاسخ (اختیاری)" value={explain} onChange={setExplain} maxLength={200} />}
    </Modal>
  );
}

/* ------------------------------------------------------------------ schedule */
function pad(n) { return String(n).padStart(2, '0'); }
function ScheduleModal({ m }) {
  const now = new Date(Date.now() + 10 * 60e3);
  const [date, setDate] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const [time, setTime] = useState(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  const [err, setErr] = useState('');
  const ts = new Date(`${date}T${time}`).getTime();
  const go = () => {
    if (!Number.isFinite(ts) || ts < Date.now() + 30e3) { setErr('زمانی در آینده انتخاب کنید'); return; }
    m.onPick(ts); closeModal();
  };
  const quick = [[60, 'یک ساعت بعد'], [180, 'سه ساعت بعد'], [24 * 60, 'فردا همین موقع']];
  return (
    <Modal title="زمان‌بندی پیام" onClose={closeModal} footer={<><button type="button" className="btn btn-text" onClick={closeModal}>انصراف</button><button type="button" className="btn btn-text primary" onClick={go}>زمان‌بندی</button></>}>
      <div className="quick-chips">{quick.map(([min, l]) => <button key={min} type="button" className="chip" onClick={() => { m.onPick(Date.now() + min * 60e3); closeModal(); }}>{l}</button>)}</div>
      <div className="dt-row">
        <label className="dt"><span>تاریخ</span><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} dir="ltr" /></label>
        <label className="dt"><span>ساعت</span><input type="time" value={time} onChange={(e) => { setTime(e.target.value); setErr(''); }} dir="ltr" /></label>
      </div>
      {Number.isFinite(ts) && <p className="muted-note">ارسال در: {fmtFull(ts)}</p>}
      {err && <p className="auth-err">{err}</p>}
    </Modal>
  );
}
function ScheduledList({ m }) {
  const [list, setList] = useState(null);
  const load = () => api(`/chats/${m.chatId}/scheduled`).then((r) => setList(r.messages)).catch(() => setList([]));
  useEffect(() => { load(); }, []); // eslint-disable-line
  return (
    <Modal title="پیام‌های زمان‌بندی‌شده" onClose={closeModal}>
      {list === null && <div className="list-loading"><Spinner /></div>}
      {list?.length === 0 && <Empty icon="clock" title="پیام زمان‌بندی‌شده‌ای نیست" sub="روی دکمه ارسال راست‌کلیک (یا نگه دارید) و «زمان‌بندی پیام» را بزنید." />}
      {list?.map((x) => (
        <div key={x.id} className="row">
          <span className="row-ic"><Icon name="clock" /></span>
          <span className="row-body"><span className="row-title">{previewText(x)}</span><span className="row-sub">{fmtFull(x.sched_at)}</span></span>
          <IconBtn icon="send2" label="ارسال همین حالا" onClick={async () => { try { await api(`/messages/${x.id}/send-now`, { method: 'POST', body: {} }); load(); } catch (e) { toast(e.message, 'error'); } }} />
          <IconBtn icon="trash" label="حذف" className="danger" onClick={async () => { try { await api('/messages/delete', { method: 'POST', body: { ids: [x.id], for_all: true } }); load(); } catch (e) { toast(e.message, 'error'); } }} />
        </div>
      ))}
    </Modal>
  );
}

/* ------------------------------------------------------------------ location */
function LocationModal({ m }) {
  const [st, setSt] = useState('locating');
  const [pos, setPos] = useState(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!navigator.geolocation) { setSt('error'); return; }
    navigator.geolocation.getCurrentPosition((p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setSt('ok'); }, () => setSt('error'), { enableHighAccuracy: true, timeout: 15000 });
  }, []);
  const send = () => { sendMessage(m.chatId, { type: 'location', data: { ...pos, name } }); closeModal(); };
  return (
    <Modal title="ارسال موقعیت مکانی" onClose={closeModal} footer={<><button type="button" className="btn btn-text" onClick={closeModal}>انصراف</button><button type="button" className="btn btn-text primary" disabled={st !== 'ok'} onClick={send}>ارسال موقعیت</button></>}>
      {st === 'locating' && <div className="loc-wait"><Spinner size={28} /><span>در حال یافتن موقعیت شما…</span></div>}
      {st === 'error' && <div className="loc-wait"><Icon name="alert" /><span>دسترسی به موقعیت مکانی ممکن نشد. اجازه دسترسی مرورگر را بررسی کنید.</span></div>}
      {st === 'ok' && (
        <>
          <div className="loc-wait ok"><Icon name="mapPin" /><span dir="ltr">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} (±{Math.round(pos.acc)}m)</span></div>
          <Field label="نام مکان (اختیاری)" value={name} onChange={setName} maxLength={120} />
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ forward */
function ForwardModal({ m }) {
  const chats = useStore((s) => s.chats);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = sortedChats(chats).filter((c) => (c.type !== 'channel' || ['owner', 'admin'].includes(c.role)) && !c.frozen && chatTitle(c).toLowerCase().includes(q.toLowerCase()));
  const send = async () => {
    setBusy(true);
    await forwardMessages(m.chatId, m.ids, sel, hide);
    setBusy(false); closeModal(); setState({ select: null });
    if (sel.length === 1) openChat(sel[0]);
  };
  return (
    <Modal title="بازارسال به…" onClose={closeModal} noPad footer={<><div className="row clickable fwd-hide" onClick={() => setHide(!hide)}><Check checked={hide} /><span className="row-title">پنهان کردن نام فرستنده</span></div><button type="button" className="btn btn-primary" disabled={!sel.length || busy} onClick={send}>{busy ? <Spinner size={18} /> : `ارسال${sel.length ? ` (${fa(sel.length)})` : ''}`}</button></>}>
      <div className="side-search"><div className="search-box active"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" autoFocus /></div></div>
      <div className="picker-list scroll">
        {list.map((c) => { const on = sel.includes(c.id); return (
          <div key={c.id} className="chat-item compact" onClick={() => setSel(on ? sel.filter((x) => x !== c.id) : [...sel, c.id].slice(0, 20))}>
            <Avatar {...chatAvatarProps(c)} size={44} />
            <div className="ci-body"><div className="ci-top"><span className="ci-title"><NameLine name={chatTitle(c)} /></span></div></div>
            <Check checked={on} />
          </div>
        ); })}
        {!list.length && <Empty title="گفتگویی یافت نشد" />}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ report */
const REASONS = [['spam', 'هرزنامه'], ['violence', 'خشونت'], ['porn', 'محتوای مستهجن'], ['child', 'کودک‌آزاری'], ['copyright', 'نقض کپی‌رایت'], ['fake', 'جعل هویت'], ['scam', 'کلاهبرداری'], ['other', 'سایر']];
function ReportModal({ m }) {
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { const r = await api('/reports', { method: 'POST', body: { kind: m.kind, target_id: m.targetId, reason, note } }); toast(r.duplicate ? 'این مورد قبلاً گزارش شده است.' : 'گزارش شما ثبت شد و توسط تیم GuardNet بررسی می‌شود.', 'ok'); closeModal(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="گزارش" onClose={closeModal} footer={<><button type="button" className="btn btn-text" onClick={closeModal}>انصراف</button><button type="button" className="btn btn-text danger" disabled={busy} onClick={send}>{busy ? <Spinner size={18} /> : 'ارسال گزارش'}</button></>}>
      {REASONS.map(([k, l]) => <div key={k} className="row clickable" onClick={() => setReason(k)}><Radio checked={reason === k} /><span className="row-body"><span className="row-title">{l}</span></span></div>)}
      <Field label="توضیحات (اختیاری)" value={note} onChange={setNote} maxLength={500} textarea rows={2} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ invites */
function InviteLink({ m }) {
  const c = useStore((s) => s.chats.get(m.chatId));
  const [busy, setBusy] = useState(false);
  if (!c) return null;
  const link = c.invite ? `${location.origin}${location.pathname}#join/${c.invite}` : '';
  return (
    <Modal title="پیوند دعوت" onClose={closeModal}>
      <p className="dialog-text">هر کسی با این پیوند می‌تواند به «{c.title}» بپیوندد.</p>
      <div className="invite-box" dir="ltr">{link || '—'}</div>
      <div className="btn-row">
        <Button icon="copy" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('پیوند کپی شد.', 'ok'), () => toast('کپی ممکن نشد.', 'error'))}>کپی پیوند</Button>
        <Button kind="ghost" icon="refresh" loading={busy} onClick={async () => { setBusy(true); try { putChat(await api(`/chats/${c.id}/invite/reset`, { method: 'POST', body: {} })); toast('پیوند جدید ساخته شد؛ پیوند قبلی باطل شد.', 'ok'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }}>باطل کردن</Button>
      </div>
    </Modal>
  );
}
function JoinInvite({ m }) {
  const [c, setC] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/invite/${encodeURIComponent(m.code)}`).then(setC).catch((e) => setErr(e.message)); }, [m.code]);
  const join = async () => { setBusy(true); try { const r = await api(`/invite/${encodeURIComponent(m.code)}`, { method: 'POST', body: {} }); putChat(r); closeModal(); openChat(r.id); } catch (e) { setErr(e.message); setBusy(false); } };
  return (
    <Modal title="دعوت به گفتگو" onClose={closeModal}>
      {!c && !err && <div className="list-loading"><Spinner /></div>}
      {err && <Empty icon="alert" title="پیوند نامعتبر" sub={err} />}
      {c && (
        <div className="join-card">
          <Avatar src={c.photo} name={c.title} color={c.color} size={88} />
          <div className="ph-name">{c.title}</div>
          <div className="ph-status">{fa(c.members_count)} {c.type === 'channel' ? 'مشترک' : 'عضو'}</div>
          {c.description && <p className="dialog-text">{c.description}</p>}
          {c.member ? <Button full onClick={() => { closeModal(); openChat(c.id); }}>باز کردن</Button> : <Button full loading={busy} onClick={join}>{c.type === 'channel' ? 'عضویت در کانال' : 'پیوستن به گروه'}</Button>}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ story create */
const STORY_BG = [['#4f8cff', '#8b5cf6'], ['#f43f5e', '#f59e0b'], ['#10b981', '#06b6d4'], ['#6366f1', '#ec4899'], ['#0f172a', '#334155'], ['#f97316', '#facc15']];
function StoryCreate() {
  const [mode, setMode] = useState('text');
  const [t, setT] = useState(''); const [bg, setBg] = useState(0); const [file, setFile] = useState(null); const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const hours = getState().me?.limits?.story_hours || 24;
  const post = async () => {
    setBusy(true);
    try {
      if (mode === 'text') await api('/stories', { method: 'POST', body: { kind: 'text', data: { t, bg: STORY_BG[bg] } } });
      else { const f = await uploadFile(file); await api('/stories', { method: 'POST', body: { kind: file.type.startsWith('video/') ? 'video' : 'image', data: { file: f.id, cap } } }); }
      toast('استوری منتشر شد.', 'ok'); loadStories(); closeModal();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="استوری جدید" onClose={closeModal} footer={<><button type="button" className="btn btn-text" onClick={closeModal}>انصراف</button><button type="button" className="btn btn-text primary" disabled={busy || (mode === 'text' ? !t.trim() : !file)} onClick={post}>{busy ? <Spinner size={18} /> : 'انتشار'}</button></>}>
      <div className="seg">{[['text', 'متن'], ['media', 'عکس / ویدیو']].map(([k, l]) => <button key={k} type="button" className={cx(mode === k && 'on')} onClick={() => setMode(k)}>{l}</button>)}</div>
      {mode === 'text' ? (
        <>
          <div className="story-prev" style={{ background: `linear-gradient(135deg, ${STORY_BG[bg][0]}, ${STORY_BG[bg][1]})` }}><span>{t || 'متن استوری…'}</span></div>
          <div className="accent-row">{STORY_BG.map((g, i) => <button key={i} type="button" className={cx('accent-dot', bg === i && 'on')} style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }} onClick={() => setBg(i)} aria-label={`پس‌زمینه ${fa(i + 1)}`}>{bg === i && <Icon name="check" />}</button>)}</div>
          <Field label="متن" value={t} onChange={setT} maxLength={200} textarea rows={2} autoFocus />
        </>
      ) : (
        <>
          <label className="story-pick">
            {url ? (file.type.startsWith('video/') ? <video src={url} muted autoPlay loop playsInline /> : <img src={url} alt="" />) : <span><Icon name="image" />انتخاب عکس یا ویدیو</span>}
            <input type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
          </label>
          <Field label="توضیح (اختیاری)" value={cap} onChange={setCap} maxLength={200} />
        </>
      )}
      <p className="muted-note">استوری برای مخاطبین و افرادی که با آن‌ها گفتگو دارید به مدت {fa(hours)} ساعت نمایش داده می‌شود.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ add chat to folder */
function AddToFolder({ m }) {
  const me = useStore((s) => s.me);
  const folders = me.settings?.folders || [];
  const toggle = (f) => {
    const has = f.chats?.includes(m.chatId);
    setSetting('folders', folders.map((x) => (x.id === f.id ? { ...x, chats: has ? x.chats.filter((id) => id !== m.chatId) : [...(x.chats || []), m.chatId] } : x)));
  };
  return (
    <Modal title="افزودن به پوشه" onClose={closeModal}>
      {!folders.length && <Empty icon="folder" title="پوشه‌ای ندارید" sub="از تنظیمات › پوشه‌های گفتگو یک پوشه بسازید." />}
      {folders.map((f) => <div key={f.id} className="row clickable" onClick={() => toggle(f)}><span className="row-ic emoji">{f.emoji || '📁'}</span><span className="row-body"><span className="row-title">{f.name}</span></span><Check checked={!!f.chats?.includes(m.chatId)} /></div>)}
    </Modal>
  );
}
export { settings, userName };

function AddContactModal() {
  const [un, setUn] = useState(''); const [found, setFound] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const look = async () => {
    const name = un.trim().replace(/^@/, ''); if (!name) return;
    setBusy(true); setErr(''); setFound(null);
    try { const r = await api(`/resolve/${encodeURIComponent(name)}`); if (r.user) { _putUsers([r.user]); setFound(r.user); } else setErr('کاربری با این نام پیدا نشد.'); }
    catch (e) { setErr(e.message || 'کاربری با این نام پیدا نشد.'); }
    setBusy(false);
  };
  const add = async () => {
    try { _putUsers([await api(`/contacts/${found.id}`, { method: 'POST' })]); toast('به مخاطبین اضافه شد.', 'ok'); closeModal(); _openPrivate(found.id); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="افزودن مخاطب" onClose={closeModal}>
      <Field label="نام کاربری" value={un} onChange={(v) => { setUn(v.replace(/[^A-Za-z0-9_@]/g, '')); setErr(''); setFound(null); }} dir="ltr" maxLength={33} error={err} suffix={<span className="at">@</span>} />
      {found
        ? <div className="ac-found"><Avatar src={found.avatar} name={found.name} color={found.color} size={52} /><div className="ac-info"><b>{userName(found)}</b><span dir="ltr">@{found.username}</span></div><Button onClick={add}>{found.is_contact ? 'باز کردن گفتگو' : 'افزودن'}</Button></div>
        : <Button onClick={look} disabled={busy || !un.trim()}>{busy ? 'در حال جستجو…' : 'جستجو'}</Button>}
    </Modal>
  );
}
