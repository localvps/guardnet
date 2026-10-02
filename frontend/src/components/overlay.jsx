import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useStore, setState, getState } from '../lib/store.js';
import { cx } from '../lib/format.jsx';
import { Icon, IconBtn } from './ui.jsx';

/* ------------------------------------------------------------------ context menu */
export function openMenu(e, items, opts = {}) {
  e?.preventDefault?.(); e?.stopPropagation?.();
  const pt = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  let x = pt?.clientX ?? window.innerWidth / 2; let y = pt?.clientY ?? window.innerHeight / 2;
  if (opts.anchor) { const r = opts.anchor.getBoundingClientRect(); x = opts.alignStart ? r.right : r.left; y = r.bottom + 4; }
  setState({ ctx: { x, y, items: items.filter(Boolean), reactions: opts.reactions, onReact: opts.onReact, anchorRight: !!opts.anchor && opts.alignStart } });
}
export const closeMenu = () => setState({ ctx: null });

export function ContextMenu() {
  const ctx = useStore((s) => s.ctx);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!ctx || !ref.current) { setPos(null); return; }
    const el = ref.current; const w = el.offsetWidth; const h = el.offsetHeight;
    const vw = window.innerWidth; const vh = window.innerHeight; const m = 8;
    let left = ctx.anchorRight ? ctx.x - w : ctx.x - w; // RTL: open towards the left of the pointer
    if (left < m) left = Math.min(ctx.x, vw - w - m);
    left = Math.max(m, Math.min(left, vw - w - m));
    let top = ctx.y;
    if (top + h > vh - m) top = Math.max(m, ctx.y - h);
    top = Math.max(m, Math.min(top, vh - h - m));
    setPos({ left, top });
  }, [ctx]);
  useEffect(() => {
    if (!ctx) return undefined;
    const close = () => closeMenu();
    const key = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('resize', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('keydown', key); };
  }, [ctx]);
  if (!ctx) return null;
  return (
    <div className="ctx-layer" onPointerDown={(e) => { if (e.target === e.currentTarget) closeMenu(); }} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}>
      <div ref={ref} className={cx('ctx-menu glass', pos && 'shown')} style={pos || { left: -9999, top: -9999 }} role="menu">
        {ctx.reactions && (
          <div className="ctx-reacts">
            {ctx.reactions.map((e) => <button key={e} type="button" onClick={() => { closeMenu(); ctx.onReact(e); }} aria-label={`واکنش ${e}`}>{e}</button>)}
          </div>
        )}
        <div className="ctx-items">
          {ctx.items.map((it, i) => (it.sep ? <div key={i} className="ctx-sep" /> : (
            <button key={i} type="button" role="menuitem" className={cx('ctx-item', it.danger && 'danger')} disabled={it.disabled}
              onClick={() => { closeMenu(); it.onClick?.(); }}>
              <Icon name={it.icon} /><span>{it.label}</span>{it.hint && <em>{it.hint}</em>}
            </button>
          )))}
        </div>
      </div>
    </div>
  );
}

/** Long-press for touch devices → opens context menu. */
export function useLongPress(cb, ms = 480) {
  const t = useRef(null); const start = useRef(null); const fired = useRef(false);
  const clear = () => { clearTimeout(t.current); t.current = null; };
  return {
    onTouchStart: (e) => {
      fired.current = false;
      const p = e.touches[0]; start.current = { x: p.clientX, y: p.clientY };
      const ev = { clientX: p.clientX, clientY: p.clientY, preventDefault() {}, stopPropagation() {} };
      t.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(12); cb(ev); }, ms);
    },
    onTouchMove: (e) => { const p = e.touches[0]; if (start.current && Math.hypot(p.clientX - start.current.x, p.clientY - start.current.y) > 10) clear(); },
    onTouchEnd: (e) => { clear(); if (fired.current) { e.preventDefault(); } },
    onTouchCancel: clear,
    onContextMenu: (e) => { if (fired.current) { e.preventDefault(); return; } cb(e); },
  };
}

/* ------------------------------------------------------------------ modal shell */
export function Modal({ title, onClose, children, footer, className, wide, noPad, headerRight, back }) {
  const ref = useRef(null);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    document.addEventListener('keydown', key);
    const prev = document.activeElement;
    const f = ref.current?.querySelector('input,textarea,[autofocus]');
    if (f && window.matchMedia('(pointer:fine)').matches) f.focus();
    return () => { document.removeEventListener('keydown', key); prev?.focus?.({ preventScroll: true }); };
  }, [onClose]);
  return (
    <div className="modal-layer" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className={cx('modal glass', wide && 'wide', className)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        {title != null && (
          <div className="modal-head">
            {back ? <IconBtn icon="arrowRight" label="بازگشت" onClick={back} /> : null}
            <div className="modal-title">{title}</div>
            {headerRight}
            {onClose && <IconBtn icon="x" label="بستن" onClick={onClose} />}
          </div>
        )}
        <div className={cx('modal-body', noPad && 'no-pad')}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ promise-based confirm / prompt */
let resolver = null;
export function confirmDialog({ title, text, ok = 'تأیید', danger, check }) {
  return new Promise((res) => { resolver = res; setState({ dialog: { kind: 'confirm', title, text, ok, danger, check } }); });
}
export function promptDialog({ title, label, value = '', ok = 'ذخیره', maxLength = 128, dir, textarea, type }) {
  return new Promise((res) => { resolver = res; setState({ dialog: { kind: 'prompt', title, label, value, ok, maxLength, dir, textarea, type } }); });
}
export function Dialog() {
  const d = useStore((s) => s.dialog);
  const [val, setVal] = useState('');
  const [chk, setChk] = useState(false);
  useEffect(() => { if (d) { setVal(d.value || ''); setChk(false); } }, [d]);
  const done = useCallback((r) => { const f = resolver; resolver = null; setState({ dialog: null }); f?.(r); }, []);
  if (!d) return null;
  return (
    <Modal title={d.title} onClose={() => done(d.kind === 'prompt' ? null : false)} className="dialog"
      footer={<>
        <button type="button" className="btn btn-text" onClick={() => done(d.kind === 'prompt' ? null : false)}>انصراف</button>
        <button type="button" className={cx('btn btn-text', d.danger ? 'danger' : 'primary')} onClick={() => done(d.kind === 'prompt' ? val : (d.check ? { ok: true, check: chk } : true))}>{d.ok}</button>
      </>}>
      {d.text && <p className="dialog-text">{d.text}</p>}
      {d.check && (
        <label className="dialog-check" onClick={() => setChk(!chk)}>
          <span className={cx('check', chk && 'on')}>{chk && <Icon name="check" />}</span><span>{d.check}</span>
        </label>
      )}
      {d.kind === 'prompt' && (
        <form onSubmit={(e) => { e.preventDefault(); done(val); }}>
          <PromptField d={d} val={val} setVal={setVal} />
        </form>
      )}
    </Modal>
  );
}
import { Field } from './ui.jsx';
function PromptField({ d, val, setVal }) {
  return <Field label={d.label} value={val} onChange={setVal} maxLength={d.maxLength} dir={d.dir} textarea={d.textarea} type={d.type} autoFocus />;
}

export function Sheet({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-layer sheet-layer" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet glass">{children}</div>
    </div>
  );
}
export const isNarrow = () => window.innerWidth <= 720;
export const _gs = getState;
