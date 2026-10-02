import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, getState, putUsers, putChat, toast } from '../lib/store.js';
import { api, uploadFile } from '../lib/api.js';
import { openModal, popView, openPrivate, userName, lastSeenText, openChat, resetView, meId, sortedChats, peerOf } from '../lib/actions.js';
import { cx, fa, ago, fmtDur } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, NameLine, Empty, Spinner, Field, Check } from './ui.jsx';
import { openMenu, confirmDialog } from './overlay.jsx';
import { startCall } from './Calls.jsx';

export function SideHead({ title, children, onBack = popView }) {
  return (
    <header className="side-head glass-bar">
      <IconBtn icon="arrowRight" label="بازگشت" onClick={onBack} />
      <div className="side-title">{title}</div>
      {children}
    </header>
  );
}

/** Candidates = contacts + private-chat peers, plus global search results for the query. */
export function useUserSearch(q) {
  const chats = useStore((s) => s.chats);
  const [contacts, setContacts] = useState(null);
  const [global, setGlobal] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { api('/contacts').then((r) => { putUsers(r); setContacts(r); }).catch(() => setContacts([])); }, []);
  useEffect(() => {
    const s = q.trim().replace(/^@/, '');
    if (s.length < 2) { setGlobal([]); return undefined; }
    setLoading(true);
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(s)}`).then((r) => { putUsers(r.users); setGlobal(r.users); }).catch(() => {}).finally(() => setLoading(false)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const base = useMemo(() => {
    const map = new Map();
    (contacts || []).forEach((u) => map.set(u.id, u));
    sortedChats(chats).forEach((c) => { if (c.type === 'private') { const u = peerOf(c); if (u && !u.deleted && u.id !== meId()) map.set(u.id, map.get(u.id) || u); } });
    return [...map.values()];
  }, [contacts, chats]);
  const s = q.trim().toLowerCase().replace(/^@/, '');
  const local = s ? base.filter((u) => userName(u).toLowerCase().includes(s) || u.username?.toLowerCase().includes(s)) : base;
  const extra = global.filter((u) => u.id !== meId() && !local.some((x) => x.id === u.id));
  return { contacts, local, extra, loading: loading || contacts === null };
}

function UserRow({ u, onClick, right, sub }) {
  return (
    <div className="chat-item compact" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <Avatar src={u.avatar} name={u.name} color={u.color} size={46} online={u.online && !u.bot} />
      <div className="ci-body">
        <div className="ci-top"><span className="ci-title"><NameLine name={userName(u)} user={u} /></span></div>
        <div className="ci-bottom"><span className={cx('ci-text', u.online && 'online')}>{sub ?? lastSeenText(u)}</span></div>
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ contacts */
export function ContactsView() {
  const view = useStore((s) => s.view);
  const [q, setQ] = useState('');
  const { contacts, local, extra, loading } = useUserSearch(q);
  const users = useStore((s) => s.users);
  const shown = (view.pick ? local : local.filter((u) => contacts?.some((c) => c.id === u.id))).map((u) => users.get(u.id) || u)
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || userName(a).localeCompare(userName(b), 'fa'));
  const menu = (e, u) => openMenu(e, [
    { icon: 'send', label: 'ارسال پیام', onClick: () => openPrivate(u.id) },
    u.can_call && { icon: 'phone', label: 'تماس صوتی', onClick: () => startCall(u, false) },
    u.is_contact ? { icon: 'trash', danger: true, label: 'حذف از مخاطبین', onClick: async () => { try { putUsers([await api(`/contacts/${u.id}`, { method: 'DELETE' })]); toast('از مخاطبین حذف شد.', 'ok'); } catch (err) { toast(err.message, 'error'); } } }
      : { icon: 'userPlus', label: 'افزودن به مخاطبین', onClick: async () => { try { putUsers([await api(`/contacts/${u.id}`, { method: 'POST' })]); toast('به مخاطبین اضافه شد.', 'ok'); } catch (err) { toast(err.message, 'error'); } } },
  ]);
  return (
    <div className="side-view">
      <SideHead title={view.pick ? 'پیام جدید' : 'مخاطبین'} />
      <div className="side-search"><div className="search-box active"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام یا نام کاربری" autoFocus={window.matchMedia('(pointer:fine)').matches} />{q && <button type="button" className="search-clear" onClick={() => setQ('')} aria-label="پاک کردن"><Icon name="x" /></button>}</div></div>
      <div className="chat-list scroll">
        {!view.pick && <button type="button" className="add-contact-row" onClick={() => openModal({ type: 'addContact' })}><span className="acr-ic"><Icon name="userPlus" /></span><span>افزودن مخاطب</span></button>}
        {shown.map((u) => <UserRow key={u.id} u={u} onClick={() => openPrivate(u.id)} right={<IconBtn icon="more" label="گزینه‌ها" onClick={(e) => { e.stopPropagation(); menu(e, u); }} />} />)}
        {extra.length > 0 && <div className="sec-title">جستجوی سراسری</div>}
        {extra.map((u) => <UserRow key={u.id} u={u} sub={<span dir="ltr">@{u.username}</span>} onClick={() => openPrivate(u.id)} />)}
        {loading && <div className="list-loading"><Spinner /></div>}
        {!loading && !shown.length && !extra.length && <Empty icon="contact" title={q ? 'کاربری یافت نشد' : 'مخاطبی ندارید'} sub={q ? 'نام کاربری دقیق را امتحان کنید.' : 'نام کاربری افراد را جستجو کنید و آن‌ها را به مخاطبین اضافه کنید.'} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ calls */
export function CallsView() {
  const [data, setData] = useState(null);
  const users = useStore((s) => s.users);
  const load = () => api('/calls').then((r) => { putUsers(r.users); setData(r.calls); }).catch((e) => { toast(e.message, 'error'); setData([]); });
  useEffect(() => { load(); }, []);
  const label = (c) => ({ missed: 'بی‌پاسخ', declined: 'رد شد', cancelled: 'لغو شد', ended: c.dur ? fmtDur(c.dur) : 'پایان یافت', busy: 'مشغول', offline: 'در دسترس نبود', failed: 'ناموفق' }[c.status] || '');
  return (
    <div className="side-view">
      <SideHead title="تماس‌ها">
        {data?.length > 0 && <IconBtn icon="trash" label="پاک کردن سابقه" onClick={async () => {
          if (!(await confirmDialog({ title: 'پاک کردن سابقه تماس', text: 'تمام سابقه تماس‌ها حذف شود؟', ok: 'پاک کردن', danger: true }))) return;
          try { await api('/calls', { method: 'DELETE' }); setData([]); } catch (e) { toast(e.message, 'error'); }
        }} />}
      </SideHead>
      <div className="chat-list scroll">
        {data === null && <div className="list-loading"><Spinner /></div>}
        {data?.map((c) => {
          const u = users.get(c.user_id); if (!u) return null;
          const bad = ['missed', 'declined', 'cancelled', 'busy', 'offline', 'failed'].includes(c.status) && !c.out;
          return (
            <UserRow key={c.id} u={u} onClick={() => openPrivate(u.id)}
              sub={<span className={cx('call-sub', bad && 'bad')}><Icon name={c.out ? 'arrowUpRight' : 'download'} />{c.video ? 'تصویری' : 'صوتی'} · {label(c)} · {ago(c.started_at)}</span>}
              right={u.can_call ? <IconBtn icon={c.video ? 'video' : 'phone'} label="تماس دوباره" onClick={(e) => { e.stopPropagation(); startCall(u, c.video); }} /> : null} />
          );
        })}
        {data?.length === 0 && <Empty icon="phone" title="تماسی ثبت نشده" sub="تماس‌های صوتی و تصویری شما اینجا نمایش داده می‌شوند." />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ new group / channel */
export function NewGroupView({ channel }) {
  const [step, setStep] = useState(channel ? 2 : 1);
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState('');
  const { local, extra, loading } = useUserSearch(q);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [uname, setUname] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inp = useRef(null);
  const users = useStore((s) => s.users);
  const toggle = (u) => setSel((s) => (s.some((x) => x.id === u.id) ? s.filter((x) => x.id !== u.id) : [...s, u]));
  const all = [...local, ...extra].filter((u) => !u.bot);
  async function create() {
    if (!title.trim()) { setErr(channel ? 'نام کانال را وارد کنید' : 'نام گروه را وارد کنید'); return; }
    setBusy(true);
    try {
      let pid = null;
      if (photo) pid = (await uploadFile(photo.file)).id;
      const r = await api('/chats', { method: 'POST', body: { type: channel ? 'channel' : 'group', title: title.trim(), description: desc, username: uname.trim() || undefined, photo: pid, members: sel.map((u) => u.id) } });
      putChat(r.chat);
      if (r.skipped) toast(`${fa(r.skipped)} نفر به‌دلیل تنظیمات حریم خصوصی اضافه نشدند.`);
      resetView();
      openChat(r.chat.id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  if (step === 1) {
    return (
      <div className="side-view">
        <SideHead title="افزودن اعضا"><span className="side-count">{fa(sel.length)}</span></SideHead>
        <div className="picker-chips">
          {sel.map((u) => <button key={u.id} type="button" className="chip" onClick={() => toggle(u)}><Avatar src={u.avatar} name={u.name} color={u.color} size={28} /><span>{userName(u)}</span><Icon name="x" /></button>)}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={sel.length ? '' : 'نام یا نام کاربری را جستجو کنید…'} aria-label="جستجوی کاربر" />
        </div>
        <div className="chat-list scroll">
          {all.map((u0) => { const u = users.get(u0.id) || u0; const on = sel.some((x) => x.id === u.id); return (
            <UserRow key={u.id} u={u} onClick={() => toggle(u)} right={<Check checked={on} />} />
          ); })}
          {loading && <div className="list-loading"><Spinner /></div>}
          {!loading && !all.length && <Empty icon="users" title="کسی یافت نشد" sub="نام کاربری افراد را جستجو کنید." />}
        </div>
        <button type="button" className="fab" aria-label="بعدی" onClick={() => setStep(2)}><Icon name="arrowLeft" /></button>
      </div>
    );
  }
  return (
    <div className="side-view">
      <SideHead title={channel ? 'کانال جدید' : 'گروه جدید'} onBack={channel ? popView : () => setStep(1)} />
      <div className="scroll pad">
        <div className="create-head">
          <button type="button" className="photo-circle sm" onClick={() => inp.current?.click()} aria-label="انتخاب عکس">
            {photo && <img src={photo.url} alt="" />}<span className="photo-ov"><Icon name="camera" /></span>
          </button>
          <input ref={inp} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto({ file: f, url: URL.createObjectURL(f) }); e.target.value = ''; }} />
        </div>
        <Field label={channel ? 'نام کانال' : 'نام گروه'} value={title} onChange={(v) => { setTitle(v); setErr(''); }} maxLength={128} error={err} autoFocus />
        <Field label="توضیحات (اختیاری)" value={desc} onChange={setDesc} maxLength={500} textarea rows={2} />
        <Field label="پیوند عمومی (اختیاری)" value={uname} onChange={(v) => setUname(v.replace(/[^A-Za-z0-9_]/g, ''))} dir="ltr" maxLength={32} suffix={<span className="at">@</span>}
          hint={uname ? `${channel ? 'کانال' : 'گروه'} عمومی خواهد بود و در جستجو دیده می‌شود.` : `بدون پیوند، ${channel ? 'کانال' : 'گروه'} خصوصی است و فقط با لینک دعوت می‌توان عضو شد.`} />
        {!channel && sel.length > 0 && <div className="sec-title">{fa(sel.length)} عضو</div>}
        {!channel && sel.map((u) => <UserRow key={u.id} u={u} />)}
      </div>
      <button type="button" className="fab" aria-label="ساختن" onClick={create} disabled={busy}>{busy ? <Spinner size={22} /> : <Icon name="check" />}</button>
    </div>
  );
}

/** Modal-friendly multi user picker (for adding members). */
export function UserPicker({ onPick, exclude = [], multi = true, busy }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const { local, extra, loading } = useUserSearch(q);
  const all = [...local, ...extra].filter((u) => !exclude.includes(u.id) && !u.bot);
  return (
    <div className="picker">
      <div className="side-search"><div className="search-box active"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" /></div></div>
      <div className="picker-list scroll">
        {all.map((u) => { const on = sel.some((x) => x.id === u.id); return (
          <UserRow key={u.id} u={u} onClick={() => (multi ? setSel((s) => (on ? s.filter((x) => x.id !== u.id) : [...s, u])) : onPick([u]))} right={multi ? <Check checked={on} /> : null} />
        ); })}
        {loading && <div className="list-loading"><Spinner /></div>}
        {!loading && !all.length && <Empty icon="users" title="کسی یافت نشد" />}
      </div>
      {multi && <div className="modal-foot"><button type="button" className="btn btn-primary" disabled={!sel.length || busy} onClick={() => onPick(sel)}>{busy ? <Spinner size={18} /> : `افزودن ${sel.length ? fa(sel.length) : ''}`}</button></div>}
    </div>
  );
}
export { getState };
