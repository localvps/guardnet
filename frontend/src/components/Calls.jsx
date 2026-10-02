import { useEffect, useRef, useState } from 'react';
import { useStore, setState, getState, toast } from '../lib/store.js';
import { wsSend, setCallEventHook, setEndCallHook, userName, openPrivate } from '../lib/actions.js';
import { ring, stopRing, sound } from '../lib/sound.js';
import { cx, fmtDur } from '../lib/format.jsx';
import { Avatar, Icon } from './ui.jsx';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
// Runtime objects live outside React state
const rt = { pc: null, local: null, remote: null, pendingIce: [], screen: null };

const patch = (p) => { const c = getState().call; if (c) setState({ call: { ...c, ...p } }); };

export async function startCall(user, video) {
  if (getState().call) { toast('در حال حاضر یک تماس فعال دارید.', 'error'); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { toast('مرورگر شما از تماس پشتیبانی نمی‌کند.', 'error'); return; }
  setState({ call: { phase: 'requesting', peer: user, video, out: true, muted: false, cam: video, min: false } });
  try { rt.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false }); } catch {
    setState({ call: null }); toast(video ? 'دسترسی به دوربین یا میکروفون داده نشد.' : 'دسترسی به میکروفون داده نشد.', 'error'); return;
  }
  patch({ phase: 'calling' });
  ring(true);
  wsSend('call:start', { to: user.id, video });
}

function makePc(id) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  rt.pc = pc; rt.pendingIce = [];
  rt.remote = new MediaStream();
  rt.local?.getTracks().forEach((t) => pc.addTrack(t, rt.local));
  pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => { if (!rt.remote.getTracks().includes(t)) rt.remote.addTrack(t); }); patch({ remoteTick: Date.now() }); };
  pc.onicecandidate = (e) => { if (e.candidate) wsSend('call:ice', { call_id: id, cand: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') { const c = getState().call; if (c && c.phase !== 'active') { patch({ phase: 'active', since: Date.now() }); stopRing(); } }
    else if (s === 'failed') { toast('اتصال تماس برقرار نشد (شبکه یا فایروال).', 'error'); hangup(); }
    else if (s === 'disconnected') patch({ weak: true });
  };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') patch({ weak: false }); };
  return pc;
}
async function flushIce() { for (const c of rt.pendingIce.splice(0)) { try { await rt.pc.addIceCandidate(c); } catch { /* */ } } }

function cleanup(status) {
  stopRing();
  rt.pc?.close(); rt.pc = null;
  rt.local?.getTracks().forEach((t) => t.stop()); rt.local = null;
  rt.screen?.getTracks().forEach((t) => t.stop()); rt.screen = null;
  rt.remote = null; rt.pendingIce = [];
  const c = getState().call;
  if (!c) return;
  if (status) {
    sound('end');
    setState({ call: { ...c, phase: 'ended', status } });
    setTimeout(() => { if (getState().call?.phase === 'ended') setState({ call: null }); }, 1600);
  } else setState({ call: null });
}
export function hangup() {
  const c = getState().call; if (!c) return;
  if (c.id) wsSend(c.phase === 'incoming' ? 'call:decline' : 'call:hangup', { call_id: c.id });
  cleanup(c.id ? null : null);
}
setEndCallHook(() => cleanup());

async function accept() {
  const c = getState().call; if (!c || c.phase !== 'incoming') return;
  stopRing();
  patch({ phase: 'connecting' });
  try { rt.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: c.video }); } catch {
    try { rt.local = await navigator.mediaDevices.getUserMedia({ audio: true }); patch({ cam: false }); toast('دوربین در دسترس نیست؛ تماس صوتی برقرار می‌شود.'); } catch { toast('دسترسی به میکروفون داده نشد.', 'error'); wsSend('call:decline', { call_id: c.id }); cleanup(); return; }
  }
  makePc(c.id);
  wsSend('call:accept', { call_id: c.id });
}

setCallEventHook(async (ev, d) => {
  const c = getState().call;
  switch (ev) {
    case 'call:incoming':
      if (c) { wsSend('call:decline', { call_id: d.call_id }); return; }
      setState({ call: { phase: 'incoming', id: d.call_id, peer: d.from, video: d.video, out: false, muted: false, cam: d.video, min: false } });
      ring(false);
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(`${userName(d.from)} در حال تماس است`, { body: d.video ? 'تماس تصویری GuardNet' : 'تماس صوتی GuardNet', tag: `call${d.call_id}` }); } catch { /* */ }
      }
      break;
    case 'call:created': if (c?.out) patch({ id: d.call_id }); break;
    case 'call:status': if (c?.id === d.call_id && d.status === 'offline') patch({ offline: true }); break;
    case 'call:taken': if (c?.id === d.call_id && c.phase === 'incoming') cleanup(); break;
    case 'call:accepted': {
      if (!c || c.id !== d.call_id) return;
      stopRing(); patch({ phase: 'connecting' });
      const pc = makePc(c.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend('call:offer', { call_id: c.id, sdp: pc.localDescription.toJSON() });
      break;
    }
    case 'call:offer': {
      if (!c || c.id !== d.call_id || !rt.pc) return;
      await rt.pc.setRemoteDescription(d.sdp);
      await flushIce();
      const ans = await rt.pc.createAnswer();
      await rt.pc.setLocalDescription(ans);
      wsSend('call:answer', { call_id: c.id, sdp: rt.pc.localDescription.toJSON() });
      break;
    }
    case 'call:answer':
      if (!c || c.id !== d.call_id || !rt.pc) return;
      await rt.pc.setRemoteDescription(d.sdp); await flushIce();
      break;
    case 'call:ice':
      if (!c || c.id !== d.call_id || !rt.pc) return;
      if (rt.pc.remoteDescription) { try { await rt.pc.addIceCandidate(d.cand); } catch { /* */ } } else rt.pendingIce.push(d.cand);
      break;
    case 'call:media': if (c?.id === d.call_id) patch({ peerMuted: !!d.muted, peerCam: d.cam !== false }); break;
    case 'call:end': if (c && c.id === d.call_id) cleanup(d.status); break;
    case 'call:error': toast(d.msg, 'error'); cleanup(); break;
    default:
  }
});

function toggleMute() {
  const c = getState().call; if (!c || !rt.local) return;
  const m = !c.muted; rt.local.getAudioTracks().forEach((t) => { t.enabled = !m; });
  patch({ muted: m }); if (c.id) wsSend('call:media', { call_id: c.id, muted: m, cam: c.cam });
}
async function toggleCam() {
  const c = getState().call; if (!c || !rt.local) return;
  let track = rt.local.getVideoTracks()[0];
  if (!track) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true }); track = s.getVideoTracks()[0];
      rt.local.addTrack(track);
      const sender = rt.pc?.getSenders().find((x) => x.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track); else if (rt.pc) { rt.pc.addTrack(track, rt.local); await renegotiate(); }
      patch({ cam: true, video: true }); if (c.id) wsSend('call:media', { call_id: c.id, muted: c.muted, cam: true }); return;
    } catch { toast('دسترسی به دوربین داده نشد.', 'error'); return; }
  }
  track.enabled = !c.cam; patch({ cam: !c.cam });
  if (c.id) wsSend('call:media', { call_id: c.id, muted: c.muted, cam: !c.cam });
}
async function renegotiate() {
  const c = getState().call; if (!rt.pc || !c) return;
  const o = await rt.pc.createOffer(); await rt.pc.setLocalDescription(o);
  wsSend('call:offer', { call_id: c.id, sdp: rt.pc.localDescription.toJSON() });
}
async function toggleScreen() {
  const c = getState().call; if (!c || !rt.pc) return;
  const sender = rt.pc.getSenders().find((x) => x.track?.kind === 'video');
  if (rt.screen) {
    rt.screen.getTracks().forEach((t) => t.stop()); rt.screen = null;
    const cam = rt.local?.getVideoTracks()[0];
    if (sender) await sender.replaceTrack(cam || null);
    patch({ screen: false }); return;
  }
  if (!navigator.mediaDevices.getDisplayMedia) { toast('اشتراک صفحه در این مرورگر پشتیبانی نمی‌شود.', 'error'); return; }
  try {
    rt.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const tr = rt.screen.getVideoTracks()[0];
    tr.onended = () => { if (rt.screen) toggleScreen(); };
    if (sender) await sender.replaceTrack(tr); else { rt.pc.addTrack(tr, rt.screen); await renegotiate(); }
    patch({ screen: true });
  } catch { /* user cancelled */ }
}

export default function CallLayer() {
  const c = useStore((s) => s.call);
  const [, force] = useState(0);
  const rv = useRef(null); const lv = useRef(null); const ra = useRef(null);
  useEffect(() => { if (c?.phase !== 'active') return undefined; const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, [c?.phase]);
  useEffect(() => {
    if (rv.current && rt.remote && rv.current.srcObject !== rt.remote) { rv.current.srcObject = rt.remote; rv.current.play().catch(() => {}); }
    if (ra.current && rt.remote && ra.current.srcObject !== rt.remote) { ra.current.srcObject = rt.remote; ra.current.play().catch(() => {}); }
    if (lv.current && rt.local && lv.current.srcObject !== (rt.screen || rt.local)) { lv.current.srcObject = rt.screen || rt.local; lv.current.play().catch(() => {}); }
  });
  if (!c) return null;
  const hasRemoteVideo = !!rt.remote?.getVideoTracks().length && c.peerCam !== false && c.phase === 'active';
  const showLocal = (c.cam || c.screen) && rt.local;
  const status = c.phase === 'requesting' ? 'در حال آماده‌سازی…' : c.phase === 'calling' ? (c.offline ? 'در انتظار آنلاین شدن…' : 'در حال برقراری تماس…')
    : c.phase === 'incoming' ? (c.video ? 'تماس تصویری ورودی' : 'تماس صوتی ورودی') : c.phase === 'connecting' ? 'در حال اتصال…'
      : c.phase === 'ended' ? ({ declined: 'تماس رد شد', missed: 'بی‌پاسخ', cancelled: 'لغو شد', ended: 'تماس پایان یافت' }[c.status] || 'تماس پایان یافت')
        : fmtDur((Date.now() - (c.since || Date.now())) / 1000);
  if (c.min && c.phase === 'active') {
    return (
      <div className="call-pill glass" onClick={() => patch({ min: false })} role="button" tabIndex={0}>
        <audio ref={ra} autoPlay />
        <Icon name={c.video ? 'video' : 'phone'} /><span>{userName(c.peer)}</span><b>{status}</b>
        <button type="button" className="cp-end" onClick={(e) => { e.stopPropagation(); hangup(); }} aria-label="پایان تماس"><Icon name="phoneOff" /></button>
      </div>
    );
  }
  return (
    <div className={cx('call-screen', hasRemoteVideo && 'has-video')} role="dialog" aria-label="تماس">
      <div className="call-bg" style={{ '--c1': c.peer?.color?.[0] || '#4f8cff', '--c2': c.peer?.color?.[1] || '#8b5cf6' }} />
      <video ref={rv} className="call-remote" playsInline autoPlay style={{ display: hasRemoteVideo ? 'block' : 'none' }} />
      {!hasRemoteVideo && <audio ref={ra} autoPlay />}
      {showLocal && <video ref={lv} className={cx('call-local', !c.screen && 'mirror')} playsInline autoPlay muted />}
      <div className="call-top">
        {c.phase === 'active' && <button type="button" className="call-min" onClick={() => patch({ min: true })} aria-label="کوچک کردن"><Icon name="minimize" /></button>}
        <span className="call-enc"><Icon name="lock" />رمزنگاری سرتاسری WebRTC</span>
      </div>
      {!hasRemoteVideo && (
        <div className="call-peer">
          <div className={cx('call-av', (c.phase === 'calling' || c.phase === 'incoming') && 'pulse')}><Avatar src={c.peer?.avatar} name={c.peer?.name} color={c.peer?.color} size={132} /></div>
          <div className="call-name">{userName(c.peer)}</div>
          <div className="call-status">{status}{c.weak && c.phase === 'active' ? ' · اتصال ضعیف' : ''}{c.peerMuted ? ' · میکروفون طرف مقابل خاموش است' : ''}</div>
        </div>
      )}
      {hasRemoteVideo && <div className="call-over"><b>{userName(c.peer)}</b><span>{status}</span></div>}
      <div className="call-controls">
        {c.phase === 'incoming' ? (
          <>
            <CallBtn icon="phoneOff" label="رد تماس" kind="end" onClick={hangup} />
            <CallBtn icon={c.video ? 'video' : 'phone'} label="پاسخ" kind="accept" onClick={accept} />
          </>
        ) : c.phase === 'ended' ? (
          <CallBtn icon="send" label="پیام" onClick={() => { const u = c.peer; setState({ call: null }); openPrivate(u.id); }} />
        ) : (
          <>
            <CallBtn icon={c.muted ? 'micOff' : 'mic'} label={c.muted ? 'روشن کردن میکروفون' : 'بی‌صدا'} active={c.muted} onClick={toggleMute} />
            <CallBtn icon={c.cam ? 'video' : 'videoOff'} label={c.cam ? 'خاموش کردن دوربین' : 'روشن کردن دوربین'} active={!c.cam} onClick={toggleCam} />
            {c.phase === 'active' && <CallBtn icon="screen" label={c.screen ? 'توقف اشتراک صفحه' : 'اشتراک صفحه'} active={c.screen} onClick={toggleScreen} className="hide-touch" />}
            <CallBtn icon="phoneOff" label="پایان" kind="end" onClick={hangup} />
          </>
        )}
      </div>
    </div>
  );
}
function CallBtn({ icon, label, onClick, kind, active, className }) {
  return (
    <div className={cx('call-btn-wrap', className)}>
      <button type="button" className={cx('call-btn', kind, active && 'active')} onClick={onClick} aria-label={label}><Icon name={icon} /></button>
      <span>{label}</span>
    </div>
  );
}
