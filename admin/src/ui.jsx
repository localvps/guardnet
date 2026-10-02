import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import I from './icons.js';

/* ---------------------------------------------------------------- helpers */
export const cx = (...a) => a.filter(Boolean).join(' ');
const FA = '۰۱۲۳۴۵۶۷۸۹';
export const fa = (v) => String(v ?? '').replace(/\d/g, (d) => FA[d]);
export const fmtNum = (n) => fa(Number(n || 0).toLocaleString('en-US'));
const dtf = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' });
const tf = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t) => (t ? dtf.format(new Date(t)) : '—');
export const fmtDay = (t) => (t ? df.format(new Date(t)) : '—');
export const fmtHour = (t) => (t ? tf.format(new Date(t)) : '—');
export function ago(t) {
  if (!t) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return 'لحظاتی پیش';
  if (s < 3600) return `${fa(Math.floor(s / 60) || 1)} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  if (s < 86400 * 30) return `${fa(Math.floor(s / 86400))} روز پیش`;
  return fmtDay(t);
}
export function fmtSize(b) {
  b = Number(b || 0);
  if (b < 1024) return `${fa(b)} بایت`;
  const u = ['کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت']; let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${fa(b.toFixed(b < 10 ? 1 : 0))} ${u[i]}`;
}
export function fmtUptime(s) {
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  return d ? `${fa(d)} روز و ${fa(h)} ساعت` : h ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : `${fa(m)} دقیقه`;
}

/* ---------------------------------------------------------------- icons & brand */
export function Icon({ name, size, className }) {
  const p = I[name] || I.info;
  return (
    <svg className={cx('ic', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: p.map((d) => (d.startsWith('<') ? d : `<path d="${d}"/>`)).join('') }} />
  );
}
export function Logo({ size = 36 }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="GuardNet">
      <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5eb5f7" /><stop offset="1" stopColor="#2b6fe0" /></linearGradient></defs>
      <circle cx="32" cy="32" r="32" fill={`url(#g${id})`} />
      <path d="M32 13 18 18.5v11.2c0 9.6 6 17.4 14 20.3 8-2.9 14-10.7 14-20.3V18.5Z" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinejoin="round" />
      <path d="m25.5 31.5 4.7 4.7 8.6-9.4" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------- primitives */
export const Spinner = ({ size = 20 }) => <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="در حال بارگذاری" />;

export function Button({ children, kind = 'primary', loading, disabled, className, icon, size, ...rest }) {
  return (
    <button type="button" className={cx('btn', `btn-${kind}`, size && `btn-${size}`, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={18} /> : icon && <Icon name={icon} />}{children && <span>{children}</span>}
    </button>
  );
}
export function IconBtn({ icon, label, className, ...rest }) {
  return <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}><Icon name={icon} /></button>;
}
export function Field({ label, value, onChange, type = 'text', hint, error, textarea, suffix, dir, className, inputRef, ...rest }) {
  const id = useId();
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className={cx('field', error && 'error', className)}>
      {label && <label htmlFor={id}>{label}</label>}
      <div className="field-box">
        <Tag id={id} ref={inputRef} type={textarea ? undefined : type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} dir={dir} {...rest} />
        {suffix}
      </div>
      {(error || hint) && <div className={cx('field-hint', error && 'err')}>{error || hint}</div>}
    </div>
  );
}
export function PasswordField(props) {
  const [show, setShow] = useState(false);
  return <Field {...props} type={show ? 'text' : 'password'} dir="ltr" suffix={<button type="button" className="field-eye" onClick={() => setShow(!show)} aria-label={show ? 'پنهان کردن رمز' : 'نمایش رمز'}><Icon name={show ? 'eyeOff' : 'eye'} /></button>} />;
}
export function CodeField({ value, onChange, autoFocus, label = 'کد ۶ رقمی', onDone }) {
  return (
    <Field label={label} value={value} dir="ltr" className="code-field" inputMode="numeric" autoComplete="one-time-code" autoFocus={autoFocus} maxLength={6}
      onChange={(v) => { const x = v.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g, '').slice(0, 6); onChange(x); if (x.length === 6) onDone?.(x); }} placeholder="••••••" />
  );
}
export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} className={cx('toggle', checked && 'on')} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}
export function Select({ value, onChange, options, label, className }) {
  return (
    <label className={cx('select', className)}>
      {label && <span className="sr-only">{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Icon name="chevDown" />
    </label>
  );
}
export function Badge({ children, tone = 'muted', icon }) { return <span className={cx('badge', `b-${tone}`)}>{icon && <Icon name={icon} />}{children}</span>; }
export function Empty({ icon = 'search', title, sub }) {
  return <div className="empty"><span className="empty-ic"><Icon name={icon} /></span><b>{title}</b>{sub && <span>{sub}</span>}</div>;
}
export function Avatar({ src, name, color, size = 36 }) {
  const c = color || ['#5eb5f7', '#2b6fe0'];
  const letters = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${c[0]}, ${c[1] || c[0]})` }}>
      {src ? <img src={src} alt="" loading="lazy" /> : letters}
    </span>
  );
}
export function Pager({ page, size, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <IconBtn icon="chevRight" label="صفحه قبل" disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <span>صفحه {fa(page)} از {fa(pages)}</span>
      <IconBtn icon="chevLeft" label="صفحه بعد" disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </div>
  );
}
export function Card({ title, icon, actions, children, className, pad = true }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{icon && <Icon name={icon} />}<span>{title}</span></h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={cx('card-body', !pad && 'no-pad')}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- tiny global store for toasts / dialogs */
function createStore(init) {
  let s = init; const subs = new Set();
  return {
    get: () => s,
    set: (p) => { s = { ...s, ...(typeof p === 'function' ? p(s) : p) }; subs.forEach((f) => f()); },
    sub: (f) => { subs.add(f); return () => subs.delete(f); },
  };
}
export const ui = createStore({ toasts: [], dialog: null });
export const useUi = (sel) => useSyncExternalStore(ui.sub, () => sel(ui.get()));
let tid = 0;
export function toast(text, tone = 'info') {
  const id = ++tid;
  ui.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  setTimeout(() => ui.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 5200 : 3200);
}
export function Toasts() {
  const list = useUi((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={cx('toast', t.tone)}><Icon name={t.tone === 'error' ? 'alert' : t.tone === 'ok' ? 'checkCircle' : 'info'} /><span>{t.text}</span></div>)}
    </div>
  );
}

const modalStack = [];
export function Modal({ title, onClose, children, footer, wide, className }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const token = {}; modalStack.push(token);
    const f = el?.querySelector('input:not([type=hidden]), textarea, select, button:not(.modal-x)');
    f?.focus();
    const key = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return; // only the top-most dialog reacts
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('button, input, textarea, select, a[href]')].filter((x) => !x.disabled && !x.hidden);
        if (!items.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', key, true);
      const i = modalStack.indexOf(token); if (i >= 0) modalStack.splice(i, 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, []);
  return (
    <div className="modal-layer" onPointerDown={(e) => { if (e.target === e.currentTarget) closeRef.current?.(); }}>
      <div ref={ref} className={cx('modal', wide && 'wide', className)} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2>{onClose && <IconBtn icon="x" label="بستن" className="modal-x" onClick={onClose} />}</header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Promise-based confirm / prompt dialogs. */
export function confirmDialog(opts) { return new Promise((resolve) => ui.set({ dialog: { kind: 'confirm', ...opts, resolve } })); }
export function promptDialog(opts) { return new Promise((resolve) => ui.set({ dialog: { kind: 'prompt', ...opts, resolve } })); }
export function Dialogs() {
  const d = useUi((s) => s.dialog);
  const [val, setVal] = useState('');
  useEffect(() => { setVal(d?.value || ''); }, [d]);
  if (!d) return null;
  const done = (v) => { ui.set({ dialog: null }); d.resolve(v); };
  const ok = () => { if (d.kind === 'prompt') { if (d.required && !val.trim()) return; done(val); } else done(true); };
  return (
    <Modal key={d.title + (d.text || '')} title={d.title} onClose={() => done(d.kind === 'prompt' ? null : false)}
      footer={<><Button kind="ghost" onClick={() => done(d.kind === 'prompt' ? null : false)}>انصراف</Button><Button kind={d.danger ? 'danger' : 'primary'} onClick={ok}>{d.ok || 'تأیید'}</Button></>}>
      {d.text && <p className="muted">{d.text}</p>}
      {d.kind === 'prompt' && (
        <form onSubmit={(e) => { e.preventDefault(); ok(); }}>
          <Field label={d.label} value={val} onChange={setVal} textarea={d.textarea} rows={d.textarea ? 4 : undefined} placeholder={d.placeholder} type={d.type} dir={d.dir} maxLength={d.maxLength} />
        </form>
      )}
    </Modal>
  );
}

/** One-time secret display (passwords / recovery codes) with copy. */
export function SecretBox({ value, label }) {
  const copy = async () => { try { await navigator.clipboard.writeText(value); toast('کپی شد.', 'ok'); } catch { toast('کپی ممکن نشد؛ دستی انتخاب کنید.', 'error'); } };
  return (
    <div className="secret-box">
      {label && <span className="sb-label">{label}</span>}
      <code dir="ltr">{value}</code>
      <IconBtn icon="copy" label="کپی" onClick={copy} />
    </div>
  );
}

export function useInterval(fn, ms) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (!ms) return undefined; const t = setInterval(() => ref.current(), ms); return () => clearInterval(t); }, [ms]);
}

export function pwChecks(pw, username = '') {
  return [
    [pw.length >= 12, 'دست‌کم ۱۲ نویسه'],
    [/[a-z]/.test(pw) && /[A-Z]/.test(pw), 'حروف کوچک و بزرگ انگلیسی'],
    [/\d/.test(pw), 'دست‌کم یک عدد'],
    [/[^A-Za-z0-9]/.test(pw), 'دست‌کم یک نماد (مثل ! یا #)'],
    [!!pw && !(username && pw.toLowerCase().includes(username.toLowerCase())), 'بدون نام کاربری'],
  ];
}
export function PwChecklist({ pw, username }) {
  return <ul className="pw-checks">{pwChecks(pw, username).map(([ok, t]) => <li key={t} className={cx(ok && 'ok')}><Icon name={ok ? 'checkCircle' : 'x'} />{t}</li>)}</ul>;
}

