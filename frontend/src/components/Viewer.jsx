import { useEffect, useState } from 'react';
import { useStore, setState, getState } from '../lib/store.js';
import { userName, userOf, openModal } from '../lib/actions.js';
import { assetUrl } from '../lib/api.js';
import { cx, fa, fmtFull } from '../lib/format.jsx';
import { IconBtn, Avatar } from './ui.jsx';

export default function MediaViewer() {
  const v = useStore((s) => s.viewer);
  const msgs = useStore((s) => (v?.chatId ? s.msgs.get(v.chatId)?.list : null));
  const [zoom, setZoom] = useState(1);
  const [idx, setIdx] = useState(0);
  const items = v?.src ? [{ src: v.src, title: v.title }] : (v?.list ? [...v.list].reverse() : (msgs || []))
    .filter((m) => (m.type === 'image' || m.type === 'video') && m.id > 0);
  useEffect(() => {
    if (!v) return;
    setZoom(1);
    if (v.mid) setIdx(Math.max(0, items.findIndex((m) => m.id === v.mid)));
    else setIdx(0);
  }, [v]); // eslint-disable-line
  const close = () => setState({ viewer: null });
  const go = (d) => { const n = idx + d; if (n >= 0 && n < items.length) { setIdx(n); setZoom(1); } };
  useEffect(() => {
    if (!v) return undefined;
    const k = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(1); if (e.key === 'ArrowRight') go(-1); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  });
  if (!v || !items.length) return null;
  const it = items[Math.min(idx, items.length - 1)];
  const src = it.src || assetUrl(it.data?.url);
  const sender = it.sender_id ? userOf(it.sender_id) : null;
  return (
    <div className="viewer" role="dialog" aria-label="نمایش رسانه" onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('vw-stage')) close(); }}>
      <div className="vw-top">
        {sender ? <div className="vw-who"><Avatar src={sender.avatar} name={sender.name} color={sender.color} size={36} /><div><b>{userName(sender)}</b><span>{fmtFull(it.created_at)}</span></div></div> : <div className="vw-who"><b>{it.title}</b></div>}
        <div className="vw-acts">
          {items.length > 1 && <span className="vw-count">{fa(idx + 1)} از {fa(items.length)}</span>}
          {it.type !== 'video' && <IconBtn icon={zoom > 1 ? 'minus' : 'plus'} label="بزرگ‌نمایی" onClick={() => setZoom(zoom > 1 ? 1 : 2)} />}
          {it.id && <IconBtn icon="forward" label="بازارسال" onClick={() => { close(); openModal({ type: 'forward', chatId: it.chat_id, ids: [it.id] }); }} />}
          <a className="icon-btn" href={src} download={it.data?.name || 'media'} target="_blank" rel="noopener noreferrer" aria-label="دانلود" title="دانلود">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
          </a>
          <IconBtn icon="x" label="بستن" onClick={close} />
        </div>
      </div>
      <div className="vw-stage">
        {it.type === 'video'
          ? <video key={src} src={src} controls autoPlay playsInline className="vw-media" />
          : <img key={src} src={src} alt="" className={cx('vw-media', zoom > 1 && 'zoomed')} style={zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' } : undefined} onClick={(e) => { e.stopPropagation(); setZoom(zoom > 1 ? 1 : 2); }} draggable="false" />}
      </div>
      {idx < items.length - 1 && <button type="button" className="vw-nav left" onClick={() => go(1)} aria-label="بعدی"><span>‹</span></button>}
      {idx > 0 && <button type="button" className="vw-nav right" onClick={() => go(-1)} aria-label="قبلی"><span>›</span></button>}
      {it.text && <div className="vw-cap">{it.text}</div>}
    </div>
  );
}
export { getState };
