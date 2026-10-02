/* GuardNet Admin — API client. The session token lives in memory only (never in storage). */
const P = ['__PORT_8000__'][0];
export const API = P.startsWith('__') ? (import.meta.env.VITE_API_URL || '') : (/^(https?:)?\//.test(P) ? P : `../${P}`);
export const assetUrl = (u) => (!u ? null : /^(https?:|data:|blob:)/.test(u) ? u : API.replace(/\/$/, '') + u);

let token = null;
export const setToken = (t) => { token = t; };
export const hasToken = () => !!token;

export class ApiError extends Error {
  constructor(status, msg, data) { super(msg); this.status = status; this.data = data || {}; }
}
const hooks = { unauthorized: () => {}, reauth: () => Promise.resolve(false), activity: () => {} };
export const setHooks = (h) => Object.assign(hooks, h);

async function raw(path, method, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API}/admin-api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'اتصال به سرور برقرار نشد.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { res, data };
}

export async function api(path, { method = 'GET', body } = {}, retried = false) {
  const { res, data } = await raw(path, method, body);
  if (res.ok) { hooks.activity(); return data; }
  if (res.status === 428 && data?.code === 'reauth' && !retried) {
    const ok = await hooks.reauth();
    if (ok) return api(path, { method, body }, true);
    throw new ApiError(428, 'عملیات لغو شد؛ تأیید هویت انجام نشد.', data);
  }
  if (res.status === 401 && data?.code === 'unauthorized' && token) hooks.unauthorized(data.error);
  if (res.status === 403 && data?.code === 'ip_denied') hooks.unauthorized(data.error);
  throw new ApiError(res.status, data?.error || 'خطایی رخ داد.', data);
}

export function adminSocket({ onEvent, onState }) {
  let ws = null; let closed = false; let retry = 0; let timer = null; let ping = null;
  const open = () => {
    if (closed || !token) return;
    onState('connecting');
    const u = new URL(`${API}/admin-ws`, location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.searchParams.set('token', token);
    try { ws = new WebSocket(u.toString()); } catch { schedule(); return; }
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.ev === 'hello') { retry = 0; onState('online'); }
      else if (m.ev !== 'pong') onEvent(m.ev, m.d);
    };
    ws.onclose = () => { clearInterval(ping); if (!closed) { onState('offline'); schedule(); } };
    ws.onerror = () => {};
    clearInterval(ping);
    ping = setInterval(() => { try { if (ws?.readyState === 1) ws.send('{"ev":"ping"}'); } catch { /* */ } }, 25000);
  };
  const schedule = () => { clearTimeout(timer); retry = Math.min(retry + 1, 6); timer = setTimeout(open, 800 * 2 ** (retry - 1)); };
  open();
  return { close() { closed = true; clearTimeout(timer); clearInterval(ping); try { ws?.close(); } catch { /* */ } } };
}

/** End the server-side session when the tab is closed or reloaded (the token only lives in memory anyway). */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!token) return;
    try {
      fetch(`${API}/admin-api/auth/logout`, { method: 'POST', keepalive: true, credentials: 'omit', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    } catch { /* ignore */ }
  });
}
