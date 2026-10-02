import { useState } from 'react';
import { getState, setState } from '../lib/store.js';
import { logout, settings } from '../lib/actions.js';
import { Logo, Field, Button } from './ui.jsx';

export async function hashPasscode(code, uid) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`guardnet-passcode:${uid}:${code}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function Lock() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  async function unlock(e) {
    e.preventDefault();
    if (busy || !code) return;
    setBusy(true);
    const h = await hashPasscode(code, getState().me.id);
    setBusy(false);
    if (h === settings().passcode) { setState({ phase: 'app', lockedAt: 0 }); return; }
    const n = tries + 1; setTries(n); setCode('');
    setErr(n >= 5 ? 'تلاش زیاد؛ برای امنیت از حساب خارج می‌شوید…' : 'رمز محلی اشتباه است');
    if (n >= 5) setTimeout(logout, 1200);
  }
  return (
    <div className="auth lock">
      <div className="auth-bg" aria-hidden="true" />
      <div className="auth-scroll">
        <form className="auth-page" onSubmit={unlock} noValidate>
          <div className="auth-logo"><Logo size={110} /></div>
          <h1 className="auth-title">GuardNet قفل است</h1>
          <p className="auth-sub">برای ادامه، رمز محلی این دستگاه را وارد کنید.</p>
          <div className="auth-fields">
            <Field label="رمز محلی" type="password" value={code} onChange={(v) => { setCode(v); setErr(''); }} error={err} autoFocus dir="ltr" inputMode="numeric" autoComplete="off" />
          </div>
          <Button type="submit" full loading={busy} className={code ? 'auth-next ready' : 'auth-next'}>باز کردن</Button>
          <button type="button" className="auth-link" onClick={logout}>رمز را فراموش کرده‌ام (خروج از حساب)</button>
        </form>
      </div>
    </div>
  );
}
