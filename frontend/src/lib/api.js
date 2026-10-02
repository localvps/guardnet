/* GuardNet — HTTP + WebSocket client */
const P = ['__PORT_8000__'][0];
/** '' in dev / single-origin production; rewritten to a proxy path when deployed as a preview. */
export const API = P.startsWith('__') ? (import.meta.env.VITE_API_URL || '') : P;
export const assetUrl = (u) => (!u ? null : /^(https?:|data:|blob:)/.test(u) ? u : (API ? API.replace(/\/$/, '') : '') + u);

let token = null;
export const setToken = (t) => { token = t; };
export const getToken = () => token;

export class ApiError extends Error {
  constructor(status, msg, data) { super(msg); this.status = status; this.data = data || {}; }
}
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, raw, signal, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API}/api${path}`, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && token && data?.code === 'unauthorized') onUnauthorized(data);
    if (res.status === 403 && data?.code === 'banned') onUnauthorized(data);
    throw new ApiError(res.status, data?.error || 'خطایی رخ داد.', data);
  }
  return data;
}

/** Chunked, resumable upload with progress callback. */
export async function uploadFile(file, onProgress, signal) {
  const init = await api('/files', { method: 'POST', body: { name: file.name || 'file', size: file.size, mime: file.type || 'application/octet-stream' }, signal });
  const chunk = init.chunk || 4 * 1024 * 1024;
  let off = 0;
  while (off < file.size) {
    const part = file.slice(off, off + chunk);
    let tries = 0;
    for (;;) {
      try {
        const r = await api(`/files/${init.id}?offset=${off}`, { method: 'PUT', body: part, raw: true, signal, headers: { 'Content-Type': 'application/octet-stream' } });
        off = r.received; break;
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        if (e.status === 409 && e.data?.received != null) { off = e.data.received; break; }
        if (++tries > 3 || (e.status && e.status < 500)) throw e;
        await new Promise((r) => setTimeout(r, 600 * tries));
      }
    }
    onProgress?.(off / file.size);
  }
  return api(`/files/${init.id}/done`, { method: 'POST', body: {}, signal });
}

/* ------------------------------------------------------------------ WebSocket with auto-reconnect */
export function createSocket({ onEvent, onState }) {
  let ws = null; let closed = false; let retry = 0; let timer = null; let ping = null;
  const url = () => {
    const u = new URL(`${API}/ws`, location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.searchParams.set('token', token || '');
    return u.toString();
  };
  const open = () => {
    if (closed || !token) return;
    onState('connecting');
    try { ws = new WebSocket(url()); } catch { schedule(); return; }
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.ev === 'hello') onState('online');
      if (m.ev !== 'pong') onEvent(m.ev, m.d || {});
    };
    ws.onclose = (e) => {
      clearInterval(ping);
      if (closed) return;
      if (e.code === 4401) { onEvent('session:revoked', {}); return; }
      onState('offline'); schedule();
    };
    ws.onerror = () => {};
    clearInterval(ping);
    ping = setInterval(() => send('ping', {}), 20000);
  };
  const schedule = () => {
    clearTimeout(timer);
    const d = Math.min(1000 * 2 ** retry, 15000) + Math.random() * 400;
    retry++;
    timer = setTimeout(open, d);
  };
  const send = (ev, d) => {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ ev, d })); return true; }
    return false;
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) { retry = 0; clearTimeout(timer); open(); } };
  const onOnline = () => { retry = 0; clearTimeout(timer); if (!ws || ws.readyState > 1) open(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  open();
  return {
    send,
    close() {
      closed = true; clearTimeout(timer); clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      try { ws?.close(); } catch { /* */ }
    },
  };
}
