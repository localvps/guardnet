import { useEffect, useRef, useState } from 'react';
import { useStore, setState, getState, putUsers, putChat, toast } from '../lib/store.js';
import { chatTitle, chatAvatarProps, peerOf, userName, lastSeenText, openPrivate, chatPref, meId, openModal, openChat } from '../lib/actions.js';
import { api, uploadFile, assetUrl } from '../lib/api.js';
import { cx, fa, fmtSize, fmtDur, fmtDay, RichText, plural } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, NameLine, Row, Toggle, Spinner, Empty, Field, Button } from './ui.jsx';
import { openMenu, confirmDialog } from './overlay.jsx';
import { toggleBlock } from './Chat.jsx';
import { leaveOrDelete } from './Sidebar.jsx';
import { startCall } from './Calls.jsx';
import { UserPicker } from './Views.jsx';
import { Modal } from './overlay.jsx';

export default function InfoPanel() {
  const panel = useStore((s) => s.panel);
  const chat = useStore((s) => (panel?.type === 'chat' ? s.chats.get(panel.id) : null));
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [panel?.id, panel?.type]);
  if (!panel) return null;
  const close = () => setState({ panel: null });
  const isUser = panel.type === 'user' || chat?.type === 'private';
  const uid = panel.type === 'user' ? panel.id : chat?.peer_id;
  return (
    <aside className="info-panel" aria-label="اطلاعات">
      <header className="side-head glass-bar">
        <IconBtn icon={editing ? 'arrowRight' : 'x'} label={editing ? 'بازگشت' : 'بستن'} onClick={editing ? () => setEditing(false) : close} />
        <div className="side-title">{editing ? 'ویرایش' : isUser ? 'اطلاعات کاربر' : chat?.type === 'channel' ? 'اطلاعات کانال' : chat?.type === 'saved' ? 'پیام‌های ذخیره‌شده' : 'اطلاعات گروه'}</div>
        {!editing && chat && ['group', 'channel'].includes(chat.type) && ['owner', 'admin'].includes(chat.role) && <IconBtn icon="pencil" label="ویرایش" onClick={() => setEditing(true)} />}
      </header>
      <div className="scroll info-scroll">
        {editing && chat ? <EditChat c={chat} done={() => setEditing(false)} />
          : isUser ? <UserInfo uid={uid} chat={chat} /> : chat ? <ChatInfo c={chat} /> : null}
        {!editing && chat && <MediaTabs c={chat} />}
      </div>
    </aside>
  );
}

function UserInfo({ uid, chat }) {
  const u = useStore((s) => s.users.get(uid));
  const [full, setFull] = useState(null);
  const privateChat = useStore((s) => chat || [...s.chats.values()].find((c) => c.type === 'private' && c.peer_id === uid));
  useEffect(() => { api(`/users/${uid}`).then((r) => { putUsers([r]); setFull(r); }).catch(() => {}); }, [uid]);
  if (!u) return <div className="center-fill"><Spinner /></div>;
  const me = uid === meId();
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('کپی شد.', 'ok'), () => {});
  return (
    <>
      <div className="profile-hero">
        <Avatar src={u.avatar} name={u.name} color={u.color} size={120} deleted={u.deleted} onClick={() => u.avatar && setState({ viewer: { src: assetUrl(u.avatar), title: userName(u) } })} />
        <div className="ph-name"><NameLine name={userName(u)} user={u} /></div>
        <div className={cx('ph-status', u.online && 'online')}>{lastSeenText(u)}</div>
        {!me && !u.deleted && (
          <div className="ph-actions">
            <button type="button" onClick={() => openPrivate(uid)}><Icon name="send" /><span>پیام</span></button>
            {u.can_call && !u.blocked && <button type="button" onClick={() => startCall(u, false)}><Icon name="phone" /><span>تماس</span></button>}
            {u.can_call && !u.blocked && <button type="button" onClick={() => startCall(u, true)}><Icon name="video" /><span>ویدیو</span></button>}
            {privateChat && <button type="button" onClick={() => chatPref(privateChat.id, { muted: !privateChat.muted })}><Icon name={privateChat.muted ? 'bell' : 'bellOff'} /><span>{privateChat.muted ? 'صدادار' : 'بی‌صدا'}</span></button>}
          </div>
        )}
      </div>
      <div className="info-card">
        {u.username && <Row icon="at" title={<span dir="ltr">@{u.username}</span>} sub="نام کاربری" onClick={() => copy(`@${u.username}`)} />}
        {u.bio && <Row icon="info" title={<span className="bio"><RichText text={u.bio} /></span>} sub="بیوگرافی" />}
        {full?.common_groups > 0 && <Row icon="users" title={plural(full.common_groups, 'گروه مشترک')} />}
        {u.created_at && <Row icon="clock" title={fmtDay(u.created_at)} sub="عضویت در GuardNet" />}
        {privateChat && !me && <Row icon="bell" title="اعلان‌ها" right={<Toggle checked={!privateChat.muted} onChange={(v) => chatPref(privateChat.id, { muted: !v })} label="اعلان‌ها" />} />}
      </div>
      {!me && !u.deleted && !u.bot && u.online !== null && (
        <div className="info-card">
          <Row icon={u.is_contact ? 'trash' : 'userPlus'} title={u.is_contact ? 'حذف از مخاطبین' : 'افزودن به مخاطبین'} danger={u.is_contact} onClick={async () => {
            try { putUsers([await api(`/contacts/${uid}`, { method: u.is_contact ? 'DELETE' : 'POST' })]); toast(u.is_contact ? 'از مخاطبین حذف شد.' : 'به مخاطبین اضافه شد.', 'ok'); } catch (e) { toast(e.message, 'error'); }
          }} />
          <Row icon="ban" title={u.blocked ? 'رفع مسدودیت' : 'مسدود کردن'} danger={!u.blocked} onClick={() => toggleBlock(u)} />
          <Row icon="flag" title="گزارش کاربر" danger onClick={() => openModal({ type: 'report', kind: 'user', targetId: uid })} />
          {privateChat && <Row icon="trash" title="حذف گفتگو" danger onClick={() => leaveOrDelete(privateChat)} />}
        </div>
      )}
    </>
  );
}

function ChatInfo({ c }) {
  const [detail, setDetail] = useState(null);
  const users = useStore((s) => s.users);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api(`/chats/${c.id}`).then((r) => {
    putUsers(r.users); setDetail(r.chat);
    if (r.chat.members) { const cm = new Map(getState().chatMembers || []); cm.set(c.id, r.chat.members.map((x) => x.user_id)); setState({ chatMembers: cm }); }
  }).catch(() => {});
  useEffect(() => { load(); }, [c.id, c.members_count]); // eslint-disable-line
  if (c.type === 'saved') {
    return <div className="profile-hero"><Avatar {...chatAvatarProps(c)} size={120} /><div className="ph-name">پیام‌های ذخیره‌شده</div><div className="ph-status">فضای شخصی شما</div></div>;
  }
  const admin = ['owner', 'admin'].includes(c.role);
  const link = c.username ? `${location.origin}${location.pathname}#@${c.username}` : null;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('پیوند کپی شد.', 'ok'), () => {});
  const memberMenu = (e, mem, u) => {
    const mine = mem.user_id === meId();
    openMenu(e, [
      !mine && { icon: 'send', label: 'ارسال پیام', onClick: () => openPrivate(u.id) },
      !mine && { icon: 'info', label: 'مشاهده پروفایل', onClick: () => setState({ panel: { type: 'user', id: u.id } }) },
      c.role === 'owner' && !mine && mem.role !== 'owner' && { icon: 'shield', label: mem.role === 'admin' ? 'برکناری از مدیریت' : 'انتخاب به‌عنوان مدیر', onClick: async () => {
        try { await api(`/chats/${c.id}/members/${u.id}`, { method: 'PATCH', body: { role: mem.role === 'admin' ? 'member' : 'admin' } }); load(); } catch (err) { toast(err.message, 'error'); }
      } },
      admin && !mine && mem.role !== 'owner' && (c.role === 'owner' || mem.role !== 'admin') && { icon: 'trash', danger: true, label: `حذف از ${c.type === 'channel' ? 'کانال' : 'گروه'}`, onClick: async () => {
        if (!(await confirmDialog({ title: 'حذف عضو', text: `${userName(u)} حذف شود؟`, ok: 'حذف', danger: true }))) return;
        try { await api(`/chats/${c.id}/members/${u.id}`, { method: 'DELETE' }); load(); } catch (err) { toast(err.message, 'error'); }
      } },
    ]);
  };
  return (
    <>
      <div className="profile-hero">
        <Avatar {...chatAvatarProps(c)} size={120} onClick={() => c.photo && setState({ viewer: { src: assetUrl(c.photo), title: c.title } })} />
        <div className="ph-name"><NameLine name={chatTitle(c)} chat={c} /></div>
        <div className="ph-status">{plural(c.members_count, c.type === 'channel' ? 'مشترک' : 'عضو')}{c.online_count > 1 ? `، ${fa(c.online_count)} آنلاین` : ''}</div>
        {c.frozen && <div className="ph-warn"><Icon name="lock" />مسدود شده توسط مدیریت</div>}
      </div>
      <div className="info-card">
        {c.description && <Row icon="info" title={<span className="bio"><RichText text={c.description} /></span>} sub="توضیحات" />}
        {link && <Row icon="link" title={<span dir="ltr">@{c.username}</span>} sub="پیوند عمومی" onClick={() => copy(link)} />}
        {admin && c.invite && <Row icon="userPlus" title="پیوند دعوت" sub="برای دعوت افراد" onClick={() => openModal({ type: 'inviteLink', chatId: c.id })} chevron />}
        {c.member && <Row icon="bell" title="اعلان‌ها" right={<Toggle checked={!c.muted} onChange={(v) => chatPref(c.id, { muted: !v })} label="اعلان‌ها" />} />}
      </div>
      {detail?.members && (
        <div className="info-card">
          <div className="card-title">{c.type === 'channel' ? 'مدیران' : `${fa(detail.members.length)} عضو`}
            {admin && <button type="button" className="card-act" onClick={() => setAdding(true)}><Icon name="userPlus" />افزودن</button>}
          </div>
          {detail.members.map((mem) => {
            const u = users.get(mem.user_id); if (!u) return null;
            return (
              <div key={mem.user_id} className="chat-item compact" onClick={(e) => (mem.user_id === meId() ? null : memberMenu(e, mem, u))} onContextMenu={(e) => memberMenu(e, mem, u)} role="button" tabIndex={0}>
                <Avatar src={u.avatar} name={u.name} color={u.color} size={42} online={u.online && !u.bot} />
                <div className="ci-body">
                  <div className="ci-top"><span className="ci-title"><NameLine name={u.id === meId() ? `${userName(u)} (شما)` : userName(u)} user={u} /></span>{mem.role !== 'member' && <span className="role-tag">{mem.role === 'owner' ? 'مالک' : 'مدیر'}</span>}</div>
                  <div className="ci-bottom"><span className={cx('ci-text', u.online && 'online')}>{lastSeenText(u)}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {c.member && (
        <div className="info-card">
          <Row icon="flag" title="گزارش" danger onClick={() => openModal({ type: 'report', kind: 'chat', targetId: c.id })} />
          <Row icon="trash" title={c.role === 'owner' ? `حذف ${c.type === 'channel' ? 'کانال' : 'گروه'}` : 'ترک کردن'} danger onClick={() => leaveOrDelete(c)} />
        </div>
      )}
      {adding && (
        <Modal title="افزودن عضو" onClose={() => setAdding(false)} noPad>
          <UserPicker exclude={(detail?.members || []).map((x) => x.user_id)} busy={busy} onPick={async (sel) => {
            setBusy(true);
            try {
              const r = await api(`/chats/${c.id}/members`, { method: 'POST', body: { user_ids: sel.map((u) => u.id) } });
              toast(r.added ? `${fa(r.added)} نفر اضافه شدند.` : 'کسی اضافه نشد.', r.added ? 'ok' : 'error');
              if (r.skipped) toast(`${fa(r.skipped)} نفر به‌دلیل حریم خصوصی اضافه نشدند.`);
              setAdding(false); load();
            } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
          }} />
        </Modal>
      )}
    </>
  );
}

function EditChat({ c, done }) {
  const [title, setTitle] = useState(c.title || '');
  const [desc, setDesc] = useState(c.description || '');
  const [uname, setUname] = useState(c.username || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inp = useRef(null);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = {};
      if (title.trim() !== c.title) body.title = title.trim();
      if (desc !== (c.description || '')) body.description = desc;
      if (uname !== (c.username || '')) body.username = uname;
      if (Object.keys(body).length) putChat(await api(`/chats/${c.id}`, { method: 'PATCH', body }));
      toast('ذخیره شد.', 'ok'); done();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const setPhoto = async (f) => {
    try { const up = await uploadFile(f); putChat(await api(`/chats/${c.id}`, { method: 'PATCH', body: { photo: up.id } })); toast('عکس به‌روز شد.', 'ok'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="pad">
      <div className="create-head">
        <button type="button" className="photo-circle sm" onClick={() => inp.current?.click()} aria-label="تغییر عکس">
          {c.photo && <img src={assetUrl(c.photo)} alt="" />}<span className="photo-ov"><Icon name="camera" /></span>
        </button>
        <input ref={inp} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ''; }} />
      </div>
      <Field label="نام" value={title} onChange={setTitle} maxLength={128} />
      <Field label="توضیحات" value={desc} onChange={setDesc} maxLength={500} textarea rows={3} />
      <Field label="پیوند عمومی" value={uname} onChange={(v) => setUname(v.replace(/[^A-Za-z0-9_]/g, ''))} dir="ltr" maxLength={32} error={err} suffix={<span className="at">@</span>}
        hint={uname ? 'عمومی: همه می‌توانند پیدا کنند و عضو شوند.' : 'خصوصی: فقط با پیوند دعوت.'} />
      <Button full loading={busy} onClick={save}>ذخیره</Button>
      {c.photo && <button type="button" className="auth-link danger" onClick={async () => { try { putChat(await api(`/chats/${c.id}`, { method: 'PATCH', body: { photo: null } })); } catch (e) { toast(e.message, 'error'); } }}>حذف عکس</button>}
    </div>
  );
}

function MediaTabs({ c }) {
  const [tab, setTab] = useState('image');
  const [data, setData] = useState({});
  const tick = useStore((s) => s.chats.get(c.id)?.last_message?.id);
  useEffect(() => {
    let alive = true;
    api(`/chats/${c.id}/media?kind=${tab}`).then((r) => { if (alive) { putUsers([]); setData((d) => ({ ...d, [tab]: r.messages })); } }).catch(() => { if (alive) setData((d) => ({ ...d, [tab]: [] })); });
    return () => { alive = false; };
  }, [c.id, tab, tick]);
  const list = data[tab];
  return (
    <div className="info-card media-card">
      <div className="media-tabs" role="tablist">
        {[['image', 'رسانه'], ['file', 'فایل'], ['voice', 'صدا'], ['link', 'پیوند']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={cx(tab === k && 'active')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!list && <div className="list-loading"><Spinner /></div>}
      {list && !list.length && <Empty icon={tab === 'image' ? 'image' : tab === 'file' ? 'file' : tab === 'voice' ? 'mic' : 'link'} title="چیزی اینجا نیست" />}
      {list && tab === 'image' && list.length > 0 && (
        <div className="media-grid">
          {list.map((m) => (
            <button key={m.id} type="button" className="mg-it" onClick={() => setState({ viewer: { chatId: c.id, mid: m.id, list } })}>
              {m.type === 'image' ? <img src={assetUrl(m.data.url)} alt="" loading="lazy" /> : <video src={assetUrl(m.data.url)} preload="metadata" muted />}
              {m.type === 'video' && <span className="media-dur">{fmtDur(m.data.dur)}</span>}
            </button>
          ))}
        </div>
      )}
      {list && tab === 'file' && list.map((m) => (
        <a key={m.id} className="row clickable" href={assetUrl(m.data.url)} download={m.data.name} target="_blank" rel="noopener noreferrer">
          <span className="row-ic filled" style={{ background: 'var(--accent)' }}><Icon name="file" /></span>
          <span className="row-body"><span className="row-title" dir="auto">{m.data.name}</span><span className="row-sub">{fmtSize(m.data.size)} · {fmtDay(m.created_at)}</span></span>
        </a>
      ))}
      {list && tab === 'voice' && list.map((m) => (
        <div key={m.id} className="row clickable" onClick={() => { setState({ panel: window.innerWidth > 1180 ? getState().panel : null }); openChat(c.id, { jumpTo: m.id }); }}>
          <span className="row-ic filled" style={{ background: 'var(--accent)' }}><Icon name="mic" /></span>
          <span className="row-body"><span className="row-title">پیام صوتی {fmtDur(m.data.dur)}</span><span className="row-sub">{fmtDay(m.created_at)}</span></span>
        </div>
      ))}
      {list && tab === 'link' && list.map((m) => {
        const url = (m.text.match(/https?:\/\/[^\s<>"']+/) || [])[0];
        let host = ''; try { host = new URL(url).hostname; } catch { /* */ }
        return (
          <a key={m.id} className="row clickable" href={url} target="_blank" rel="noopener noreferrer nofollow">
            <span className="row-ic filled" style={{ background: 'var(--accent)' }}><Icon name="link" /></span>
            <span className="row-body"><span className="row-title" dir="ltr">{host || url}</span><span className="row-sub" dir="ltr">{url}</span></span>
          </a>
        );
      })}
    </div>
  );
}
