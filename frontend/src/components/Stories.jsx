import { useEffect, useRef, useState } from 'react';
import { useStore, setState, getState, toast } from '../lib/store.js';
import { loadStories, userName, meId, openPrivate, sendMessage } from '../lib/actions.js';
import { api, assetUrl } from '../lib/api.js';
import { cx, fa, ago } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, Spinner } from './ui.jsx';
import { confirmDialog } from './overlay.jsx';

const DUR = 6000;
export default function StoryViewer() {
  const sv = useStore((s) => s.storyView);
  const groups = useStore((s) => s.stories);
  if (!sv) return null;
  return <Viewer key={sv.uid} uid={sv.uid} groups={groups} />;
}

function Viewer({ uid, groups }) {
  const order = [...groups].sort((a, b) => (a.user.id === meId() ? -1 : b.user.id === meId() ? 1 : 0));
  const gi = order.findIndex((g) => g.user.id === uid);
  const g = order[gi];
  const [i, setI] = useState(() => { const k = g?.items.findIndex((x) => !x.seen); return k > 0 ? k : 0; });
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  const [views, setViews] = useState(null);
  const [reply, setReply] = useState('');
  const vid = useRef(null);
  const close = () => { setState({ storyView: null }); loadStories(); };
  const item = g?.items[i];
  const mine = uid === meId();
  const next = () => {
    if (!g) return;
    if (i < g.items.length - 1) { setI(i + 1); setT(0); }
    else if (order[gi + 1]) setState({ storyView: { uid: order[gi + 1].user.id } });
    else close();
  };
  const prev = () => {
    if (i > 0) { setI(i - 1); setT(0); }
    else if (order[gi - 1]) setState({ storyView: { uid: order[gi - 1].user.id } });
    else setT(0);
  };
  useEffect(() => { if (item && !mine && !item.seen) api(`/stories/${item.id}/view`, { method: 'POST', body: {} }).catch(() => {}); setViews(null); }, [item?.id]); // eslint-disable-line
  useEffect(() => {
    if (!item || paused || views || item.kind === 'video') return undefined;
    const start = Date.now() - t * DUR;
    const iv = setInterval(() => { const p = (Date.now() - start) / DUR; if (p >= 1) { clearInterval(iv); next(); } else setT(p); }, 50);
    return () => clearInterval(iv);
  }, [item?.id, paused, views]); // eslint-disable-line
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') next(); else if (e.key === 'ArrowRight') prev(); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  });
  useEffect(() => { const v = vid.current; if (!v) return; if (paused || views) v.pause(); else v.play().catch(() => {}); }, [paused, views, item?.id]);
  if (!g || !item) { setTimeout(close, 0); return null; }
  const d = item.data || {};
  const react = async (e) => { try { await api(`/stories/${item.id}/view`, { method: 'POST', body: { reaction: e } }); toast(`واکنش ${e} ارسال شد.`, 'ok'); } catch (err) { toast(err.message, 'error'); } };
  const sendReply = async () => {
    const txt = reply.trim(); if (!txt) return;
    setReply('');
    try {
      const r = await api('/chats/private', { method: 'POST', body: { user_id: uid } });
      await sendMessage(r.chat.id, { text: `↩️ پاسخ به استوری: ${txt}` });
      toast('پاسخ ارسال شد.', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="story-layer" role="dialog" aria-label="استوری">
      <div className="story-box">
        <div className="story-bars">{g.items.map((x, k) => <span key={x.id}><i style={{ width: `${k < i ? 100 : k === i ? t * 100 : 0}%` }} /></span>)}</div>
        <div className="story-head">
          <Avatar src={g.user.avatar} name={g.user.name} color={g.user.color} size={38} />
          <div className="sh-text"><b>{mine ? 'استوری من' : userName(g.user)}</b><span>{ago(item.created_at)}</span></div>
          <IconBtn icon={paused ? 'play' : 'pause'} label={paused ? 'ادامه' : 'توقف'} onClick={() => setPaused(!paused)} />
          {mine && <IconBtn icon="trash" label="حذف استوری" onClick={async () => { setPaused(true); if (await confirmDialog({ title: 'حذف استوری', text: 'این استوری حذف شود؟', ok: 'حذف', danger: true })) { await api(`/stories/${item.id}`, { method: 'DELETE' }).catch(() => {}); await loadStories(); const ng = getState().stories.find((x) => x.user.id === uid); if (!ng) close(); else { setI(Math.min(i, ng.items.length - 1)); setT(0); } } setPaused(false); }} />}
          <IconBtn icon="x" label="بستن" onClick={close} />
        </div>
        <div className="story-content" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
          {item.kind === 'text' && <div className="story-text" style={{ background: `linear-gradient(135deg, ${d.bg?.[0]}, ${d.bg?.[1]})` }}><span>{d.e}{d.t}</span></div>}
          {item.kind === 'image' && <img src={assetUrl(d.url)} alt="" draggable="false" />}
          {item.kind === 'video' && <video ref={vid} src={assetUrl(d.url)} playsInline autoPlay onTimeUpdate={(e) => setT(e.currentTarget.currentTime / (e.currentTarget.duration || 1))} onEnded={next} />}
          {d.cap && <div className="story-cap">{d.cap}</div>}
          <button type="button" className="story-nav prev" onClick={prev} aria-label="قبلی" />
          <button type="button" className="story-nav next" onClick={next} aria-label="بعدی" />
        </div>
        <div className="story-foot">
          {mine ? (
            <button type="button" className="story-views" onClick={async () => { setPaused(true); try { setViews(await api(`/stories/${item.id}/views`)); } catch (e) { toast(e.message, 'error'); } }}>
              <Icon name="eye" />{fa(item.views || 0)} بازدید
            </button>
          ) : (
            <>
              <input className="story-reply" value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }} placeholder="پاسخ خصوصی…" aria-label="پاسخ به استوری" />
              {reply.trim() ? <IconBtn icon="send2" label="ارسال" onClick={sendReply} /> : ['❤️', '🔥', '😂'].map((e) => <button key={e} type="button" className="story-react" onClick={() => react(e)}>{e}</button>)}
            </>
          )}
        </div>
        {views && (
          <div className="story-views-panel glass">
            <div className="modal-head"><div className="modal-title">{fa(views.length)} بازدید</div><IconBtn icon="x" label="بستن" onClick={() => { setViews(null); setPaused(false); }} /></div>
            <div className="scroll">
              {!views.length && <div className="muted-note">هنوز کسی این استوری را ندیده است.</div>}
              {views.map((v) => (
                <div key={v.user.id} className="chat-item compact" onClick={() => { setState({ storyView: null }); openPrivate(v.user.id); }}>
                  <Avatar src={v.user.avatar} name={v.user.name} color={v.user.color} size={40} />
                  <div className="ci-body"><div className="ci-top"><span className="ci-title">{userName(v.user)}</span>{v.reaction && <span>{v.reaction}</span>}</div><div className="ci-bottom"><span className="ci-text">{ago(v.at)}</span></div></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export { Spinner, cx };
