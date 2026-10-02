import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useStore, setState, getState, putChat, putUsers, toast, setMsgs } from '../lib/store.js';
import {
  chatTitle, chatAvatarProps, peerOf, userName, lastSeenText, loadMessages, closeChat, scheduleRead, chatPref, joinChat,
  meId, openModal, deleteMessages, forwardMessages, userOf, settings,
} from '../lib/actions.js';
import { api } from '../lib/api.js';
import { cx, fa, fmtDay, sameDay, previewText, plural } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, NameLine, Spinner } from './ui.jsx';
import { openMenu, confirmDialog } from './overlay.jsx';
import { typingLabel, TypingDots, leaveOrDelete } from './Sidebar.jsx';
import Message from './Message.jsx';
import Composer from './Composer.jsx';
import { startCall } from './Calls.jsx';

export default function ChatView({ id }) {
  const c = useStore((s) => s.chats.get(id));
  const select = useStore((s) => s.select);
  const [searchOpen, setSearchOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const dragN = useRef(0);
  if (!c) return <div className="chat-view"><div className="center-fill"><Spinner size={30} /></div></div>;
  const canPost = c.member && !c.frozen && (c.type !== 'channel' || ['owner', 'admin'].includes(c.role));
  const onDrop = (e) => {
    e.preventDefault(); dragN.current = 0; setDrag(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length && canPost) openModal({ type: 'sendFiles', chatId: id, files });
  };
  return (
    <section className="chat-view" aria-label={chatTitle(c)}
      onDragEnter={(e) => { if (e.dataTransfer?.types?.includes('Files') && canPost) { dragN.current++; setDrag(true); } }}
      onDragLeave={() => { dragN.current = Math.max(0, dragN.current - 1); if (!dragN.current) setDrag(false); }}
      onDragOver={(e) => { if (canPost) e.preventDefault(); }} onDrop={onDrop}>
      {select ? <SelectBar c={c} /> : <ChatHeader c={c} onSearch={() => setSearchOpen(true)} />}
      {searchOpen && <InChatSearch c={c} onClose={() => setSearchOpen(false)} />}
      <PinnedBar c={c} />
      <MessageList c={c} />
      <ChatBottom c={c} canPost={canPost} />
      {drag && <div className="drop-zone"><div><Icon name="upload" /><span>فایل‌ها را اینجا رها کنید</span></div></div>}
    </section>
  );
}

/* ------------------------------------------------------------------ header */
function ChatHeader({ c, onSearch }) {
  const peer = useStore((s) => (c.type === 'private' ? s.users.get(c.peer_id) : null));
  const typing = useStore((s) => s.typing.get(c.id));
  const users = useStore((s) => s.users);
  const conn = useStore((s) => s.conn);
  const myId = meId();
  const typers = typing ? [...typing.entries()].filter(([u]) => u !== myId) : [];
  let status;
  if (conn !== 'online') status = <span className="st-conn">{conn === 'connecting' ? 'در حال اتصال' : 'در انتظار شبکه'}<TypingDots /></span>;
  else if (typers.length) {
    const who = c.type === 'private' ? '' : typers.length > 1 ? `${fa(typers.length)} نفر ` : `${userName(users.get(typers[0][0])).split(' ')[0]} `;
    status = <span className="st-typing">{who}{typingLabel(typers[0][1].kind)}<TypingDots /></span>;
  } else if (c.type === 'private') status = <span className={cx(peer?.online && 'st-online')}>{lastSeenText(peer)}</span>;
  else if (c.type === 'saved') status = null;
  else if (c.type === 'group') status = <span>{plural(c.members_count, 'عضو')}{c.online_count > 1 ? `، ${fa(c.online_count)} آنلاین` : ''}</span>;
  else status = <span>{plural(c.members_count, 'مشترک')}</span>;
  const openInfo = () => setState({ panel: getState().panel ? null : { type: 'chat', id: c.id } });
  const more = (e) => {
    const isAdmin = ['owner', 'admin'].includes(c.role);
    openMenu(e, [
      { icon: 'info', label: c.type === 'private' ? 'مشاهده پروفایل' : c.type === 'channel' ? 'اطلاعات کانال' : 'اطلاعات گروه', onClick: openInfo },
      { icon: 'search', label: 'جستجو در گفتگو', onClick: onSearch },
      c.type !== 'saved' && c.member && { icon: c.muted ? 'bell' : 'bellOff', label: c.muted ? 'روشن کردن اعلان' : 'بی‌صدا کردن', onClick: () => chatPref(c.id, { muted: !c.muted }) },
      { icon: 'select', label: 'انتخاب پیام‌ها', onClick: () => setState({ select: new Set() }) },
      { icon: 'clock', label: 'پیام‌های زمان‌بندی‌شده', onClick: () => openModal({ type: 'scheduled', chatId: c.id }) },
      c.type === 'private' && peer && !peer.bot && peer.id !== myId && { icon: peer.blocked ? 'checkCircle' : 'ban', danger: !peer.blocked, label: peer.blocked ? 'رفع مسدودیت' : 'مسدود کردن', onClick: () => toggleBlock(peer) },
      (c.type === 'group' || c.type === 'channel') && isAdmin && { icon: 'link', label: 'پیوند دعوت', onClick: () => openModal({ type: 'inviteLink', chatId: c.id }) },
      c.type !== 'saved' && { icon: 'flag', label: 'گزارش', danger: true, onClick: () => openModal({ type: 'report', kind: c.type === 'private' ? 'user' : 'chat', targetId: c.type === 'private' ? c.peer_id : c.id }) },
      { sep: true },
      { icon: 'eraser', label: 'پاک کردن تاریخچه', onClick: async () => {
        if (!(await confirmDialog({ title: 'پاک کردن تاریخچه', text: 'تمام پیام‌های این گفتگو برای شما پاک می‌شود.', ok: 'پاک کردن', danger: true }))) return;
        try { await api(`/chats/${c.id}/clear`, { method: 'POST', body: {} }); } catch (err) { toast(err.message, 'error'); }
      } },
      c.member && { icon: 'trash', danger: true, label: c.type === 'private' ? 'حذف گفتگو' : c.role === 'owner' ? 'حذف' : 'ترک کردن', onClick: () => leaveOrDelete(c) },
    ]);
  };
  const canCall = c.type === 'private' && peer?.can_call && !peer.blocked;
  return (
    <header className="chat-head glass-bar">
      <IconBtn icon="arrowRight" label="بازگشت" className="back-btn" onClick={closeChat} />
      <button type="button" className="ch-info" onClick={openInfo}>
        <Avatar {...chatAvatarProps(c)} size={42} />
        <span className="ch-text">
          <span className="ch-title"><NameLine name={chatTitle(c)} user={peer} chat={c} />{c.muted && <Icon name="bellOff" className="ci-muted" />}</span>
          {status && <span className="ch-status">{status}</span>}
        </span>
      </button>
      <div className="ch-actions">
        {canCall && <IconBtn icon="video" label="تماس تصویری" className="hide-xs" onClick={() => startCall(peer, true)} />}
        {canCall && <IconBtn icon="phone" label="تماس صوتی" onClick={() => startCall(peer, false)} />}
        <IconBtn icon="search" label="جستجو" className="hide-xs" onClick={onSearch} />
        <IconBtn icon="more" label="بیشتر" onClick={more} />
      </div>
    </header>
  );
}
export async function toggleBlock(u) {
  if (!u.blocked && !(await confirmDialog({ title: 'مسدود کردن', text: `${userName(u)} دیگر نمی‌تواند به شما پیام دهد یا تماس بگیرد.`, ok: 'مسدود کن', danger: true }))) return;
  try { putUsers([await api(`/blocks/${u.id}`, { method: u.blocked ? 'DELETE' : 'POST' })]); toast(u.blocked ? 'رفع مسدودیت شد.' : 'کاربر مسدود شد.', 'ok'); } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------------------------------------------ select mode */
function SelectBar({ c }) {
  const sel = useStore((s) => s.select);
  const msgs = useStore((s) => s.msgs.get(c.id));
  const n = sel.size;
  const chosen = (msgs?.list || []).filter((m) => sel.has(m.id));
  const canAll = chosen.every((m) => m.sender_id === meId() || ['owner', 'admin'].includes(c.role)) && c.type !== 'saved';
  return (
    <header className="chat-head glass-bar select-bar">
      <IconBtn icon="x" label="لغو انتخاب" onClick={() => setState({ select: null })} />
      <div className="sel-count">{n ? `${fa(n)} پیام انتخاب شد` : 'پیام‌ها را انتخاب کنید'}</div>
      <div className="ch-actions">
        <IconBtn icon="copy" label="کپی" disabled={!n} onClick={() => {
          const text = chosen.map((m) => `[${userName(userOf(m.sender_id))}] ${previewText(m)}`).join('\n');
          navigator.clipboard?.writeText(text).then(() => toast('کپی شد.', 'ok'), () => toast('کپی ممکن نشد.', 'error'));
        }} />
        <IconBtn icon="forward" label="بازارسال" disabled={!n} onClick={() => openModal({ type: 'forward', chatId: c.id, ids: [...sel] })} />
        <IconBtn icon="trash" label="حذف" className="danger" disabled={!n} onClick={async () => {
          const r = await confirmDialog({ title: `حذف ${fa(n)} پیام`, text: 'پیام‌های انتخاب‌شده حذف شوند؟', ok: 'حذف', danger: true, check: canAll && c.type !== 'channel' ? 'حذف برای همه' : null });
          if (!r) return;
          await deleteMessages([...sel], c.type === 'channel' ? true : !!r.check);
          setState({ select: null });
        }} />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ in-chat search */
function InChatSearch({ c, onClose }) {
  const [q, setQ] = useState('');
  const [ids, setIds] = useState([]);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const inp = useRef(null);
  useEffect(() => { inp.current?.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setIds([]); return undefined; }
    setBusy(true);
    const t = setTimeout(() => api(`/chats/${c.id}/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setIds(r.ids); setI(0); if (r.ids[0]) jumpTo(c.id, r.ids[0], q.trim()); }).catch((e) => toast(e.message, 'error')).finally(() => setBusy(false)), 300);
    return () => clearTimeout(t);
  }, [q, c.id]);
  const go = (d) => { if (!ids.length) return; const n = (i + d + ids.length) % ids.length; setI(n); jumpTo(c.id, ids[n], q.trim()); };
  const close = () => { setState({ hl: null }); onClose(); };
  return (
    <div className="chat-search glass-bar">
      <div className="search-box active">
        <Icon name="search" />
        <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در این گفتگو" onKeyDown={(e) => { if (e.key === 'Enter') go(e.shiftKey ? -1 : 1); if (e.key === 'Escape') close(); }} />
        {busy ? <Spinner size={16} /> : q && <span className="cs-count">{ids.length ? `${fa(i + 1)} از ${fa(ids.length)}` : 'بدون نتیجه'}</span>}
      </div>
      <IconBtn icon="chevUp" label="قبلی" disabled={!ids.length} onClick={() => go(1)} />
      <IconBtn icon="chevDown" label="بعدی" disabled={!ids.length} onClick={() => go(-1)} />
      <IconBtn icon="x" label="بستن جستجو" onClick={close} />
    </div>
  );
}

export async function jumpTo(cid, mid, hl) {
  const cur = getState().msgs.get(cid);
  if (!cur?.list.some((m) => m.id === mid)) await loadMessages(cid, { around: mid });
  setState({ jump: mid, hl: hl || null, jumpTick: Date.now() });
}

/* ------------------------------------------------------------------ pinned */
function PinnedBar({ c }) {
  const [list, setList] = useState([]);
  const [idx, setIdx] = useState(0);
  const tick = useStore((s) => { const l = s.msgs.get(c.id)?.list; return l ? l.filter((m) => m.pinned).map((m) => m.id).join(',') : ''; });
  useEffect(() => {
    let alive = true;
    api(`/chats/${c.id}/pinned`).then((r) => { if (alive) { setList(r.messages); setIdx(0); } }).catch(() => {});
    return () => { alive = false; };
  }, [c.id, tick]);
  if (!list.length) return null;
  const m = list[Math.min(idx, list.length - 1)];
  const canUnpin = c.type === 'private' || c.type === 'saved' || ['owner', 'admin'].includes(c.role);
  return (
    <div className="pinned-bar glass-bar" onClick={() => { jumpTo(c.id, m.id); setIdx((idx + 1) % list.length); }} role="button" tabIndex={0}>
      <div className="pin-lines">{list.slice(0, 4).map((x, i) => <span key={x.id} className={cx(i === Math.min(idx, 3) && 'on')} />)}</div>
      <div className="pin-body">
        <div className="pin-title">{list.length > 1 ? `پیام سنجاق‌شده #${fa(idx + 1)}` : 'پیام سنجاق‌شده'}</div>
        <div className="pin-text">{previewText(m)}</div>
      </div>
      {canUnpin && <IconBtn icon="x" label="برداشتن سنجاق" onClick={async (e) => { e.stopPropagation(); if (await confirmDialog({ title: 'برداشتن سنجاق', text: 'سنجاق این پیام برداشته شود؟', ok: 'برداشتن' })) { try { await api(`/messages/${m.id}/pin`, { method: 'POST', body: { pinned: false } }); setList((l) => l.filter((x) => x.id !== m.id)); } catch (err) { toast(err.message, 'error'); } } }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ message list */
function MessageList({ c }) {
  const data = useStore((s) => s.msgs.get(c.id));
  const jump = useStore((s) => s.jump);
  const jumpTick = useStore((s) => s.jumpTick);
  const hl = useStore((s) => s.hl);
  const myId = meId();
  const ref = useRef(null);
  const atBottom = useRef(true);
  const prevFirst = useRef(null);
  const prevHeight = useRef(0);
  const [showDown, setShowDown] = useState(false);
  const [flash, setFlash] = useState(null);
  const firstUnread = useRef(null);
  if (firstUnread.current === null && data?.loaded) {
    const lr = c.last_read || 0;
    const u = data.list.find((m) => m.id > lr && m.sender_id !== myId && m.type !== 'service');
    firstUnread.current = c.unread > 0 && u ? u.id : 0;
  }
  const list = useMemo(() => (data?.list || []).filter((m) => !m.sched_at), [data?.list]);

  // keep position when older messages are prepended; stick to bottom on new ones
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const first = list[0]?.id;
    if (prevFirst.current && first !== prevFirst.current && list.some((m) => m.id === prevFirst.current)) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first; prevHeight.current = el.scrollHeight;
  }, [list]);
  // initial position: first unread or bottom
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (didInit.current || !data?.loaded || !ref.current) return;
    didInit.current = true;
    const el = ref.current;
    const target = jump || firstUnread.current;
    if (target) {
      const node = el.querySelector(`[data-mid="${target}"]`);
      if (node) { el.scrollTop = node.offsetTop - el.clientHeight / 3; atBottom.current = false; if (jump) setFlash(jump); return; }
    }
    el.scrollTop = el.scrollHeight;
  }, [data?.loaded, jump]);
  // later jumps (search / reply click / pinned)
  useEffect(() => {
    if (!jump || !didInit.current) return;
    const el = ref.current; const node = el?.querySelector(`[data-mid="${jump}"]`);
    if (node) { node.scrollIntoView({ block: 'center', behavior: settings().motion ? 'smooth' : 'auto' }); setFlash(jump); }
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [jumpTick]); // eslint-disable-line
  // keep pinned to bottom while images load / viewport resizes
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; prevHeight.current = el.scrollHeight; });
    ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = dist < 40 && !data?.hasNewer;
    setShowDown(dist > 300 || !!data?.hasNewer);
    if (el.scrollTop < 400 && data?.hasOlder && !data.loading && list.length) { prevHeight.current = el.scrollHeight; loadMessages(c.id, { before: list[0].id }); }
    if (dist < 300 && data?.hasNewer && !data.loading && list.length) loadMessages(c.id, { after: list[list.length - 1].id });
    if (atBottom.current) scheduleRead(c.id);
  };
  const toBottom = async () => {
    if (data?.hasNewer) { await loadMessages(c.id, {}); }
    const el = ref.current; atBottom.current = true;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: settings().motion ? 'smooth' : 'auto' });
    setState({ jump: null });
    scheduleRead(c.id);
  };

  const unread = c.unread || 0;
  const items = [];
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const m = list[i]; const next = list[i + 1];
    if (!prev || !sameDay(prev.created_at, m.created_at)) items.push(<div key={`d${m.id}`} className="day-sep"><span className="glass-chip">{fmtDay(m.created_at)}</span></div>);
    if (firstUnread.current && m.id === firstUnread.current) items.push(<div key="unread" className="unread-sep"><span>پیام‌های خوانده‌نشده</span></div>);
    const grpPrev = prev && prev.sender_id === m.sender_id && prev.type !== 'service' && m.created_at - prev.created_at < 5 * 60e3 && sameDay(prev.created_at, m.created_at);
    const grpNext = next && next.sender_id === m.sender_id && next.type !== 'service' && next.created_at - m.created_at < 5 * 60e3 && sameDay(next.created_at, m.created_at);
    items.push(<Message key={m.id} m={m} c={c} first={!grpPrev} last={!grpNext} flash={flash === m.id} hl={hl} />);
    prev = m;
  }
  return (
    <div className="msg-wrap">
    <div className="msg-scroll scroll" ref={ref} onScroll={onScroll}>
      <div className={cx('msg-list', c.type === 'channel' && 'is-channel')}>
        {data?.loading && data.hasOlder && list.length > 0 && <div className="list-loading"><Spinner /></div>}
        {!data?.loaded && <div className="center-fill"><Spinner size={30} /></div>}
        {data?.loaded && !list.length && <EmptyChat c={c} />}
        {items}
      </div>
    </div>
      <button type="button" className={cx('down-fab glass', showDown && 'show')} onClick={toBottom} aria-label="رفتن به آخرین پیام" tabIndex={showDown ? 0 : -1}>
        <Icon name="chevDown" />{unread > 0 && <span className="badge">{unread > 99 ? '+۹۹' : fa(unread)}</span>}
      </button>
    </div>
  );
}

function EmptyChat({ c }) {
  const peer = c.type === 'private' ? userOf(c.peer_id) : null;
  const send = (e) => api(`/chats/${c.id}/messages`, { method: 'POST', body: { type: 'sticker', data: { e } } }).catch((err) => toast(err.message, 'error'));
  if (c.type === 'saved') {
    return (
      <div className="empty-chat glass">
        <span className="ec-ic"><Icon name="bookmark" /></span>
        <div className="ec-title">پیام‌های ذخیره‌شده</div>
        <ul className="ec-list"><li>پیام‌ها را برای ذخیره اینجا بازارسال کنید</li><li>فایل‌ها و یادداشت‌ها را اینجا بفرستید</li><li>از هر دستگاهی به آن‌ها دسترسی دارید</li></ul>
      </div>
    );
  }
  if (c.type !== 'private' || !c.member) return <div className="empty-chat glass"><div className="ec-title">هنوز پیامی نیست</div></div>;
  return (
    <div className="empty-chat glass">
      <div className="ec-title">هنوز پیامی اینجا نیست…</div>
      <div className="ec-sub">یک پیام بفرستید یا روی استیکر زیر بزنید.</div>
      <button type="button" className="ec-sticker" onClick={() => send('👋')} aria-label="ارسال استیکر">👋</button>
      {peer?.bot && <div className="ec-sub">برای شروع، <b dir="ltr">/start</b> را بفرستید.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ bottom (composer or state bars) */
function ChatBottom({ c, canPost }) {
  const peer = useStore((s) => (c.type === 'private' ? s.users.get(c.peer_id) : null));
  const select = useStore((s) => s.select);
  if (select) return null;
  if (!c.member) {
    return <div className="chat-bar"><button type="button" className="bar-btn" onClick={() => joinChat(c.id)}>{c.type === 'channel' ? 'عضویت در کانال' : 'پیوستن به گروه'}</button></div>;
  }
  if (c.frozen) return <div className="chat-bar"><span className="bar-note"><Icon name="lock" />این گفتگو توسط مدیریت GuardNet مسدود شده است</span></div>;
  if (peer?.blocked) return <div className="chat-bar"><button type="button" className="bar-btn danger" onClick={() => toggleBlock(peer)}>رفع مسدودیت</button></div>;
  if (peer?.deleted) return <div className="chat-bar"><span className="bar-note">این حساب حذف شده است</span></div>;
  if (!canPost) {
    return <div className="chat-bar"><button type="button" className="bar-btn" onClick={() => chatPref(c.id, { muted: !c.muted })}>{c.muted ? 'روشن کردن اعلان' : 'بی‌صدا کردن'}</button></div>;
  }
  return <Composer c={c} />;
}
export { putChat, setMsgs, forwardMessages };
