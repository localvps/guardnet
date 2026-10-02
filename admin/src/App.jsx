import { useCallback, useEffect, useRef, useState } from 'react';
import { live, useLive, can } from './live.js';
import QRCode from 'qrcode';
import { api, setToken, setHooks, adminSocket, ApiError } from './api.js';
import {
  Logo, Icon, Button, Field, PasswordField, CodeField, Modal, Toasts, Dialogs, SecretBox, toast, cx, fa, IconBtn, Spinner, pwChecks, PwChecklist,
} from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import Chats from './pages/Chats.jsx';
import Reports from './pages/Reports.jsx';
import Broadcast from './pages/Broadcast.jsx';
import Security from './pages/Security.jsx';
import Audit from './pages/Audit.jsx';
import Admins from './pages/Admins.jsx';
import Account from './pages/Account.jsx';

const NAV = [
  ['dashboard', 'داشبورد', 'grid', 'viewer'],
  ['users', 'کاربران', 'users', 'viewer'],
  ['chats', 'گفتگوها', 'message', 'viewer'],
  ['reports', 'گزارش‌ها', 'flag', 'viewer'],
  ['broadcast', 'اطلاعیه همگانی', 'megaphone', 'superadmin'],
  ['security', 'امنیت', 'shield', 'viewer'],
  ['audit', 'گزارش ممیزی', 'scroll', 'superadmin'],
  ['admins', 'مدیران', 'key', 'superadmin'],
  ['account', 'حساب من', 'user', 'viewer'],
];
const PAGES = { dashboard: Dashboard, users: Users, chats: Chats, reports: Reports, broadcast: Broadcast, security: Security, audit: Audit, admins: Admins, account: Account };

export default function App() {
  const [phase, setPhase] = useState('login');
  const [admin, setAdmin] = useState(null);
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState('');
  const [reauth, setReauth] = useState(null);

  const signOut = useCallback((msg) => {
    setToken(null); setAdmin(null); setSession(null); setPhase('login');
    live.set({ stats: null, feed: [], conn: 'offline' });
    if (msg) setNotice(msg);
  }, []);
  useEffect(() => {
    setHooks({
      unauthorized: (m) => signOut(m || 'نشست منقضی شد؛ دوباره وارد شوید.'),
      reauth: () => new Promise((resolve) => setReauth({ resolve })),
    });
  }, [signOut]);
  const afterStage = async (stage, a) => {
    if (a) setAdmin(a);
    if (stage === 'full') {
      try { const me = await api('/auth/me'); setAdmin(me.admin); setSession(me.session); } catch { /* handled */ }
      setPhase('app');
    } else setPhase(stage);
  };

  return (
    <>
      {phase === 'app' && admin
        ? <Shell admin={admin} setAdmin={setAdmin} session={session} signOut={signOut} />
        : <AuthFlow phase={phase} admin={admin} notice={notice} setNotice={setNotice} onStage={afterStage} signOut={signOut} />}
      {reauth && <Reauth onDone={(ok) => { reauth.resolve(ok); setReauth(null); }} />}
      <Dialogs />
      <Toasts />
    </>
  );
}

/* ---------------------------------------------------------------- auth flow */
function AuthShell({ children, step }) {
  return (
    <div className="auth">
      <div className="auth-glow" aria-hidden="true" />
      <main className="auth-card" key={step}>
        {children}
      </main>
      <footer className="auth-foot"><Icon name="lock" />اتصال امن · نشست فقط در حافظه همین زبانه نگه‌داری می‌شود</footer>
    </div>
  );
}

function AuthFlow({ phase, admin, notice, setNotice, onStage, signOut }) {
  if (phase === 'totp') return <TotpStep admin={admin} onStage={onStage} signOut={signOut} />;
  if (phase === 'password') return <NewPasswordStep admin={admin} onStage={onStage} signOut={signOut} />;
  if (phase === 'enroll') return <EnrollStep admin={admin} onStage={onStage} signOut={signOut} />;
  return <LoginStep notice={notice} setNotice={setNotice} onStage={onStage} />;
}

function LoginStep({ notice, setNotice, onStage }) {
  const [u, setU] = useState(''); const [p, setP] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setNotice('');
    if (!u.trim() || !p) { setErr('نام کاربری و رمز عبور را وارد کنید.'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: u.trim(), password: p } });
      setToken(r.token); setP('');
      await onStage(r.stage, r.admin);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell step="login">
      <div className="auth-logo"><Logo size={120} /></div>
      <h1>GuardNet Admin</h1>
      <p className="auth-sub">ورود به پنل مدیریت امن GuardNet</p>
      {notice && <div className="alert warn"><Icon name="alert" /><span>{notice}</span></div>}
      <form onSubmit={submit} noValidate className="auth-form">
        <Field label="نام کاربری مدیر" value={u} onChange={setU} dir="ltr" autoComplete="username" autoFocus autoCapitalize="off" spellCheck="false" maxLength={64} />
        <PasswordField label="رمز عبور" value={p} onChange={setP} autoComplete="current-password" maxLength={256} />
        {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
        <Button type="submit" loading={busy} className="full">ورود</Button>
      </form>
      <ul className="auth-points">
        <li><Icon name="fingerprint" />ورود دو مرحله‌ای اجباری (TOTP)</li>
        <li><Icon name="shield" />قفل خودکار پس از تلاش‌های ناموفق</li>
        <li><Icon name="scroll" />ثبت همه اقدامات در گزارش ممیزی زنجیره‌ای</li>
      </ul>
    </AuthShell>
  );
}

function TotpStep({ admin, onStage, signOut }) {
  const [code, setCode] = useState(''); const [rec, setRec] = useState(false); const [rc, setRc] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async (c = code) => {
    setErr('');
    if (!rec && c.length !== 6) { setErr('کد ۶ رقمی را وارد کنید.'); return; }
    if (rec && rc.replace(/[^A-Z0-9]/gi, '').length < 12) { setErr('کد بازیابی را کامل وارد کنید.'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/totp', { method: 'POST', body: rec ? { recovery: rc } : { code: c } });
      await onStage(r.stage, r.admin);
    } catch (e) { setErr(e.message); setCode(''); } finally { setBusy(false); }
  };
  return (
    <AuthShell step="totp">
      <div className="auth-ic"><Icon name="fingerprint" /></div>
      <h1>تأیید دو مرحله‌ای</h1>
      <p className="auth-sub">{rec ? 'یکی از کدهای بازیابی ذخیره‌شده را وارد کنید. هر کد فقط یک بار قابل استفاده است.' : 'کد ۶ رقمی برنامه احراز هویت (Google Authenticator و مانند آن) را وارد کنید.'}</p>
      <div className="user-pill"><Icon name="user" /><span dir="ltr">{admin?.username}</span></div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} noValidate className="auth-form">
        {rec
          ? <Field label="کد بازیابی" value={rc} onChange={(v) => setRc(v.toUpperCase())} dir="ltr" autoFocus placeholder="XXXX-XXXX-XXXX" maxLength={20} autoComplete="off" />
          : <CodeField value={code} onChange={setCode} autoFocus onDone={(x) => !busy && send(x)} />}
        {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
        <Button type="submit" loading={busy} className="full">تأیید</Button>
      </form>
      <div className="auth-links">
        <button type="button" className="link" onClick={() => { setRec(!rec); setErr(''); }}>{rec ? 'استفاده از کد برنامه' : 'دسترسی به برنامه ندارم (کد بازیابی)'}</button>
        <button type="button" className="link muted" onClick={() => signOut()}>بازگشت به ورود</button>
      </div>
    </AuthShell>
  );
}

function NewPasswordStep({ admin, onStage, signOut }) {
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const valid = pwChecks(a, admin?.username).every(([ok]) => ok);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!valid) { setErr('رمز جدید شرایط امنیتی را ندارد.'); return; }
    if (a !== b) { setErr('تکرار رمز یکسان نیست.'); return; }
    setBusy(true);
    try { const r = await api('/auth/password', { method: 'POST', body: { new: a } }); setA(''); setB(''); toast('رمز عبور تغییر کرد.', 'ok'); await onStage(r.stage, r.admin); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell step="password">
      <div className="auth-ic"><Icon name="key" /></div>
      <h1>تعیین رمز جدید</h1>
      <p className="auth-sub">برای امنیت، رمز اولیه باید پیش از ادامه با یک رمز قوی و اختصاصی جایگزین شود.</p>
      <form onSubmit={submit} noValidate className="auth-form">
        <PasswordField label="رمز جدید" value={a} onChange={setA} autoComplete="new-password" autoFocus maxLength={256} />
        <PwChecklist pw={a} username={admin?.username} />
        <PasswordField label="تکرار رمز جدید" value={b} onChange={setB} autoComplete="new-password" maxLength={256} error={b && a !== b ? 'تکرار رمز یکسان نیست' : ''} />
        {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
        <Button type="submit" loading={busy} disabled={!valid || a !== b} className="full">ذخیره و ادامه</Button>
      </form>
      <div className="auth-links"><button type="button" className="link muted" onClick={() => signOut()}>انصراف و خروج</button></div>
    </AuthShell>
  );
}

function EnrollStep({ admin, onStage, signOut }) {
  const [data, setData] = useState(null); const [qr, setQr] = useState('');
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [codes, setCodes] = useState(null); const [saved, setSaved] = useState(false); const [next, setNext] = useState(null);
  useEffect(() => {
    let dead = false;
    api('/auth/enroll/start', { method: 'POST', body: {} }).then(async (r) => {
      if (dead) return;
      setData(r);
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' }));
    }).catch((e) => setErr(e.message));
    return () => { dead = true; };
  }, []);
  const finish = async (c = code) => {
    setErr('');
    if (c.length !== 6) { setErr('کد ۶ رقمی را وارد کنید.'); return; }
    setBusy(true);
    try { const r = await api('/auth/enroll/finish', { method: 'POST', body: { code: c } }); setCodes(r.recovery_codes); setNext(r); } catch (e) { setErr(e.message); setCode(''); } finally { setBusy(false); }
  };
  if (codes) {
    return (
      <AuthShell step="codes">
        <div className="auth-ic ok"><Icon name="checkCircle" /></div>
        <h1>کدهای بازیابی</h1>
        <p className="auth-sub">این ۱۰ کد را در جای امنی (مدیر رمز یا کاغذ) نگه دارید. فقط همین یک بار نمایش داده می‌شوند و هر کد یک بار کار می‌کند.</p>
        <div className="codes-grid" dir="ltr">{codes.map((c) => <code key={c}>{c}</code>)}</div>
        <SecretBox value={codes.join('\n')} label="کپی همه کدها" />
        <label className="check-row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>کدها را در جای امنی ذخیره کردم</span></label>
        <Button className="full" disabled={!saved} onClick={() => onStage(next.stage, next.admin)}>ورود به پنل</Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell step="enroll">
      <div className="auth-ic"><Icon name="qr" /></div>
      <h1>فعال‌سازی تأیید دو مرحله‌ای</h1>
      <p className="auth-sub">ورود به پنل مدیریت بدون TOTP ممکن نیست. کد QR را با برنامه احراز هویت اسکن کنید و کد ۶ رقمی را وارد کنید.</p>
      <div className="qr-wrap">{qr ? <img src={qr} alt="کد QR برای برنامه احراز هویت" width="220" height="220" /> : <Spinner size={30} />}</div>
      {data && <SecretBox value={data.secret.replace(/(.{4})/g, '$1 ').trim()} label="کلید دستی" />}
      <form onSubmit={(e) => { e.preventDefault(); finish(); }} noValidate className="auth-form">
        <CodeField value={code} onChange={setCode} onDone={(x) => !busy && finish(x)} />
        {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
        <Button type="submit" loading={busy} className="full">فعال‌سازی</Button>
      </form>
      <div className="auth-links"><button type="button" className="link muted" onClick={() => signOut()}>انصراف و خروج</button></div>
    </AuthShell>
  );
}

function Reauth({ onDone }) {
  const [p, setP] = useState(''); const [c, setC] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault(); setErr('');
    if (!p || c.length !== 6) { setErr('رمز و کد ۶ رقمی را وارد کنید.'); return; }
    setBusy(true);
    try { await api('/auth/reauth', { method: 'POST', body: { password: p, code: c } }); toast('هویت تأیید شد (۵ دقیقه معتبر).', 'ok'); onDone(true); } catch (e2) { setErr(e2.message); setC(''); } finally { setBusy(false); }
  };
  return (
    <Modal title="تأیید دوباره هویت" onClose={() => onDone(false)}
      footer={<><Button kind="ghost" onClick={() => onDone(false)}>انصراف</Button><Button loading={busy} onClick={submit}>تأیید</Button></>}>
      <p className="muted">این عملیات حساس است. برای ادامه، رمز عبور و کد تأیید دو مرحله‌ای را وارد کنید.</p>
      <form onSubmit={submit} noValidate>
        <PasswordField label="رمز عبور" value={p} onChange={setP} autoComplete="current-password" autoFocus />
        <CodeField value={c} onChange={setC} />
        {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- shell */
const readRoute = () => { const r = (location.hash || '').replace(/^#\/?/, '').split('/')[0]; return PAGES[r] ? r : 'dashboard'; };

function Shell({ admin, setAdmin, session, signOut }) {
  const [route, setRoute] = useState(readRoute);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  const conn = useLive((s) => s.conn);
  const reportsOpen = useLive((s) => s.stats?.reports_open || 0);
  const lastAct = useRef(Date.now()); const lastPing = useRef(Date.now());
  const idleMin = session?.idle_minutes || 15;
  const [idleWarn, setIdleWarn] = useState(0);

  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f6fa' : '#0b111a'); }, [theme]);
  // realtime socket
  useEffect(() => {
    const s = adminSocket({
      onState: (st) => live.set({ conn: st }),
      onEvent: (ev, d) => {
        if (ev === 'stats') live.set({ stats: d });
        else if (ev === 'audit') live.set({ feed: [d, ...live.get().feed].slice(0, 40) });
        else if (ev === 'security' && d.kind === 'admin_login_failed') toast(`تلاش ناموفق ورود مدیر: ${d.username || '—'} از ${d.ip}`, 'error');
        else if (ev === 'report:new') toast('گزارش تازه‌ای ثبت شد.', 'info');
        live.emit(ev, d);
      },
    });
    api('/stats').then((d) => live.set({ stats: d })).catch(() => {});
    return () => s.close();
  }, []);
  // idle timeout + keepalive (server enforces the same limit)
  useEffect(() => {
    const act = () => {
      lastAct.current = Date.now(); setIdleWarn(0);
      if (Date.now() - lastPing.current > 60e3) { lastPing.current = Date.now(); api('/auth/me').catch(() => {}); }
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, act, { passive: true }));
    const t = setInterval(() => {
      const left = idleMin * 60e3 - (Date.now() - lastAct.current);
      if (left <= 0) { api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); signOut('به دلیل عدم فعالیت، برای امنیت از پنل خارج شدید.'); }
      else if (left <= 60e3) setIdleWarn(Math.ceil(left / 1000));
    }, 1000);
    return () => { clearInterval(t); evs.forEach((e) => window.removeEventListener(e, act)); };
  }, [idleMin, signOut]);

  const go = (r) => { location.hash = `#/${r}`; setMenu(false); };
  const nav = NAV.filter(([, , , role]) => can(admin, role));
  const Page = can(admin, NAV.find((n) => n[0] === route)?.[3] || 'viewer') ? PAGES[route] : Dashboard;
  const logout = async () => { try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* */ } signOut('با موفقیت خارج شدید.'); };

  return (
    <div className={cx('shell', menu && 'menu-open')}>
      <aside className="nav" aria-label="منوی اصلی">
        <div className="nav-brand"><Logo size={34} /><div><b>GuardNet</b><span>پنل مدیریت</span></div><IconBtn icon="x" label="بستن منو" className="nav-close" onClick={() => setMenu(false)} /></div>
        <nav className="nav-list">
          {nav.map(([k, l, ic]) => (
            <a key={k} href={`#/${k}`} className={cx('nav-item', route === k && 'active')} onClick={(e) => { e.preventDefault(); go(k); }} aria-current={route === k ? 'page' : undefined}>
              <Icon name={ic} /><span>{l}</span>{k === 'reports' && reportsOpen > 0 && <em>{fa(reportsOpen)}</em>}
            </a>
          ))}
        </nav>
        <div className="nav-foot">
          <div className="nav-me"><span className="me-av"><Icon name="user" /></span><div><b dir="ltr">{admin.username}</b><span>{admin.role_fa}</span></div></div>
          <Button kind="ghost" icon="logout" className="full" onClick={logout}>خروج</Button>
        </div>
      </aside>
      <div className="nav-scrim" onClick={() => setMenu(false)} aria-hidden="true" />
      <div className="main">
        <header className="topbar">
          <IconBtn icon="menu" label="منو" className="menu-btn" onClick={() => setMenu(true)} />
          <h1>{NAV.find((n) => n[0] === route)?.[1]}</h1>
          <span className={cx('live-dot', conn)} title={conn === 'online' ? 'اتصال زنده برقرار است' : 'در حال اتصال…'}><i />{conn === 'online' ? 'زنده' : 'در حال اتصال'}</span>
          <IconBtn icon={theme === 'dark' ? 'sun' : 'moon'} label="تغییر تم" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        </header>
        {idleWarn > 0 && <div className="idle-bar"><Icon name="clock" />به دلیل عدم فعالیت، {fa(idleWarn)} ثانیه دیگر خارج می‌شوید. برای ماندن، هر جای صفحه را لمس کنید.</div>}
        <main className="content" key={route}>
          <Page admin={admin} setAdmin={setAdmin} session={session} go={go} signOut={signOut} />
        </main>
      </div>
    </div>
  );
}
export { ApiError };
