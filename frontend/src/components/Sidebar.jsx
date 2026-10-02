import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useStore, setState, getState, putUsers, toast } from '../lib/store.js';
import {
  sortedChats, chatTitle, chatAvatarProps, peerOf, userOf, userName, openChat, chatPref, settings, setSetting,
  pushView, popView, openModal, openPrivate, meId, resolveAndOpen,
} from '../lib/actions.js';
import { api } from '../lib/api.js';
import { cx, fa, fmtListTime, previewText, RichText } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, NameLine, Empty, Spinner, Logo, Toggle, PremiumStar } from './ui.jsx';
import { openMenu, useLongPress, confirmDialog } from './overlay.jsx';
import SettingsView from './Settings.jsx';
import { ContactsView, CallsView, NewGroupView } from './Views.jsx';

export default function Sidebar() {
  const view = useStore((s) => s.view);
  const stackLen = useStore((s) => s.stack.length);
  return (
    <aside className="sidebar">
      <div className={cx('side-stack')}>
        <div className={cx('side-layer', view.name !== 'chats' && 'behind')} aria-hidden={view.name !== 'chats'}>
          <ChatsView />
        </div>
        {view.name !== 'chats' && (
          <div className="side-layer top" key={`${view.name}-${stackLen}`}>
            {view.name === 'archived' && <ArchivedView />}
            {view.name === 'contacts' && <ContactsView />}
            {view.name === 'calls' && <CallsView />}
            {(view.name === 'newGroup' || view.name === 'newChannel') && <NewGroupView channel={view.name === 'newChannel'} />}
            {view.name.startsWith('settings') && <SettingsView view={view} />}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ main list */
function ChatsView() {
  const [drawer, setDrawer] = useState(false);
  const search = useStore((s) => s.search);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const conn = useStore((s) => s.conn);
  const searching = focused || search;
  return (
    <div className="side-view">
      <header className="side-head glass-bar">
        {searching
          ? <IconBtn icon="arrowRight" label="بازگشت" onClick={() => { setState({ search: '' }); setFocused(false); inputRef.current?.blur(); }} />
          : <IconBtn icon="menu" label="منو" onClick={() => setDrawer(true)} />}
        <div className={cx('search-box', searching && 'active')}>
          <Icon name="search" />
          <input ref={inputRef} value={search} onChange={(e) => setState({ search: e.target.value })} placeholder={conn === 'online' ? 'جستجو' : conn === 'connecting' ? 'در حال اتصال…' : 'در انتظار شبکه…'}
            onFocus={() => setFocused(true)} aria-label="جستجو" />
          {conn !== 'online' && !search && <Spinner size={16} className="conn-spin" />}
          {search && <button type="button" className="search-clear" aria-label="پاک کردن" onClick={() => { setState({ search: '' }); inputRef.current?.focus(); }}><Icon name="x" /></button>}
        </div>
      </header>
      {searching ? <SearchResults q={search.trim()} onDone={() => { setFocused(false); setState({ search: '' }); }} /> : <ChatListArea />}
      {!searching && <NewFab />}
      <Drawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}

function ChatListArea() {
  const chats = useStore((s) => s.chats);
  const folder = useStore((s) => s.folder);
  const me = useStore((s) => s.me);
  const folders = me?.settings?.folders || [];
  const list = useMemo(() => sortedChats(chats, { folder }), [chats, folder, folders]); // eslint-disable-line
  const archived = useMemo(() => [...chats.values()].filter((c) => c.archived && c.member !== false), [chats]);
  const archUnread = archived.reduce((a, c) => a + (c.unread && !c.muted ? 1 : 0), 0);
  const folderUnread = (f) => sortedChats(chats, { folder: f.id }).filter((c) => (c.unread || c.mark_unread) && !c.muted).length;
  const allUnread = list.length && folder === 'all' ? list.filter((c) => (c.unread || c.mark_unread) && !c.muted).length : sortedChats(chats).filter((c) => (c.unread || c.mark_unread) && !c.muted).length;
  const loaded = chats.size > 0;
  return (
    <>
      {folders.length > 0 && (
        <nav className="folder-tabs" role="tablist">
          <FolderTab id="all" label="همه" active={folder === 'all'} n={allUnread} />
          {folders.map((f) => <FolderTab key={f.id} id={f.id} label={f.name} emoji={f.emoji} active={folder === f.id} n={folderUnread(f)} />)}
        </nav>
      )}
      <div className="chat-list scroll" role="list">
        <StoriesStrip />
        {folder === 'all' && archived.length > 0 && (
          <div className="chat-item archive-row" role="listitem" onClick={() => pushView('archived')}>
            <span className="avatar" style={{ width: 'var(--av)', height: 'var(--av)' }}><span className="av-in arch"><Icon name="archive" /></span></span>
            <div className="ci-body">
              <div className="ci-top"><span className="ci-title">بایگانی</span></div>
              <div className="ci-bottom"><span className="ci-text">{archived.slice(0, 4).map((c) => chatTitle(c)).join('، ')}</span>{archUnread > 0 && <span className="ci-badge muted">{fa(archUnread)}</span>}</div>
            </div>
          </div>
        )}
        {!loaded && Array.from({ length: 8 }).map((_, i) => <div key={i} className="chat-item skel"><span className="sk-av" /><div className="ci-body"><span className="sk-l" /><span className="sk-l s" /></div></div>)}
        {loaded && list.map((c) => <ChatItem key={c.id} id={c.id} />)}
        {loaded && !list.length && <Empty icon="folder" title="گفتگویی نیست" sub={folder === 'all' ? 'با دکمه مداد یک گفتگوی تازه شروع کنید.' : 'هیچ گفتگویی با شرایط این پوشه نیست.'} />}
      </div>
    </>
  );
}
function FolderTab({ id, label, emoji, active, n }) {
  const ref = useRef(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }, [active]);
  return (
    <button ref={ref} type="button" role="tab" aria-selected={active} className={cx('folder-tab', active && 'active')} onClick={() => setState({ folder: id })}
      onContextMenu={(e) => id !== 'all' && openMenu(e, [{ icon: 'pencil', label: 'ویرایش پوشه‌ها', onClick: () => pushView('settings:folders') }])}>
      {emoji && <span className="ft-emoji">{emoji}</span>}<span>{label}</span>{n > 0 && <span className="ft-badge">{fa(n)}</span>}
    </button>
  );
}

function ArchivedView() {
  const chats = useStore((s) => s.chats);
  const list = useMemo(() => sortedChats(chats, { archived: true }), [chats]);
  return (
    <div className="side-view">
      <header className="side-head glass-bar"><IconBtn icon="arrowRight" label="بازگشت" onClick={popView} /><div className="side-title">بایگانی</div></header>
      <div className="chat-list scroll">
        {list.map((c) => <ChatItem key={c.id} id={c.id} />)}
        {!list.length && <Empty icon="archive" title="بایگانی خالی است" sub="گفتگوهای بایگانی‌شده اینجا نمایش داده می‌شوند." />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chat row */
export const ChatItem = memo(function ChatItem({ id }) {
  const c = useStore((s) => s.chats.get(id));
  const peer = useStore((s) => (c?.type === 'private' ? s.users.get(c.peer_id) : null));
  const active = useStore((s) => s.active === id);
  const typing = useStore((s) => s.typing.get(id));
  const users = useStore((s) => s.users);
  const myId = useStore((s) => s.me?.id);
  const story = useStore((s) => (c?.type === 'private' ? s.stories.find((g) => g.user.id === c.peer_id) : null));
  const lp = useLongPress((e) => chatMenu(e, c));
  if (!c) return null;
  const m = c.last_message;
  const typers = typing ? [...typing.entries()].filter(([u]) => u !== myId) : [];
  const out = m && m.sender_id === myId && c.type !== 'saved' && c.type !== 'channel';
  const read = out && (c.peer_read || 0) >= m.id;
  let sub;
  if (typers.length) {
    const [uid, t] = typers[0];
    const who = c.type === 'private' ? '' : `${userName(users.get(uid)).split(' ')[0]} `;
    sub = <span className="ci-typing">{who}{typingLabel(t.kind)}<TypingDots /></span>;
  } else if (c.draft && !active) sub = <><span className="ci-draft">پیش‌نویس: </span><span>{c.draft}</span></>;
  else if (m) {
    const sender = m.sender_id === myId ? 'شما' : userName(users.get(m.sender_id)).split(' ')[0];
    sub = <>{(c.type === 'group' || (out && c.type !== 'private')) && m.type !== 'service' && <span className="ci-sender">{sender}: </span>}<span>{m.type === 'service' ? m.text : previewText(m)}</span></>;
  } else sub = <span className="ci-empty">{c.type === 'channel' ? 'کانال ایجاد شد' : c.type === 'group' ? 'گروه ایجاد شد' : 'بدون پیام'}</span>;
  const unread = c.unread || 0;
  return (
    <div className={cx('chat-item', active && 'active', c.pinned && 'pinned')} role="listitem" tabIndex={0}
      onClick={() => openChat(id)} onKeyDown={(e) => e.key === 'Enter' && openChat(id)} {...lp}>
      <Avatar {...chatAvatarProps(c)} size="var(--av)" story={story ? (story.items.every((x) => x.seen) ? 'seen' : true) : false} />
      <div className="ci-body">
        <div className="ci-top">
          <span className="ci-title">
            {c.type === 'group' && <Icon name="users" className="ci-type" />}
            {c.type === 'channel' && <Icon name="megaphone" className="ci-type" />}
            <NameLine name={chatTitle(c)} user={peer} chat={c} />
            {c.muted && <Icon name="bellOff" className="ci-muted" />}
          </span>
          <span className="ci-meta">
            {out && m.id > 0 && <Icon name={read ? 'checks' : 'check'} className={cx('ci-check', read && 'read')} />}
            <span className="ci-time">{m ? fmtListTime(m.created_at) : ''}</span>
          </span>
        </div>
        <div className="ci-bottom">
          <span className="ci-text">{sub}</span>
          {c.mentions > 0 && <span className="ci-badge mention">@</span>}
          {unread > 0 ? <span className={cx('ci-badge', c.muted && 'muted')}>{unread > 999 ? '+۹۹۹' : fa(unread)}</span>
            : c.mark_unread ? <span className={cx('ci-badge dot', c.muted && 'muted')} />
              : c.pinned ? <Icon name="pin" className="ci-pin" /> : null}
        </div>
      </div>
    </div>
  );
});
export const typingLabel = (k) => ({ photo: 'در حال ارسال عکس', file: 'در حال ارسال فایل', voice: 'در حال ضبط صدا', video: 'در حال ارسال ویدیو' }[k] || 'در حال نوشتن');
export function TypingDots() { return <span className="tdots" aria-hidden="true"><i /><i /><i /></span>; }

export function chatMenu(e, c) {
  if (!c) return;
  const pinnedCount = [...getState().chats.values()].filter((x) => x.pinned && !x.archived).length;
  const lim = getState().me?.limits?.pins || 5;
  openMenu(e, [
    { icon: 'arrowUpRight', label: 'باز کردن', onClick: () => openChat(c.id) },
    !c.archived && { icon: 'pin', label: c.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن', onClick: () => {
      if (!c.pinned && pinnedCount >= lim) { toast(`حداکثر ${fa(lim)} گفتگو قابل سنجاق است.${getState().me?.premium ? '' : ' با پریمیوم تا ۲۰.'}`, 'error'); return; }
      chatPref(c.id, { pinned: !c.pinned });
    } },
    c.type !== 'saved' && { icon: c.muted ? 'bell' : 'bellOff', label: c.muted ? 'روشن کردن اعلان' : 'بی‌صدا کردن', onClick: () => chatPref(c.id, { muted: !c.muted }) },
    c.type !== 'saved' && { icon: 'archive', label: c.archived ? 'خروج از بایگانی' : 'بایگانی', onClick: () => chatPref(c.id, { archived: !c.archived }) },
    (c.unread || c.mark_unread)
      ? { icon: 'checks', label: 'علامت خوانده‌شده', onClick: async () => { await chatPref(c.id, { mark_unread: false }); if (c.last_message) api(`/chats/${c.id}/read`, { method: 'POST', body: { last_id: c.last_message.id } }).catch(() => {}); } }
      : { icon: 'eye', label: 'علامت خوانده‌نشده', onClick: () => chatPref(c.id, { mark_unread: true }) },
    { icon: 'folder', label: 'افزودن به پوشه', onClick: () => openModal({ type: 'addToFolder', chatId: c.id }) },
    { sep: true },
    { icon: 'trash', danger: true, label: c.type === 'private' || c.type === 'saved' ? 'حذف گفتگو' : c.role === 'owner' ? 'حذف و خروج' : 'ترک کردن', onClick: () => leaveOrDelete(c) },
  ]);
}
export async function leaveOrDelete(c) {
  const title = chatTitle(c);
  if (c.type === 'private') {
    const r = await confirmDialog({ title: 'حذف گفتگو', text: `گفتگو با ${title} حذف شود؟`, ok: 'حذف', danger: true, check: peerOf(c)?.bot ? null : `حذف برای ${title} هم` });
    if (!r) return;
    try { await api(`/chats/${c.id}`, { method: 'DELETE', body: { for_all: !!r.check } }); } catch (e) { toast(e.message, 'error'); }
  } else if (c.type === 'saved') {
    if (!(await confirmDialog({ title: 'پاک کردن', text: 'همه پیام‌های ذخیره‌شده پاک شود؟', ok: 'پاک کردن', danger: true }))) return;
    try { await api(`/chats/${c.id}/clear`, { method: 'POST', body: {} }); } catch (e) { toast(e.message, 'error'); }
  } else {
    const owner = c.role === 'owner';
    const r = await confirmDialog({ title: owner ? `حذف ${c.type === 'channel' ? 'کانال' : 'گروه'}` : 'ترک کردن', text: owner ? `«${title}» برای همه اعضا حذف می‌شود. این کار برگشت‌پذیر نیست.` : `از «${title}» خارج می‌شوید؟`, ok: owner ? 'حذف برای همه' : 'خروج', danger: true });
    if (!r) return;
    try { await api(`/chats/${c.id}`, { method: 'DELETE', body: { destroy: owner } }); } catch (e) { toast(e.message, 'error'); }
  }
}

/* ------------------------------------------------------------------ stories strip */
function StoriesStrip() {
  const groups = useStore((s) => s.stories);
  const me = useStore((s) => s.me);
  const mine = groups.find((g) => g.user.id === me?.id);
  const others = groups.filter((g) => g.user.id !== me?.id).sort((a, b) => (a.items.every((x) => x.seen) ? 1 : 0) - (b.items.every((x) => x.seen) ? 1 : 0));
  return (
    <div className="stories-strip" role="list" aria-label="استوری‌ها">
      <button type="button" className="story-it" onClick={() => (mine ? setState({ storyView: { uid: me.id } }) : openModal({ type: 'storyCreate' }))}>
        <span className="story-av-wrap">
          <Avatar src={me?.avatar} name={me?.name} color={me?.color} size={54} story={mine ? true : false} />
          <span className="story-add" onClick={(e) => { e.stopPropagation(); openModal({ type: 'storyCreate' }); }}><Icon name="plus" /></span>
        </span>
        <span className="story-nm">استوری من</span>
      </button>
      {others.map((g) => (
        <button key={g.user.id} type="button" className="story-it" onClick={() => setState({ storyView: { uid: g.user.id } })}>
          <Avatar src={g.user.avatar} name={g.user.name} color={g.user.color} size={54} story={g.items.every((x) => x.seen) ? 'seen' : true} />
          <span className="story-nm">{userName(g.user).split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ search */
function SearchResults({ q, onDone }) {
  const chats = useStore((s) => s.chats);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('chats');
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    if (!q) { setRes(null); return undefined; }
    setLoading(true);
    const t = setTimeout(async () => {
      try { const r = await api(`/search?q=${encodeURIComponent(q)}`); putUsers([...r.users, ...r.msg_users]); setRes(r); } catch (e) { if (e.status !== 0) toast(e.message, 'error'); } finally { setLoading(false); }
    }, 260);
    return () => clearTimeout(t);
  }, [q]);
  const local = useMemo(() => {
    if (!q) return [];
    const s = q.toLowerCase().replace(/^@/, '');
    return sortedChats(chats).concat(sortedChats(chats, { archived: true })).filter((c) => chatTitle(c).toLowerCase().includes(s) || (c.type === 'private' ? peerOf(c)?.username : c.username)?.toLowerCase().includes(s));
  }, [q, chats]);
  const pick = (fn) => { setRecent((r) => r); fn(); onDone(); };
  if (!q) {
    const top = sortedChats(chats).filter((c) => c.type === 'private' && c.peer_id !== meId()).slice(0, 12);
    return (
      <div className="chat-list scroll search-idle">
        <div className="sec-title">افراد</div>
        <div className="people-row">
          {top.map((c) => { const u = peerOf(c); return (
            <button key={c.id} type="button" className="person" onClick={() => pick(() => openChat(c.id))}>
              <Avatar {...chatAvatarProps(c)} size={54} /><span>{userName(u).split(' ')[0]}</span>
            </button>
          ); })}
          {!top.length && <div className="muted-note">هنوز گفتگوی خصوصی ندارید. نام کاربری افراد را جستجو کنید.</div>}
        </div>
        <div className="sec-title">راهنمای جستجو</div>
        <div className="search-tips">
          <div><Icon name="at" /> نام کاربری مانند <b dir="ltr">@guardnet</b> را بنویسید</div>
          <div><Icon name="hash" /> متن پیام‌ها و نام گروه‌ها و کانال‌های عمومی را جستجو کنید</div>
        </div>
      </div>
    );
  }
  const globalUsers = (res?.users || []).filter((u) => !local.some((c) => c.type === 'private' && c.peer_id === u.id));
  const globalChats = (res?.chats || []).filter((c) => !chats.get(c.id)?.member);
  return (
    <div className="chat-list scroll">
      <div className="search-tabs">
        {[['chats', 'گفتگوها'], ['messages', 'پیام‌ها']].map(([k, l]) => <button key={k} type="button" className={cx(tab === k && 'active')} onClick={() => setTab(k)}>{l}{k === 'messages' && res?.messages?.length ? ` (${fa(res.messages.length)})` : ''}</button>)}
      </div>
      {tab === 'chats' && (
        <>
          {local.length > 0 && <><div className="sec-title">گفتگوها و مخاطبین</div>{local.map((c) => <div key={c.id} onClickCapture={() => onDone()}><ChatItem id={c.id} /></div>)}</>}
          {(globalUsers.length > 0 || globalChats.length > 0) && <div className="sec-title">جستجوی سراسری</div>}
          {globalUsers.map((u) => (
            <div key={`u${u.id}`} className="chat-item" onClick={() => pick(() => openPrivate(u.id))}>
              <Avatar src={u.avatar} name={u.name} color={u.color} size="var(--av)" online={u.online} />
              <div className="ci-body"><div className="ci-top"><span className="ci-title"><NameLine name={userName(u)} user={u} /></span></div>
                <div className="ci-bottom"><span className="ci-text" dir="ltr">@{u.username}</span></div></div>
            </div>
          ))}
          {globalChats.map((c) => (
            <div key={`c${c.id}`} className="chat-item" onClick={() => pick(() => { setState({ chats: new Map(getState().chats).set(c.id, c) }); openChat(c.id); })}>
              <Avatar src={c.photo} name={c.title} color={c.color} size="var(--av)" />
              <div className="ci-body"><div className="ci-top"><span className="ci-title"><Icon name={c.type === 'channel' ? 'megaphone' : 'users'} className="ci-type" /><NameLine name={c.title} chat={c} /></span></div>
                <div className="ci-bottom"><span className="ci-text"><span dir="ltr">@{c.username}</span> · {fa(c.members_count)} {c.type === 'channel' ? 'مشترک' : 'عضو'}</span></div></div>
            </div>
          ))}
          {loading && <div className="list-loading"><Spinner /></div>}
          {!loading && res && !local.length && !globalUsers.length && !globalChats.length && <Empty title="نتیجه‌ای یافت نشد" sub={`برای «${q}» چیزی پیدا نشد.`} />}
        </>
      )}
      {tab === 'messages' && (
        <>
          {(res?.messages || []).map((m) => {
            const c = res.msg_chats.find((x) => x.id === m.chat_id) || chats.get(m.chat_id);
            return (
              <div key={m.id} className="chat-item" onClick={() => pick(() => openChat(m.chat_id, { jumpTo: m.id }))}>
                <Avatar {...chatAvatarProps(c)} size="var(--av)" />
                <div className="ci-body">
                  <div className="ci-top"><span className="ci-title"><NameLine name={chatTitle(c)} /></span><span className="ci-meta"><span className="ci-time">{fmtListTime(m.created_at)}</span></span></div>
                  <div className="ci-bottom"><span className="ci-text"><RichText text={previewText(m)} highlight={q} /></span></div>
                </div>
              </div>
            );
          })}
          {loading && <div className="list-loading"><Spinner /></div>}
          {!loading && res && !res.messages.length && <Empty title="پیامی یافت نشد" sub="عبارت دیگری را امتحان کنید." />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ new chat FAB */
function NewFab() {
  const btn = useRef(null);
  return (
    <button ref={btn} type="button" className="fab" aria-label="گفتگوی جدید" onClick={(e) => openMenu(e, [
      { icon: 'megaphone', label: 'کانال جدید', onClick: () => pushView('newChannel') },
      { icon: 'users', label: 'گروه جدید', onClick: () => pushView('newGroup') },
      { icon: 'user', label: 'پیام خصوصی جدید', onClick: () => pushView('contacts', { pick: true }) },
    ], { anchor: btn.current })}>
      <Icon name="pencil" />
    </button>
  );
}

/* ------------------------------------------------------------------ drawer */
function Drawer({ open, onClose }) {
  const me = useStore((s) => s.me);
  const theme = me?.settings?.theme || 'dark';
  const dark = theme !== 'light';
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, [open, onClose]);
  if (!me) return null;
  const go = (fn) => { onClose(); setTimeout(fn, 10); };
  const saved = [...getState().chats.values()].find((c) => c.type === 'saved');
  return (
    <div className={cx('drawer-layer', open && 'open')} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-hidden={!open}>
      <nav className="drawer glass" aria-label="منوی اصلی">
        <div className="drawer-head">
          <Avatar src={me.avatar} name={me.name} color={me.color} size={64} onClick={() => go(() => pushView('settings'))} />
          <button type="button" className="theme-btn" aria-label="تغییر تم" onClick={() => setSetting('theme', dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} /></button>
          <div className="drawer-name"><NameLine name={me.name} user={me} /></div>
          <div className="drawer-user" dir="ltr">@{me.username}</div>
        </div>
        <div className="drawer-items scroll">
          <DItem icon="user" label="پروفایل من" onClick={() => go(() => pushView('settings:profile'))} />
          <DItem icon="bookmark" label="پیام‌های ذخیره‌شده" onClick={() => go(() => saved && openChat(saved.id))} />
          <DItem icon="contact" label="مخاطبین" onClick={() => go(() => pushView('contacts'))} />
          <DItem icon="phone" label="تماس‌ها" onClick={() => go(() => pushView('calls'))} />
          <DItem icon="archive" label="بایگانی" onClick={() => go(() => pushView('archived'))} />
          <div className="d-sep" />
          <DItem icon="users" label="گروه جدید" onClick={() => go(() => pushView('newGroup'))} />
          <DItem icon="megaphone" label="کانال جدید" onClick={() => go(() => pushView('newChannel'))} />
          <div className="d-sep" />
          <DItem icon="gear" label="تنظیمات" onClick={() => go(() => pushView('settings'))} />
          <div className="d-item" onClick={() => setSetting('theme', dark ? 'light' : 'dark')}>
            <Icon name="moon" /><span>حالت شب</span><Toggle checked={dark} onChange={(v) => setSetting('theme', v ? 'dark' : 'light')} label="حالت شب" />
          </div>
          <DItem icon="premium" label={me.premium ? 'GuardNet پریمیوم (فعال)' : 'GuardNet پریمیوم'} onClick={() => go(() => pushView('settings:premium'))} star />
          <DItem icon="help" label="پشتیبانی GuardNet" onClick={() => go(() => resolveAndOpen('guardnet'))} />
        </div>
        <div className="drawer-foot"><Logo size={18} /> GuardNet Web · نسخه ۳٫۰</div>
      </nav>
    </div>
  );
}
function DItem({ icon, label, onClick, star }) {
  return <button type="button" className="d-item" onClick={onClick}>{star ? <PremiumStar size={22} /> : <Icon name={icon} />}<span>{label}</span></button>;
}
export { settings };
