import { useEffect, useRef, useState, useMemo } from 'react';
import QRCode from 'qrcode';
import { api, uploadFile, setToken } from '../lib/api.js';
import { startSession } from '../lib/actions.js';
import { cx, fa } from '../lib/format.jsx';
import { Field, Button, Icon, Logo, Check, Spinner } from './ui.jsx';
import Monkey from './Monkey.jsx';

const USER_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

export function pwScore(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const SCORE = ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'قوی'];

export default function Auth() {
  const [step, setStep] = useState('username'); // username | password | code | name | newpass | qr
  const [dir, setDir] = useState(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [photo, setPhoto] = useState(null);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [cfg, setCfg] = useState({ registration_open: true, password_min: 8 });
  const [focus, setFocus] = useState(false);
  const [caret, setCaret] = useState(0);

  useEffect(() => { api('/auth/config').then(setCfg).catch(() => {}); }, []);
  const go = (s, d = 1) => { setError(''); setDir(d); setStep(s); setShow(false); };
  const fail = (e) => { setError(e.message); setBusy(false); };

  async function submitUsername(e) {
    e?.preventDefault();
    const u = username.trim().replace(/^@/, '');
    if (!USER_RE.test(u)) { setError('نام کاربری نامعتبر است'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/check', { method: 'POST', body: { username: u } });
      setUsername(u); setBusy(false);
      if (r.exists) go('password');
      else if (r.taken) setError('این نام کاربری در دسترس نیست');
      else if (!r.registration_open) setError('ثبت‌نام جدید موقتاً بسته است');
      else go('name');
    } catch (err) { fail(err); }
  }
  async function submitPassword(e) {
    e?.preventDefault();
    if (!password) { setError('رمز عبور را وارد کنید'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password, remember } });
      if (r.need_2fa) { setBusy(false); go('code'); return; }
      await startSession(r.token, r.me);
    } catch (err) { fail(err); }
  }
  async function submitCode(e, value) {
    e?.preventDefault();
    if (busy) return;
    const c = (value ?? code).replace(/\D/g, '');
    if (c.length !== 6) { setError('کد ۶ رقمی را وارد کنید'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password, totp: c, remember } });
      await startSession(r.token, r.me);
    } catch (err) { setCode(''); fail(err); }
  }
  function submitName(e) {
    e?.preventDefault();
    if (!first.trim()) { setError('نام را وارد کنید'); return; }
    go('newpass');
  }
  async function submitRegister(e) {
    e?.preventDefault();
    if (password.length < cfg.password_min) { setError(`رمز باید دست‌کم ${fa(cfg.password_min)} نویسه باشد`); return; }
    if (password !== password2) { setError('تکرار رمز عبور یکسان نیست'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/register', { method: 'POST', body: { username, password, first_name: first.trim(), last_name: last.trim(), remember } });
      if (photo?.file) {
        try {
          setToken(r.token);
          const f = await uploadFile(photo.file);
          r.me = await api('/me', { method: 'PATCH', body: { avatar: f.id } });
        } catch { /* avatar optional */ }
      }
      await startSession(r.token, r.me);
    } catch (err) { fail(err); }
  }

  const monkeyMode = step === 'password' || step === 'newpass'
    ? (show ? 'peek' : (password || password2 || focus) ? 'close' : 'idle')
    : step === 'code' ? (focus || code ? 'track' : 'idle') : 'idle';
  const progress = step === 'code' ? code.length / 6 : caret / 20;

  // Two-panel layout: username step shows form + QR side by side (Telegram-style)
  const showTwoPanel = step === 'username';

  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden="true" />
      <div className="auth-scroll">
        {showTwoPanel ? (
          <div className="auth-container">
            {/* Left panel: form */}
            <div className="auth-form-panel">
              <form onSubmit={submitUsername} noValidate className="auth-page">
                <div className="auth-logo"><Logo size={120} /></div>
                <h1 className="auth-title">ورود به GuardNet</h1>
                <p className="auth-sub">لطفاً نام کاربری حساب GuardNet خود را وارد کنید.</p>
                <div className="auth-fields">
                  <Field label="نام کاربری" value={username} onChange={(v) => { setUsername(v.replace(/\s/g, '')); setError(''); }} dir="ltr" autoFocus
                    error={error} autoComplete="username" name="username" maxLength={33} suffix={<span className="at">@</span>} />
                  <label className="auth-check" onClick={() => setRemember(!remember)}>
                    <Check checked={remember} /><span>مرا به خاطر بسپار</span>
                  </label>
                </div>
                <Button type="submit" full loading={busy} className={cx('auth-next', USER_RE.test(username.replace(/^@/, '')) && 'ready')}>بعدی</Button>
                <div className="auth-foot">
                  حساب کاربری ندارید؟ کافی است نام کاربری دلخواه را وارد کنید تا
                  <button type="button" className="auth-inline" onClick={() => { if (USER_RE.test(username)) submitUsername(); else setError('ابتدا نام کاربری دلخواه را وارد کنید'); }}>حساب جدید بسازید</button>
                </div>
                <button type="button" className="auth-qr-mobile-btn" onClick={() => go('qr')}>
                  <Icon name="qr" /> ورود سریع با QR
                </button>
              </form>
            </div>
            {/* Right panel: QR code (Telegram desktop style) */}
            <div className="auth-qr-panel">
              <QrLoginInline remember={remember} />
            </div>
          </div>
        ) : (
          <div className={cx('auth-page', dir > 0 ? 'fwd' : 'back')} key={step}>
            {step === 'password' && (
              <form onSubmit={submitPassword} noValidate>
                <div className="auth-monkey"><Monkey mode={monkeyMode} /></div>
                <h1 className="auth-title">رمز عبور را وارد کنید</h1>
                <p className="auth-sub">حساب <b dir="ltr">@{username}</b> با رمز عبور محافظت می‌شود.</p>
                <UserChip username={username} onEdit={() => { setPassword(''); go('username', -1); }} />
                <div className="auth-fields">
                  <Field label="رمز عبور" type={show ? 'text' : 'password'} value={password} onChange={(v) => { setPassword(v); setError(''); }}
                    error={error} autoFocus autoComplete="current-password" dir="ltr" name="password"
                    suffix={<EyeBtn show={show} onClick={() => setShow(!show)} />} onKeyDown={() => setFocus(true)} />
                </div>
                <Button type="submit" full loading={busy} className={cx('auth-next', password && 'ready')}>بعدی</Button>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={submitCode} noValidate>
                <div className="auth-monkey"><Monkey mode={monkeyMode} progress={progress} /></div>
                <h1 className="auth-title">تأیید دو مرحله‌ای</h1>
                <p className="auth-sub">کد ۶ رقمی برنامه احراز هویت (مانند Google Authenticator) را وارد کنید.</p>
                <UserChip username={username} onEdit={() => { setPassword(''); setCode(''); go('username', -1); }} />
                <div className="auth-fields" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
                  <Field label="کد تأیید" value={code} inputMode="numeric" autoComplete="one-time-code" dir="ltr" autoFocus error={error} maxLength={6}
                    onChange={(v) => { const c = v.replace(/[^\d۰-۹]/g, '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).slice(0, 6); setCode(c); setError(''); if (c.length === 6) submitCode(null, c); }} />
                </div>
                <Button type="submit" full loading={busy} className={cx('auth-next', code.length === 6 && 'ready')}>بعدی</Button>
              </form>
            )}

            {step === 'name' && (
              <form onSubmit={submitName} noValidate>
                <PhotoPicker photo={photo} setPhoto={setPhoto} />
                <h1 className="auth-title">نام شما</h1>
                <p className="auth-sub">نام خود را وارد کنید و یک عکس پروفایل بگذارید.</p>
                <UserChip username={username} onEdit={() => go('username', -1)} isNew />
                <div className="auth-fields">
                  <Field label={error || 'نام (الزامی)'} value={first} onChange={(v) => { setFirst(v); setError(''); }} autoFocus maxLength={32} error={error} autoComplete="given-name" />
                  <Field label="نام خانوادگی (اختیاری)" value={last} onChange={setLast} maxLength={32} autoComplete="family-name" />
                </div>
                <Button type="submit" full className={cx('auth-next', first.trim() && 'ready')}>بعدی</Button>
              </form>
            )}

            {step === 'newpass' && (
              <form onSubmit={submitRegister} noValidate>
                <div className="auth-monkey"><Monkey mode={monkeyMode} /></div>
                <h1 className="auth-title">یک رمز عبور بسازید</h1>
                <p className="auth-sub">با این رمز وارد حساب <b dir="ltr">@{username}</b> می‌شوید. آن را جایی امن نگه دارید.</p>
                <div className="auth-fields" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
                  <Field label="رمز عبور" type={show ? 'text' : 'password'} value={password} onChange={(v) => { setPassword(v); setError(''); }}
                    autoFocus autoComplete="new-password" dir="ltr" error={error && !password2 ? error : ''} suffix={<EyeBtn show={show} onClick={() => setShow(!show)} />} />
                  {password && (
                    <div className={cx('pw-meter', `s${pwScore(password)}`)}>
                      <div className="pw-bars">{[0, 1, 2, 3].map((i) => <span key={i} className={cx(i < pwScore(password) && 'on')} />)}</div>
                      <span>{SCORE[pwScore(password)]}</span>
                    </div>
                  )}
                  <Field label="تکرار رمز عبور" type={show ? 'text' : 'password'} value={password2} onChange={(v) => { setPassword2(v); setError(''); }}
                    autoComplete="new-password" dir="ltr" error={error && password2 ? error : ''} />
                </div>
                <Button type="submit" full loading={busy} className={cx('auth-next', password && password2 && 'ready')}>شروع پیام‌رسانی</Button>
                <button type="button" className="auth-link" onClick={() => go('name', -1)}><Icon name="arrowRight" />بازگشت</button>
              </form>
            )}

            {step === 'qr' && <QrLogin remember={remember} onBack={() => go('username', -1)} />}
          </div>
        )}
      </div>
      <div className="auth-brand"><Logo size={18} /> GuardNet · اتصال رمزنگاری‌شده</div>
    </div>
  );
}

function EyeBtn({ show, onClick }) {
  return <button type="button" className="eye-btn" onClick={onClick} aria-label={show ? 'پنهان کردن رمز' : 'نمایش رمز'} tabIndex={-1}><Icon name={show ? 'eyeOff' : 'eye'} /></button>;
}
function UserChip({ username, onEdit, isNew }) {
  return (
    <button type="button" className="user-chip" onClick={onEdit} aria-label="ویرایش نام کاربری">
      <span dir="ltr">@{username}</span>{isNew && <span className="chip-new">جدید</span>}<Icon name="pencil" />
    </button>
  );
}

function PhotoPicker({ photo, setPhoto }) {
  const inp = useRef(null);
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);
  return (
    <div className="auth-photo">
      <button type="button" className="photo-circle" onClick={() => inp.current?.click()} aria-label="انتخاب عکس پروفایل">
        {photo ? <img src={photo.url} alt="" /> : null}
        <span className="photo-ov"><Icon name="camera" /></span>
      </button>
      <input ref={inp} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto({ file: f, url: URL.createObjectURL(f) }); e.target.value = ''; }} />
    </div>
  );
}

/* ------------------------------------------------------------------ QR login (inline panel for desktop two-panel layout) */
function QrLoginInline({ remember }) {
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState('');
  const [state, setState] = useState('loading');
  const alive = useRef(true);
  const qrRef = useRef(null); qrRef.current = qr;

  useEffect(() => {
    alive.current = true;
    let poll; let refresh;
    const issue = async () => {
      try {
        const r = await api('/auth/qr', { method: 'POST', body: { remember } });
        if (!alive.current) return;
        setQr(r); setState('ready'); setErr('');
        clearTimeout(refresh); refresh = setTimeout(issue, Math.max(10e3, r.expires_in - 8e3));
      } catch (e) { if (alive.current) { setErr(e.message); setState('error'); clearTimeout(refresh); refresh = setTimeout(issue, 5000); } }
    };
    issue();
    poll = setInterval(async () => {
      const cur = qrRef.current; if (!cur) return;
      try {
        const r = await api(`/auth/qr/${encodeURIComponent(cur.token)}`);
        if (!alive.current) return;
        if (r.status === 'approved') { clearInterval(poll); clearTimeout(refresh); setState('approved'); await startSession(r.token, r.me); }
      } catch { /* network hiccup */ }
    }, 1500);
    return () => { alive.current = false; clearInterval(poll); clearTimeout(refresh); };
  }, [remember]);

  const link = qr ? `${location.origin}${location.pathname}#qr/${qr.token}` : '';
  return (
    <>
      <div className="qr-title">ورود سریع با QR</div>
      <div className="qr-box">
        {qr && state !== 'error' ? <QrSvg text={link} /> : <div className="qr-ph">{state === 'error' ? <Icon name="alert" /> : <Spinner size={36} />}</div>}
        {state === 'approved' && <div className="qr-done"><Icon name="checkCircle" /></div>}
      </div>
      <div className="qr-sub">
        GuardNet را روی دستگاهی که با آن وارد شده‌اید باز کنید، به
        <b> تنظیمات › دستگاه‌ها › اتصال دستگاه </b>
        بروید و دوربین را به سمت این کد بگیرید.
      </div>
      {qr && (
        <div className="qr-sub" style={{ marginTop: '-8px' }}>
          یا کد زیر را وارد کنید:
          <div style={{ marginTop: 6 }}><span className="qr-code" dir="ltr">{qr.code || '····-····'}</span></div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ QR login (full page, mobile fallback) */
function QrLogin({ remember, onBack }) {
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState('');
  const [state, setState] = useState('loading');
  const alive = useRef(true);
  const qrRef = useRef(null); qrRef.current = qr;
  useEffect(() => {
    alive.current = true;
    let poll; let refresh;
    const issue = async () => {
      try {
        const r = await api('/auth/qr', { method: 'POST', body: { remember } });
        if (!alive.current) return;
        setQr(r); setState('ready'); setErr('');
        clearTimeout(refresh); refresh = setTimeout(issue, Math.max(10e3, r.expires_in - 8e3));
      } catch (e) { if (alive.current) { setErr(e.message); setState('error'); clearTimeout(refresh); refresh = setTimeout(issue, 5000); } }
    };
    issue();
    poll = setInterval(async () => {
      const cur = qrRef.current; if (!cur) return;
      try {
        const r = await api(`/auth/qr/${encodeURIComponent(cur.token)}`);
        if (!alive.current) return;
        if (r.status === 'approved') { clearInterval(poll); clearTimeout(refresh); setState('approved'); await startSession(r.token, r.me); }
      } catch { /* network hiccup */ }
    }, 1500);
    return () => { alive.current = false; clearInterval(poll); clearTimeout(refresh); };
  }, [remember]);
  const link = qr ? `${location.origin}${location.pathname}#qr/${qr.token}` : '';
  return (
    <div className="qr-page">
      <div className="qr-box">
        {qr && state !== 'error' ? <QrSvg text={link} /> : <div className="qr-ph">{state === 'error' ? <Icon name="alert" /> : <Spinner size={36} />}</div>}
        {state === 'approved' && <div className="qr-done"><Icon name="checkCircle" /></div>}
      </div>
      <h1 className="auth-title">ورود به GuardNet با کد QR</h1>
      {err && <p className="auth-err">{err}</p>}
      <ol className="qr-steps">
        <li><span>۱</span><div>GuardNet را روی دستگاهی که با آن وارد شده‌اید باز کنید</div></li>
        <li><span>۲</span><div>به <b>تنظیمات › دستگاه‌ها › اتصال دستگاه</b> بروید</div></li>
        <li><span>۳</span><div>برای تأیید ورود، دوربین را به سمت این کد بگیرید یا این کد را وارد کنید: <b className="qr-code" dir="ltr">{qr?.code || '····-····'}</b></div></li>
      </ol>
      <button type="button" className="auth-link" onClick={onBack}><Icon name="user" />ورود با نام کاربری</button>
    </div>
  );
}

/** Rounded-dot QR (like Telegram's) with the GuardNet mark in the centre. */
function QrSvg({ text }) {
  const model = useMemo(() => { try { return QRCode.create(text, { errorCorrectionLevel: 'H' }); } catch { return null; } }, [text]);
  if (!model) return null;
  const n = model.modules.size; const d = model.modules.data;
  const at = (x, y) => d[y * n + x];
  const inFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const c0 = Math.floor(n / 2); const hole = Math.ceil(n * 0.14);
  const dots = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!at(x, y) || inFinder(x, y)) continue;
    if (Math.abs(x - c0) <= hole && Math.abs(y - c0) <= hole) continue;
    dots.push(<circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.42} />);
  }
  const finder = (x, y) => (
    <g key={`f${x}${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={2} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} />
    </g>
  );
  return (
    <svg className="qr-svg" viewBox={`-1 -1 ${n + 2} ${n + 2}`} role="img" aria-label="کد QR ورود">
      <g fill="currentColor">{dots}{finder(0, 0)}{finder(n - 7, 0)}{finder(0, n - 7)}</g>
      <svg x={c0 - hole + 1} y={c0 - hole + 1} width={hole * 2 - 1} height={hole * 2 - 1} viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="32" className="qr-logo-bg" />
        <path d="M32 13 18 18.5v11.2c0 9.6 6 17.4 14 20.3 8-2.9 14-10.7 14-20.3V18.5Z" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinejoin="round" />
        <path d="m25.5 31.5 4.7 4.7 8.6-9.4" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </svg>
  );
}
