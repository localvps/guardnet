import { useEffect, useRef, useState, useId, forwardRef } from 'react';
import I from '../lib/icons-data.js';
import { assetUrl } from '../lib/api.js';
import { cx, initials } from '../lib/format.jsx';
import { useStore } from '../lib/store.js';

export function Icon({ name, size, className, style, fill }) {
  const p = I[name] || I.info;
  return (
    <svg className={cx('ic', className)} viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={size ? { width: size, height: size, ...style } : style}
      dangerouslySetInnerHTML={{ __html: p.map((d) => (d.startsWith('<') ? d : `<path d="${d}"/>`)).join('') }} />
  );
}

/** GuardNet mark: shield + check inside a gradient circle. Uses currentColor for the stroke when mono. */
export function Logo({ size = 40, mono = false, className }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="GuardNet">
      <defs>
        <linearGradient id={`lg${id}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#37aee2" />
          <stop offset="1" stopColor="#1e96c8" />
        </linearGradient>
      </defs>
      {!mono && <circle cx="32" cy="32" r="32" fill={`url(#lg${id})`} />}
      <path d="M13.5 31.2 47.6 18.1c1.6-.6 3 .4 2.5 2.8l-5.8 27.3c-.4 1.9-1.6 2.4-3.2 1.5l-8.8-6.5-4.2 4.1c-.5.5-.9.9-1.8.9l.6-9 16.4-14.8c.7-.6-.2-1-1.1-.4L20.5 38.2l-8.7-2.7c-1.9-.6-1.9-1.9 1.7-4.3Z" fill={mono ? 'currentColor' : '#fff'} transform="translate(-1.5 1)" />
    </svg>
  );
}

export function PremiumStar({ size = 16, className }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={cx('prem-star', className)} width={size} height={size} viewBox="0 0 24 24" aria-label="پریمیوم">
      <defs>
        <linearGradient id={`ps${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7bff" /><stop offset=".55" stopColor="#d86bff" /><stop offset="1" stopColor="#ffb547" />
        </linearGradient>
      </defs>
      <path d="M12 2l2.9 6.9L22 9.6l-5.4 4.9L18.2 22 12 18.3 5.8 22l1.6-7.5L2 9.6l7.1-.7z" fill={`url(#ps${id})`} />
    </svg>
  );
}
export function Verified({ size = 16 }) {
  return (
    <svg className="verified" width={size} height={size} viewBox="0 0 24 24" aria-label="تأییدشده">
      <path d="M12 1.8 14.6 4l3.4-.3.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.3L12 22.2 9.4 20l-3.4.3-.9-3.3-3-1.7L3.4 12 2.1 8.7l3-1.7.9-3.3 3.4.3z" fill="var(--accent)" />
      <path d="m8 12.2 2.7 2.7L16.2 9.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** Name + badges in one line, with correct truncation. */
export function NameLine({ name, user, chat, className }) {
  const u = user || {};
  return (
    <span className={cx('name-line', className)}>
      <span className="nm">{name}</span>
      {(u.verified || chat?.verified) && <Verified size={15} />}
      {u.premium && !u.verified && (u.emoji_status ? <span className="emoji-status">{u.emoji_status}</span> : <PremiumStar size={15} />)}
      {u.bot && <span className="tag">ربات</span>}
    </span>
  );
}

export function Avatar({ src, name, color, size = 48, online, saved, deleted, className, onClick, story }) {
  const [err, setErr] = useState(false);
  const url = !err && src ? assetUrl(src) : null;
  const c = color || ['#4f8cff', '#8b5cf6'];
  useEffect(() => setErr(false), [src]);
  return (
    <span className={cx('avatar', story && 'has-story', story === 'seen' && 'seen', className)} style={{ width: size, height: size, fontSize: typeof size === 'number' ? size * 0.38 : `calc(${size} * .38)` }} onClick={onClick}>
      <span className="av-in" style={{ background: url ? undefined : `linear-gradient(135deg, ${c[0]}, ${c[1]})` }}>
        {saved ? <Icon name="bookmark" className="av-ic" /> : deleted ? <Icon name="ghost" className="av-ic" /> : url
          ? <img src={url} alt="" draggable="false" onError={() => setErr(true)} loading="lazy" />
          : <span className="av-txt">{initials(name)}</span>}
      </span>
      {online && <span className="online-dot" />}
    </span>
  );
}

export function Spinner({ size = 22, className }) {
  return <span className={cx('spinner', className)} style={{ width: size, height: size }} aria-label="در حال بارگذاری" />;
}

export const IconBtn = forwardRef(function IconBtn({ icon, label, onClick, className, active, badge, disabled, size, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={cx('icon-btn', active && 'active', className)} onClick={onClick} aria-label={label} title={label} disabled={disabled} {...rest}>
      <Icon name={icon} size={size} />
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
});

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled}
      className={cx('toggle', checked && 'on')} onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}>
      <span className="knob" />
    </button>
  );
}

export function Radio({ checked }) { return <span className={cx('radio', checked && 'on')} aria-hidden="true" />; }
export function Check({ checked }) {
  return <span className={cx('check', checked && 'on')} aria-hidden="true">{checked && <Icon name="check" />}</span>;
}

/** Telegram-style outlined input with floating label. */
export const Field = forwardRef(function Field({ label, value, onChange, type = 'text', error, hint, dir, maxLength, counter, suffix, autoFocus, onKeyDown, inputMode, autoComplete, name, disabled, textarea, rows = 3, readOnly }, ref) {
  const id = useId();
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className={cx('field', error && 'error', value != null && String(value).length > 0 && 'filled', suffix && 'has-suffix', textarea && 'ta', counter != null && 'has-counter')}>
      <Tag ref={ref} id={id} className="field-in" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} type={textarea ? undefined : type}
        dir={dir} maxLength={maxLength} placeholder=" " autoFocus={autoFocus} onKeyDown={onKeyDown} inputMode={inputMode} autoComplete={autoComplete}
        name={name} disabled={disabled} rows={textarea ? rows : undefined} readOnly={readOnly} spellCheck={false} aria-invalid={!!error} />
      <label htmlFor={id} className="field-label">{error || label}</label>
      <fieldset className="field-outline" aria-hidden="true"><legend><span>{error || label}</span></legend></fieldset>
      {suffix && <span className="field-suffix">{suffix}</span>}
      {counter != null && <span className="field-counter">{counter}</span>}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
});

export function Button({ children, onClick, kind = 'primary', loading, disabled, className, type = 'button', icon, full }) {
  return (
    <button type={type} className={cx('btn', `btn-${kind}`, full && 'full', loading && 'loading', className)} onClick={onClick} disabled={disabled || loading}>
      {loading ? <Spinner size={20} /> : <>{icon && <Icon name={icon} />}<span>{children}</span></>}
    </button>
  );
}

/** Row in settings-like lists. */
export function Row({ icon, iconBg, title, sub, value, onClick, right, danger, className, chevron }) {
  return (
    <div className={cx('row', onClick && 'clickable', danger && 'danger', className)} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}>
      {icon && <span className={cx('row-ic', iconBg && 'filled')} style={iconBg ? { background: iconBg } : undefined}><Icon name={icon} /></span>}
      <span className="row-body">
        <span className="row-title">{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {value != null && <span className="row-value">{value}</span>}
      {right}
      {chevron && <Icon name="chevLeft" className="row-chev" />}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={cx('toast', t.kind)}>{t.kind === 'error' && <Icon name="alert" />}{t.kind === 'ok' && <Icon name="checkCircle" />}<span>{t.text}</span></div>)}
    </div>
  );
}

/** Closes on outside click / Escape. */
export function useDismiss(ref, onClose, active = true, ignore) {
  useEffect(() => {
    if (!active) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target) && !(ignore && e.target.closest?.(ignore))) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => { document.addEventListener('pointerdown', down); }, 0);
    document.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [ref, onClose, active, ignore]);
}

export function Empty({ icon = 'search', title, sub, children }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon name={icon} /></span>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q); const f = () => setM(mq.matches);
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

export function useInterval(fn, ms) {
  const r = useRef(fn); r.current = fn;
  useEffect(() => { if (ms == null) return undefined; const t = setInterval(() => r.current(), ms); return () => clearInterval(t); }, [ms]);
}
