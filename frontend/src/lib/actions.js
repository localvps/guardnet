import { api, setToken, getToken, createSocket, setUnauthorizedHandler, uploadFile } from './api.js';
import { getState, setState, putUsers, putChat, removeChat, setMsgs, upsertMsg, dropMsgs, toast } from './store.js';
import { previewText, fa } from './format.jsx';
import { sound } from './sound.js';

let socket = null;
export const wsSend = (ev, d) => socket?.send(ev, d);

/* ------------------------------------------------------------------ display helpers */
export const meId = () => getState().me?.id;
export const userOf = (id) => getState().users.get(id) || (getState().me?.id === id ? getState().me : null);
export function userName(u) {
  if (!u) return 'کاربر';
  if (u.deleted) return 'حساب حذف‌شده';
  return u.id === meId() ? u.name : u.name;
}
export function peerOf(c) { return c?.type === 'private' ? userOf(c.peer_id) : null; }
export function chatTitle(c) {
  if (!c) return '';
  if (c.type === 'saved') return 'پیام‌های ذخیره‌شده';
  if (c.type === 'private') return userName(peerOf(c));
  return c.title || 'گفتگو';
}
export function chatAvatarProps(c) {
  if (!c) return {};
  if (c.type === 'saved') return { saved: true, color: ['#3fa2ff', '#2b7fff'], name: 'Saved' };
  if (c.type === 'private') {
    const u = peerOf(c);
    return { src: u?.avatar, name: userName(u), color: u?.color, online: !!u?.online && !u?.bot, deleted: u?.deleted };
  }
  return { src: c.photo, name: c.title, color: c.color };
}
export function lastSeenText(u) {
  if (!u) return '';
  if (u.deleted) return 'حساب حذف‌شده';
  if (u.bot) return 'ربات';
  if (u.online === null) return 'حساب رسمی';
  if (u.banned) return 'مسدود شده';
  if (u.online) return 'آنلاین';
  if (u.seen_hidden || !u.last_seen) return 'اخیراً آنلاین بوده';
  const s = Date.now() - u.last_seen;
  if (s < 60e3) return 'لحظاتی پیش آنلاین بود';
  if (s < 3600e3) return `${fa(Math.floor(s / 60e3))} دقیقه پیش آنلاین بود`;
  const d = new Date(u.last_seen); const n = new Date();
  const hm = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  if (d.toDateString() === n.toDateString()) return `امروز ساعت ${hm} آنلاین بود`;
  if (s < 2 * 86400e3) return `دیروز ساعت ${hm} آنلاین بود`;
  if (s < 7 * 86400e3) return 'این هفته آنلاین بوده';
  return new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(d) + ' آنلاین بود';
}

/* ------------------------------------------------------------------ settings & theme */
export const DEFAULT_SETTINGS = {
  theme: 'dark', accent: '#3390ec', fontSize: 16, radius: 16, motion: true, blur: true, wallpaper: 'gradient',
  sendEnter: true, sound: true, notify: true, preview: true, bigEmoji: true, autoplay: true, chatList: 'comfortable',
  folders: [], stealth: false, recentEmoji: [], passcode: null, autolock: 0, time24: true, quickReaction: '👍',
  chatWidth: 'normal', bubbleStyle: 'classic', showAvatars: true, showNames: true, confirmDelete: true,
  wallpaperIntensity: 100, messageSound: true, sidebarDensity: 'comfortable', enterToSend: true,
  readReceipts: true, lastSeenPrivacy: 'all', photoPrivacy: 'all', callsPrivacy: 'all', groupsPrivacy: 'all',
  forwardsPrivacy: 'all', archivedChats: false, messageFontSize: 16, bubbleMaxWidth: 780,
  showOnlineStatus: true, typingIndicator: true, linkPreview: true, voicePlaybackSpeed: 1,
};
export const settings = () => ({ ...DEFAULT_SETTINGS, ...(getState().me?.settings || {}) });

const ACCENTS_2 = { '#3390ec': '#5eb5f7', '#8774e1': '#b39bff', '#e17076': '#ff9f9f', '#40a7a0': '#6fd6c8', '#eea95b': '#ffd08a', '#e36cb0': '#ff9bd2', '#54b848': '#8ee57f' };
export function applySettings(s = settings()) {
  const root = document.documentElement;
  const premiumTheme = ['aurora', 'gold', 'crystal', 'neon', 'cyber', 'ocean'].includes(s.theme) && !getState().me?.premium;
  const theme = premiumTheme ? 'dark' : s.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme;
  root.dataset.theme = theme;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-2', ACCENTS_2[s.accent] || s.accent);
  root.style.setProperty('--fs', `${s.fontSize}px`);
  root.style.setProperty('--br', `${s.radius}px`);
  root.dataset.motionOpt = s.motion ? 'on' : 'off';
  root.dataset.blur = s.blur ? 'on' : 'off';
  root.dataset.wall = s.wallpaper;
  root.dataset.density = s.chatList;
  root.dataset.bubbleStyle = s.bubbleStyle || 'classic';
  root.dataset.chatWidth = s.chatWidth || 'normal';
  root.dataset.sidebarDensity = s.sidebarDensity || 'comfortable';
  if (s.wallpaperIntensity != null) root.style.setProperty('--wall-opacity', `${s.wallpaperIntensity / 100}`);
  if (s.bubbleMaxWidth != null) root.style.setProperty('--chat-max', `${s.bubbleMaxWidth}px`);
  root.dataset.showAvatars = s.showAvatars ? 'on' : 'off';
  root.dataset.showNames = s.showNames ? 'on' : 'off';
  root.dataset.linkPreview = s.linkPreview ? 'on' : 'off';
  root.dataset.typingIndicator = s.typingIndicator ? 'on' : 'off';
  root.dataset.showOnline = s.showOnlineStatus ? 'on' : 'off';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : theme === 'midnight' ? '#000000' : '#0e1621');
}
let flushT = null; let pending = {};
export function setSetting(k, v) {
  const me = getState().me; if (!me) return;
  const prev = me.settings?.[k];
  setState({ me: { ...me, settings: { ...(me.settings || {}), [k]: v } } });
  applySettings();
  pending[k] = v;
  clearTimeout(flushT);
  flushT = setTimeout(async () => {
    const body = pending; pending = {};
    try { await api('/me/settings', { method: 'PATCH', body }); } catch (e) {
      toast(e.message, 'error');
      const m = getState().me; if (m) setState({ me: { ...m, settings: { ...(m.settings || {}), [k]: prev } } });
      applySettings();
    }
  }, 350);
}

/* ------------------------------------------------------------------ session */
export async function boot() {
  applySettings(DEFAULT_SETTINGS);
  setUnauthorizedHandler((d) => onSessionLost(d?.code === 'banned' ? d.error : 'نشست شما پایان یافت؛ دوباره وارد شوید.'));
  try {
    const r = await api('/auth/resume');
    if (r?.token) return startSession(r.token, r.me);
  } catch { /* offline or no session */ }
  setState({ phase: 'auth' });
}

export async function startSession(token, me) {
  setToken(token);
  setState({ me, phase: me?.settings?.passcode ? 'locked' : 'app', chats: new Map(), users: new Map([[me.id, me]]), msgs: new Map(), active: null, panel: null, view: { name: 'chats' }, stack: [] });
  applySettings();
  socket?.close();
  socket = createSocket({ onEvent, onState: (conn) => { setState({ conn }); if (conn === 'online') resync(); } });
  await loadChats();
  loadStories();
  handleDeepLink();
}

let lost = false;
export function onSessionLost(msg) {
  if (lost || !getToken()) return;
  lost = true;
  socket?.close(); socket = null;
  setToken(null);
  endCallSilently();
  setState({ phase: 'auth', me: null, chats: new Map(), users: new Map(), msgs: new Map(), active: null, panel: null, modal: null, call: null });
  applySettings(DEFAULT_SETTINGS);
  if (msg) toast(msg, 'error', 5000);
  setTimeout(() => { lost = false; }, 500);
}
export async function logout() {
  try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* */ }
  onSessionLost();
}
let endCallHook = () => {};
export const setEndCallHook = (f) => { endCallHook = f; };
function endCallSilently() { try { endCallHook(); } catch { /* */ } }

let resyncing = false;
async function resync() {
  if (resyncing || getState().phase === 'auth') return;
  resyncing = true;
  try {
    await loadChats();
    const a = getState().active;
    if (a) {
      const cur = getState().msgs.get(a);
      const last = cur?.list?.[cur.list.length - 1]?.id;
      if (last) await loadMessages(a, { after: last }); else await loadMessages(a, {});
    }
  } catch { /* */ } finally { resyncing = false; }
}

/* ------------------------------------------------------------------ realtime events */
const typingTimers = new Map();
function onEvent(ev, d) {
  const st = getState();
  switch (ev) {
    case 'message:new': {
      putUsers(d.users);
      putChat(d.chat);
      upsertMsg(d.message);
      const m = d.message;
      if (m.sender_id !== st.me?.id) {
        clearTyping(m.chat_id, m.sender_id);
        const open = st.active === m.chat_id && document.visibilityState === 'visible';
        if (open) scheduleRead(m.chat_id);
        notifyMessage(d.chat, m, open);
      }
      break;
    }
    case 'message:update': upsertMsg(d.message); break;
    case 'message:delete': dropMsgs(d.chat_id, d.ids); break;
    case 'chat:update': putUsers(d.users); putChat(d.chat); if (d.chat && !d.chat.member && getState().active !== d.chat.id && ['group', 'channel'].includes(d.chat.type)) removeChat(d.chat.id); break;
    case 'chat:removed': removeChat(d.chat_id); break;
    case 'chat:cleared': setMsgs(d.chat_id, { list: [], hasOlder: false }); break;
    case 'read': {
      const c = st.chats.get(d.chat_id);
      if (c && d.peer_read != null) putChat({ id: c.id, peer_read: Math.max(c.peer_read || 0, d.peer_read) });
      break;
    }
    case 'typing': setTyping(d.chat_id, d.user_id, d.kind, d.stop); break;
    case 'user:update': putUsers([d]); break;
    case 'me:update': {
      const me = { ...st.me, ...d };
      setState({ me }); putUsers([d]); applySettings();
      break;
    }
    case 'reaction:notify': {
      const u = userOf(d.user_id);
      if (settings().notify && st.active !== d.chat_id) toast(`${userName(u)} به پیام شما واکنش ${d.emoji} نشان داد`);
      break;
    }
    case 'story:new': case 'story:viewed': loadStories(); break;
    case 'session:revoked': onSessionLost(d?.banned ? `حساب شما توسط مدیریت مسدود شد.${d.reason ? ' دلیل: ' + d.reason : ''}` : 'این نشست از دستگاه دیگری خاتمه یافت.'); break;
    default:
      if (ev.startsWith('call:')) callEventHook(ev, d);
  }
}
let callEventHook = () => {};
export const setCallEventHook = (f) => { callEventHook = f; };

function setTyping(cid, uid, kind, stop) {
  const key = `${cid}:${uid}`;
  clearTimeout(typingTimers.get(key));
  const typing = new Map(getState().typing);
  const m = new Map(typing.get(cid) || []);
  if (stop) m.delete(uid); else m.set(uid, { kind });
  typing.set(cid, m);
  setState({ typing });
  if (!stop) typingTimers.set(key, setTimeout(() => clearTyping(cid, uid), 6000));
}
function clearTyping(cid, uid) {
  const t = getState().typing.get(cid);
  if (!t?.has(uid)) return;
  const typing = new Map(getState().typing); const m = new Map(t); m.delete(uid); typing.set(cid, m);
  setState({ typing });
}
let lastTypingSent = 0;
export function sendTyping(cid, kind = 'text', stop = false) {
  if (stop) { lastTypingSent = 0; wsSend('typing', { chat_id: cid, kind, stop: true }); return; }
  if (Date.now() - lastTypingSent < 3000) return;
  lastTypingSent = Date.now();
  wsSend('typing', { chat_id: cid, kind });
}

function notifyMessage(chat, m, open) {
  if (!chat || chat.muted || m.silent || m.type === 'service') return;
  const s = settings();
  if (s.sound) sound(open ? 'in' : 'notify');
  if (!open && s.notify && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(chatTitle(chat), { body: s.preview ? previewText(m).slice(0, 120) : 'پیام جدید', tag: `c${chat.id}`, silent: true });
      n.onclick = () => { window.focus(); openChat(chat.id); n.close(); };
    } catch { /* */ }
  }
}

/* ------------------------------------------------------------------ chats */
export async function loadChats() {
  const r = await api('/chats');
  putUsers(r.users);
  const chats = new Map();
  for (const c of r.chats) chats.set(c.id, { ...(getState().chats.get(c.id) || {}), ...c });
  setState({ chats });
}

export function sortedChats(chats, { archived = false, folder = 'all' } = {}) {
  const s = settings();
  let list = [...chats.values()].filter((c) => c.member !== false && !!c.archived === archived);
  if (folder !== 'all') {
    const f = (s.folders || []).find((x) => x.id === folder);
    if (f) list = list.filter((c) => folderMatch(f, c));
  }
  return list.sort((a, b) => {
    if (!archived && (a.pinned || 0) !== (b.pinned || 0)) {
      if (a.pinned && b.pinned) return a.pinned - b.pinned;
      return a.pinned ? -1 : 1;
    }
    const ta = a.last_message?.created_at || a.created_at || 0;
    const tb = b.last_message?.created_at || b.created_at || 0;
    return tb - ta;
  });
}
export function folderMatch(f, c) {
  if (f.chats?.includes(c.id)) return true;
  if (f.exclude?.includes(c.id)) return false;
  const inc = f.include || [];
  if (inc.includes('unread') && !(c.unread > 0 || c.mark_unread)) return false;
  const types = inc.filter((x) => x !== 'unread');
  if (!types.length) return inc.includes('unread') || false;
  const u = peerOf(c);
  return types.some((t) => (t === 'private' && c.type === 'private' && !u?.bot) || (t === 'group' && c.type === 'group') || (t === 'channel' && c.type === 'channel') || (t === 'bot' && u?.bot));
}

export async function openChat(id, { jumpTo } = {}) {
  const st = getState();
  if (st.active && st.active !== id) saveDraftNow();
  setState({ active: id, reply: null, edit: null, select: null, jump: jumpTo || null, panel: st.panel && window.innerWidth > 1180 ? st.panel : null });
  const c = getState().chats.get(id);
  if (!c) {
    try { const r = await api(`/chats/${id}`); putUsers(r.users); putChat(r.chat); } catch (e) { toast(e.message, 'error'); setState({ active: null }); return; }
  }
  const cur = getState().msgs.get(id);
  if (jumpTo) await loadMessages(id, { around: jumpTo });
  else if (!cur?.loaded || cur.hasNewer) await loadMessages(id, {});
  scheduleRead(id);
}
export function closeChat() { saveDraftNow(); setState({ active: null, panel: null, reply: null, edit: null, select: null }); }

export async function loadMessages(cid, { before, around, after } = {}) {
  const cur = getState().msgs.get(cid);
  if (cur?.loading) return;
  setMsgs(cid, { loading: true });
  try {
    const qs = new URLSearchParams({ limit: '50' });
    if (before) qs.set('before', before); if (around) qs.set('around', around); if (after) qs.set('after', after);
    const r = await api(`/chats/${cid}/messages?${qs}`);
    putUsers(r.users);
    setMsgs(cid, (c) => {
      if (before) return { list: [...r.messages, ...c.list], hasOlder: r.has_older, loading: false, loaded: true };
      if (after) {
        const ids = new Set(c.list.map((m) => m.id));
        return { list: [...c.list, ...r.messages.filter((m) => !ids.has(m.id))], hasNewer: r.has_newer, loading: false, loaded: true };
      }
      return { list: r.messages, hasOlder: r.has_older, hasNewer: !!r.has_newer, loading: false, loaded: true };
    });
  } catch (e) {
    setMsgs(cid, { loading: false });
    if (e.status !== 0) toast(e.message, 'error');
  }
}

const readTimers = new Map();
export function scheduleRead(cid) {
  clearTimeout(readTimers.get(cid));
  readTimers.set(cid, setTimeout(() => markRead(cid), 250));
}
export async function markRead(cid) {
  const st = getState(); const c = st.chats.get(cid); const list = st.msgs.get(cid)?.list;
  if (!c || !c.member || !list?.length || document.visibilityState !== 'visible') return;
  const last = list[list.length - 1].id;
  if (last <= (c.last_read || 0) && !c.unread && !c.mark_unread) return;
  putChat({ id: cid, unread: 0, mentions: 0, mark_unread: false, last_read: Math.max(last, c.last_read || 0) });
  try { await api(`/chats/${cid}/read`, { method: 'POST', body: { last_id: last } }); } catch { /* */ }
}
document.addEventListener('visibilitychange', () => { const a = getState().active; if (a && document.visibilityState === 'visible') scheduleRead(a); });

export async function chatPref(cid, patch) {
  try { const c = await api(`/chats/${cid}/me`, { method: 'PATCH', body: patch }); putChat(c); return true; } catch (e) { toast(e.message, 'error'); return false; }
}

/* drafts */
const drafts = new Map();
export const getDraft = (cid) => (drafts.has(cid) ? drafts.get(cid) : getState().chats.get(cid)?.draft || '');
export function setDraft(cid, text) { drafts.set(cid, text); }
function saveDraftNow() {
  const a = getState().active; if (!a || !drafts.has(a)) return;
  const text = drafts.get(a); const c = getState().chats.get(a);
  if (c && c.member && (c.draft || '') !== text) { putChat({ id: a, draft: text }); api(`/chats/${a}/me`, { method: 'PATCH', body: { draft: text } }).catch(() => {}); }
}

/* ------------------------------------------------------------------ messages */
let tmpId = -1;
export async function sendMessage(cid, { type = 'text', text = '', data = {}, reply_to, silent, sched_at }) {
  const me = getState().me;
  const temp = sched_at ? null : { id: tmpId--, chat_id: cid, sender_id: me.id, type, text, data, created_at: Date.now(), pending: true, reactions: {}, reply: reply_to ? { id: reply_to } : undefined };
  if (temp) setMsgs(cid, (c) => (c.loaded && !c.hasNewer ? { list: [...c.list, temp] } : {}));
  try {
    const r = await api(`/chats/${cid}/messages`, { method: 'POST', body: { type, text, data, reply_to, silent, sched_at } });
    if (temp) setMsgs(cid, (c) => {
      const has = c.list.some((m) => m.id === r.message.id);
      return { list: has ? c.list.filter((m) => m.id !== temp.id) : c.list.map((m) => (m.id === temp.id ? r.message : m)) };
    });
    if (settings().sound && !silent) sound('out');
    if (sched_at) toast('پیام زمان‌بندی شد.', 'ok');
    drafts.set(cid, '');
    return r.message;
  } catch (e) {
    if (temp) setMsgs(cid, (c) => ({ list: c.list.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)) }));
    toast(e.message, 'error');
    return null;
  }
}
export async function sendFile(cid, file, { caption = '', reply_to, spoiler, kind, extra = {} } = {}) {
  const me = getState().me;
  const type = kind || (file.type.startsWith('image/') && !/svg|heic/.test(file.type) ? 'image' : file.type.startsWith('video/') ? 'video' : 'file');
  if (file.size > (me.limits?.upload || 20 * 1024 * 1024)) {
    toast(me.premium ? 'حجم فایل بیش از ۲۰۰ مگابایت است.' : 'حداکثر حجم فایل ۲۰ مگابایت است. با پریمیوم تا ۲۰۰ مگابایت.', 'error');
    return;
  }
  const local = URL.createObjectURL(file);
  const dims = type === 'image' ? await imageDims(local) : type === 'video' ? await videoDims(local) : {};
  const temp = { id: tmpId--, chat_id: cid, sender_id: me.id, type, text: caption, created_at: Date.now(), pending: true, progress: 0, reactions: {},
    data: { url: local, local: true, name: file.name, size: file.size, mime: file.type, ...dims, ...extra } };
  setMsgs(cid, (c) => (c.loaded && !c.hasNewer ? { list: [...c.list, temp] } : {}));
  const ctrl = new AbortController();
  uploads.set(temp.id, ctrl);
  wsSend('typing', { chat_id: cid, kind: type === 'image' ? 'photo' : type === 'voice' ? 'voice' : 'file' });
  try {
    const f = await uploadFile(file, (p) => setMsgs(cid, (c) => ({ list: c.list.map((m) => (m.id === temp.id ? { ...m, progress: p } : m)) })), ctrl.signal);
    const r = await api(`/chats/${cid}/messages`, { method: 'POST', body: { type, text: caption, reply_to, data: { file: f.id, ...dims, ...extra, spoiler } } });
    setMsgs(cid, (c) => {
      const has = c.list.some((m) => m.id === r.message.id);
      return { list: has ? c.list.filter((m) => m.id !== temp.id) : c.list.map((m) => (m.id === temp.id ? r.message : m)) };
    });
    if (settings().sound) sound('out');
  } catch (e) {
    setMsgs(cid, (c) => ({ list: c.list.filter((m) => m.id !== temp.id) }));
    if (e?.name !== 'AbortError') toast(e.message || 'بارگذاری ناموفق بود.', 'error');
  } finally {
    uploads.delete(temp.id);
    wsSend('typing', { chat_id: cid, stop: true });
    setTimeout(() => URL.revokeObjectURL(local), 60000);
  }
}
const uploads = new Map();
export const cancelUpload = (id) => uploads.get(id)?.abort();
function imageDims(url) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = url; });
}
function videoDims(url) {
  return new Promise((res) => {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration || 0) });
    v.onerror = () => res({}); v.src = url;
  });
}
export function retryMessage(m) {
  setMsgs(m.chat_id, (c) => ({ list: c.list.filter((x) => x.id !== m.id) }));
  sendMessage(m.chat_id, { type: m.type, text: m.text, data: m.data });
}

export async function editMessage(mid, text) {
  try { const m = await api(`/messages/${mid}`, { method: 'PATCH', body: { text } }); upsertMsg(m); return true; } catch (e) { toast(e.message, 'error'); return false; }
}
export async function deleteMessages(ids, forAll) {
  const real = ids.filter((x) => x > 0);
  const st = getState();
  if (st.active) dropMsgs(st.active, ids);
  if (!real.length) return;
  try { await api('/messages/delete', { method: 'POST', body: { ids: real, for_all: !!forAll } }); } catch (e) { toast(e.message, 'error'); }
}
export async function react(m, emoji) {
  if (m.id < 0) return;
  const r = m.reactions || {};
  const mine = Object.entries(r).find(([, v]) => v.me)?.[0];
  const next = {};
  for (const [e, v] of Object.entries(r)) { const n = v.me ? v.n - 1 : v.n; if (n > 0) next[e] = { ...v, n, me: false }; }
  if (mine !== emoji) next[emoji] = { ...(next[emoji] || { n: 0 }), n: (next[emoji]?.n || 0) + 1, me: true, users: [...(next[emoji]?.users || []), meId()].slice(0, 3) };
  upsertMsg({ ...m, reactions: next });
  try { upsertMsg(await api(`/messages/${m.id}/react`, { method: 'POST', body: { emoji } })); } catch (e) { toast(e.message, 'error'); upsertMsg(m); }
}
export async function pinMessage(m, pinned, silent = false) {
  try { await api(`/messages/${m.id}/pin`, { method: 'POST', body: { pinned, silent } }); toast(pinned ? 'پیام سنجاق شد.' : 'سنجاق برداشته شد.', 'ok'); } catch (e) { toast(e.message, 'error'); }
}
export async function vote(m, opts) {
  try { upsertMsg(await api(`/messages/${m.id}/vote`, { method: 'POST', body: { opts } })); } catch (e) { toast(e.message, 'error'); }
}
export async function forwardMessages(fromChat, ids, to, hideSender = false) {
  try {
    const r = await api('/messages/forward', { method: 'POST', body: { from_chat: fromChat, ids, to, hide_sender: hideSender } });
    toast(r.sent ? `${fa(r.sent)} پیام بازارسال شد.` : 'بازارسال انجام نشد.', r.sent ? 'ok' : 'error');
  } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------------------------------------------ open private / resolve */
export async function openPrivate(uid) {
  try { const r = await api('/chats/private', { method: 'POST', body: { user_id: uid } }); putUsers(r.users); putChat(r.chat); await openChat(r.chat.id); setState({ view: { name: 'chats' }, stack: [], search: '' }); } catch (e) { toast(e.message, 'error'); }
}
export async function resolveAndOpen(name) {
  try {
    const r = await api(`/resolve/${encodeURIComponent(name)}`);
    if (r.user) { putUsers([r.user]); openPrivate(r.user.id); }
    else if (r.chat) { putChat(r.chat); openChat(r.chat.id); }
  } catch (e) { toast(e.message, 'error'); }
}
export async function joinChat(cid) {
  try { const c = await api(`/chats/${cid}/join`, { method: 'POST', body: {} }); putChat(c); await loadMessages(cid, {}); toast('عضو شدید.', 'ok'); } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------------------------------------------ stories */
export async function loadStories() {
  try { const r = await api('/stories'); putUsers(r.groups.map((g) => g.user)); setState({ stories: r.groups }); } catch { /* */ }
}

/* ------------------------------------------------------------------ deep links: #@user  #join/CODE  #qr/TOKEN */
export function handleDeepLink() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (h.startsWith('@')) resolveAndOpen(h.slice(1));
  else if (h.startsWith('join/')) setState({ modal: { type: 'invite', code: h.slice(5) } });
  else if (h.startsWith('qr/')) setState({ modal: { type: 'qrApprove', token: h.slice(3) } });
}
window.addEventListener('hashchange', () => { if (getState().phase === 'app') handleDeepLink(); });

/* ------------------------------------------------------------------ profile helpers */
export async function uploadAvatar(file) {
  if (!file.type.startsWith('image/')) { toast('یک فایل تصویری انتخاب کنید.', 'error'); return; }
  try {
    const f = await uploadFile(file);
    const me = await api('/me', { method: 'PATCH', body: { avatar: f.id } });
    setState({ me }); putUsers([me]); toast('عکس پروفایل به‌روز شد.', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}
export function pushView(name, props = {}) { const st = getState(); setState({ stack: [...st.stack, st.view], view: { name, ...props } }); }
export function popView() { const st = getState(); const stack = st.stack.slice(); const view = stack.pop() || { name: 'chats' }; setState({ stack, view }); }
export function resetView() { setState({ stack: [], view: { name: 'chats' } }); }
export const openModal = (m) => setState({ modal: m });
export const closeModal = () => setState({ modal: null });
