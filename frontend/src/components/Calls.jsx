import { useEffect, useRef, useState } from 'react';
import { useStore, setState, getState, toast } from '../lib/store.js';
import { wsSend, setCallEventHook, setEndCallHook, userName, openPrivate } from '../lib/actions.js';
import { ring, stopRing, sound } from '../lib/sound.js';
import { cx, fmtDur } from '../lib/format.jsx';
import { Avatar, Icon } from './ui.jsx';
import { api } from '../lib/api.js';

// Self-hosted ICE only. The backend serves our own coturn (xxxxxx) as both
// STUN and TURN, so calls keep working on a fully national network with no
// Google/Cloudflare STUN and no third-party TURN. Hardcoded to our own relay
// so a slow /calls/ice response can never downgrade a call to host candidates.
let ICE_CONFIG = [{ urls: 'stun:xxxxxx:3478' }];
let ICE_POLICY = 'all';
let ICE_TURN = false;
let iceReady = null;

// A TURN entry without credentials makes RTCPeerConnection throw
// InvalidAccessError, so never hand one to the browser.
function usableIce(list) {
  return (list || []).filter((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    const needsAuth = urls.some((u) => /turns?:/i.test(u));
    return !needsAuth || (s.username && s.credential);
  });
}
async function loadIceConfig() {
  try {
    const r = await api('/calls/ice');
    if (r?.iceServers?.length) {
      ICE_CONFIG = usableIce(r.iceServers);
      ICE_POLICY = r.iceTransportPolicy || 'relay';
      ICE_TURN = ICE_CONFIG.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /turns?:/i.test(u)));
    }
  } catch { /* keep the built-in self-hosted STUN; calls still work without TURN */ }
  return ICE_CONFIG;
}
/** Load TURN credentials before the first call. The app loads before login, so
 *  the first request can be unauthenticated — retry once we may have a token. */
async function ensureIce() {
  if (!iceReady) iceReady = loadIceConfig();
  await iceReady;
  if (!ICE_TURN) { iceReady = loadIceConfig(); await iceReady; }
}

// High-quality audio constraints
const AUDIO_C = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 };
// High-quality video constraints
const VIDEO_C = { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' };

// Tune the encoders for a relayed call: the server is the transport, so keep
// audio resilient (Opus FEC/inband + comfortable packet time) and let video
// hold its frame rate and trade resolution instead of dropping frames.
async function tuneSenders(pc) {
  for (const s of pc.getSenders()) {
    if (s.track?.kind === 'video') {
      try {
        const p = s.getParameters();
        if (!p.encodings) p.encodings = [{}];
        p.degradationPreference = 'maintain-framerate';
        p.encodings[0].maxBitrate = 2000000;
        p.encodings[0].maxFramerate = 30;
        p.encodings[0].scaleResolutionDownBy = 1;
        await s.setParameters(p);
      } catch { /* */ }
    }
    if (s.track?.kind === 'audio') {
      try {
        const p = s.getParameters();
        if (!p.encodings) p.encodings = [{}];
        p.encodings[0].maxBitrate = 96000;
        await s.setParameters(p);
      } catch { /* */ }
      try {
        const st = await s.getStats();
        st.forEach((r) => {
          if (r.type === 'rtp') {
            const c = r.codec;
            if (r.kind === 'audio' && c) {
              c.useInbandFec = 1; c.maxAverageBitrate = 96000; c.maxPlayoutDelay = 120;
              c.ptime = 20; c.useDtx = 0; c.stereo = 0; c.spropStereo = 0;
              c.channelConfig = 1; c.feedbackEnabled = true;
            }
          }
        });
      } catch { /* older browsers ignore codec params */ }
    }
  }
}

// Screen share runs on a very different profile from the camera: the encoder
// must keep text readable instead of dropping resolution, and it only has to
// push ~30fps of mostly-static frames, not a live 30fps camera.
const SCREEN = { fps: { ideal: 30, max: 30 }, w: { max: 1920 }, h: { max: 1080 }, bitrate: 2500000 };
async function applyVideoProfile(kind) {
  const pc = rt.pc; if (!pc) return;
  for (const s of pc.getSenders()) {
    if (!s.track || s.track.kind !== 'video') continue;
    try {
      // Chrome rejects a partial dict ("Required member is undefined: codecs"),
      // so the profile has to be written into the real parameters object.
      const p = await s.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      const e = p.encodings[0];
      if (kind === 'screen') {
        const h = s.track.getSettings?.().height || 1080;
        e.maxBitrate = SCREEN.bitrate;
        e.maxFramerate = 30;
        e.scaleResolutionDownBy = Math.max(1, Math.min(2, h / 1080));
        e.degradationPreference = 'maintain-resolution';
      } else {
        e.maxBitrate = 2000000; e.maxFramerate = 30; e.scaleResolutionDownBy = 1;
        e.degradationPreference = 'maintain-framerate';
      }
      await s.setParameters(p);
    } catch { /* unsupported */ }
  }
}

// Runtime objects live outside React state
const rt = {
  pc: null, local: null, remote: null, pendingIce: [], screen: null, screenMic: null,
  reconnectTimer: null, watchTimer: null, gen: 0, relayTried: false, id: null,
};

// A call is stuck in "connecting" far too long. ICE can hang in `checking`
// forever behind a stateful firewall, so we escalate instead of waiting.
const STUCK_MS = 12000;
function armWatchdog() {
  if (rt.watchTimer) clearTimeout(rt.watchTimer);
  rt.watchTimer = setTimeout(() => {
    const pc = rt.pc;
    if (!pc || !getState().call) return;
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') return;
    if (!rt.relayTried && ICE_TURN) {
      // Direct path is not working - rebuild forcing the TURN relay.
      rt.relayTried = true;
      renegotiate('relay');
    } else {
      try { pc.restartIce(); } catch { /* */ }
    }
    armWatchdog();
  }, STUCK_MS);
}
function clearWatchdog() { if (rt.watchTimer) { clearTimeout(rt.watchTimer); rt.watchTimer = null; } }

const patch = (p) => { const c = getState().call; if (c) setState({ call: { ...c, ...p } }); };

export async function startCall(user, video) {
  if (getState().call) { toast('در حال حاضر یک تماس فعال دارید.', 'error'); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { toast('مرورگر شما از تماس پشتیبانی نمی‌کند.', 'error'); return; }
  await ensureIce(); // never dial without knowing the TURN servers
  rt.relayTried = false; rt.pendingIce = [];
  setState({ call: { phase: 'requesting', peer: user, video, out: true, muted: false, cam: video, min: false } });
  try {
    rt.local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_C, video: video ? VIDEO_C : false });
  } catch {
    setState({ call: null }); toast(video ? 'دسترسی به دوربین یا میکروفون داده نشد.' : 'دسترسی به میکروفون داده نشد.', 'error'); return;
  }
  patch({ phase: 'calling' });
  ring(true);
  wsSend('call:start', { to: user.id, video });
}

function makePc(id, policy) {
  rt.gen += 1;
  const gen = rt.gen;
  rt.pc?.close();
  const pc = new RTCPeerConnection({ iceServers: ICE_CONFIG, iceTransportPolicy: policy || ICE_POLICY });
  rt.pc = pc; rt.id = id;
  rt.remote = new MediaStream();
  rt.local?.getTracks().forEach((t) => pc.addTrack(t, rt.local));
  tuneSenders(pc);
  pc.ontrack = (e) => {
    const add = (t) => {
      if (!t || !rt.remote || rt.remote.getTracks().includes(t)) return;
      rt.remote.addTrack(t);
      // A removed sender leaves an ended track inside the stream; prune it or the
      // receiver keeps rendering the last frame of the screen forever.
      t.onended = () => { if (rt.remote && rt.remote.getTracks().includes(t)) rt.remote.removeTrack(t); patch({ remoteTick: Date.now() }); };
    };
    if (e.streams[0]) e.streams[0].getTracks().forEach(add); else add(e.track);
    patch({ remoteTick: Date.now() });
  };
  pc.onicecandidate = (e) => { if (e.candidate) wsSend('call:ice', { call_id: id, gen, cand: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') { const c = getState().call; if (c && c.phase !== 'active') { patch({ phase: 'active', since: Date.now() }); stopRing(); } }
    else if (s === 'failed') {
      if (!rt.relayTried && ICE_TURN) { rt.relayTried = true; renegotiate('relay'); }
      else { toast('اتصال تماس برقرار نشد (شبکه یا فایروال).', 'error'); hangup(); }
    }
    else if (s === 'disconnected') {
      patch({ weak: true });
      if (rt.reconnectTimer) clearTimeout(rt.reconnectTimer);
      rt.reconnectTimer = setTimeout(() => {
        if (rt.pc === pc && pc.connectionState === 'disconnected') {
          try { pc.restartIce(); } catch { /* */ }
        }
      }, 3000);
    } else if (s === 'connecting' || s === 'connected') {
      if (rt.reconnectTimer) { clearTimeout(rt.reconnectTimer); rt.reconnectTimer = null; }
    }
  };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') { patch({ weak: false }); clearWatchdog(); }
    else if (st === 'failed') {
      if (!rt.relayTried && ICE_TURN) { rt.relayTried = true; renegotiate('relay'); }
      else { toast('اتصال ICE ناموفق بود.', 'error'); hangup(); }
    } else armWatchdog();
  };
  armWatchdog();
  return pc;
}
async function flushIce() { for (const c of rt.pendingIce.splice(0)) { try { await rt.pc?.addIceCandidate(c); } catch { /* */ } } }

function cleanup(status) {
  stopRing();
  clearWatchdog();
  if (rt.reconnectTimer) { clearTimeout(rt.reconnectTimer); rt.reconnectTimer = null; }
  rt.pc?.close(); rt.pc = null;
  rt.local?.getTracks().forEach((t) => t.stop()); rt.local = null;
  rt.screen?.getTracks().forEach((t) => t.stop()); rt.screen = null;
  rt.screenMic = null;
  rt.remote = null; rt.pendingIce = [];
  rt.gen = 0; rt.relayTried = false; rt.id = null;
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
  try { rt.local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_C, video: c.video ? VIDEO_C : false }); } catch {
    try { rt.local = await navigator.mediaDevices.getUserMedia({ audio: true }); patch({ cam: false }); toast('دوربین در دسترس نیست؛ تماس صوتی برقرار می‌شود.'); } catch { toast('دسترسی به میکروفون داده نشد.', 'error'); wsSend('call:decline', { call_id: c.id }); cleanup(); return; }
  }
  await ensureIce(); // need TURN before we start gathering
  rt.relayTried = false; rt.pendingIce = [];
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
      // The callee starts gathering ICE before this offer arrives, so drain
      // whatever it already buffered before we send ours.
      await flushIce();
      const pc = makePc(c.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend('call:offer', { call_id: c.id, gen: rt.gen, sdp: pc.localDescription.toJSON() });
      break;
    }
    case 'call:offer': {
      if (!c || c.id !== d.call_id) return;
      if (d.gen !== undefined && d.gen !== rt.gen) {
        // Caller rebuilt its peer connection (TURN relay fallback).
        // Adopt the same generation, otherwise our ICE candidates will be stale.
        const pc = makePc(c.id, d.policy);
        await pc.setRemoteDescription(d.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        wsSend('call:answer', { call_id: c.id, gen: rt.gen, sdp: pc.localDescription.toJSON() });
        break;
      }
      if (!rt.pc) return;
      await rt.pc.setRemoteDescription(d.sdp);
      await flushIce();
      const ans = await rt.pc.createAnswer();
      await rt.pc.setLocalDescription(ans);
      wsSend('call:answer', { call_id: c.id, gen: rt.gen, sdp: rt.pc.localDescription.toJSON() });
      break;
    }
    case 'call:answer':
      if (!c || c.id !== d.call_id || !rt.pc) return;
      if (d.gen !== undefined && d.gen !== rt.gen) return; // stale answer
      await rt.pc.setRemoteDescription(d.sdp); await flushIce();
      break;
    case 'call:ice': {
      if (!c || c.id !== d.call_id) return;
      // ICE can legitimately arrive before we have built the peer connection;
      // buffering here is what keeps symmetric-NAT pairs from failing.
      if (!rt.pc || (d.gen !== undefined && d.gen !== rt.gen) || !rt.pc.remoteDescription) rt.pendingIce.push(d.cand);
      else { try { await rt.pc.addIceCandidate(d.cand); } catch { /* */ } }
      break;
    }
    case 'call:media': if (c?.id === d.call_id) patch({ peerMuted: !!d.muted, peerCam: d.cam !== false, peerScreen: !!d.screen }); break;
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
      if (sender) await sender.replaceTrack(track); else if (rt.pc) { rt.pc.addTrack(track, rt.local); await reoffer(); }
      patch({ cam: true, video: true }); if (c.id) wsSend('call:media', { call_id: c.id, muted: c.muted, cam: true }); return;
    } catch { toast('دسترسی به دوربین داده نشد.', 'error'); return; }
  }
  track.enabled = !c.cam; patch({ cam: !c.cam });
  if (c.id) wsSend('call:media', { call_id: c.id, muted: c.muted, cam: !c.cam });
}
async function renegotiate(policy) {
  const c = getState().call; if (!rt.local || !c?.id) return;
  const pc = makePc(c.id, policy);
  const o = await pc.createOffer();
  await pc.setLocalDescription(o);
  wsSend('call:offer', { call_id: c.id, gen: rt.gen, policy, sdp: pc.localDescription.toJSON() });
}
// Adding/removing a track must renegotiate on the SAME peer connection.
// renegotiate() rebuilds it (new ICE generation), which re-gathers candidates and
// stalls the whole call - including the audio that is already flowing.
async function reoffer() {
  const c = getState().call; if (!rt.pc || !c?.id) return;
  const pc = rt.pc;
  const o = await pc.createOffer();
  await pc.setLocalDescription(o);
  wsSend('call:offer', { call_id: c.id, gen: rt.gen, sdp: pc.localDescription.toJSON() });
}
async function toggleScreen() {
  const c = getState().call; if (!c || !rt.pc) return;
  const sender = (kind) => rt.pc.getSenders().find((x) => (x.track?.kind || x.kind) === kind);
  if (rt.screen) {
    rt.screen.getTracks().forEach((t) => { t.onended = null; t.stop(); }); rt.screen = null;
    // Drop the now-dead screen track first, otherwise it looks like "the camera"
    // and the peer keeps a frozen frame instead of going back to plain audio.
    rt.local?.getTracks().forEach((t) => { if (t.readyState === 'ended') rt.local.removeTrack(t); });
    const vs = sender('video');
    if (vs) {
      const cam = rt.local?.getVideoTracks()[0];
      if (cam) { await vs.replaceTrack(cam); await applyVideoProfile('camera'); }
      else {
        // Nothing to fall back to: drop the sender so the peer stops showing a
        // frozen frame, and take the transceiver out of the negotiated set.
        try { rt.pc.removeTrack(vs); } catch { /* */ }
        await reoffer();
      }
    }
    rt.local?.getTracks().forEach((t) => { if (!t.isLive || t.readyState === 'ended') rt.local.removeTrack(t); });
    rt.local?.getTracks().forEach((t) => { if (!t.isLive || t.readyState === 'ended') rt.local.removeTrack(t); });
    if (rt.screenMic) {
      const as = sender('audio');
      if (as) await as.replaceTrack(rt.screenMic.track);
      rt.local?.getAudioTracks().forEach((t) => { t.enabled = !rt.screenMic.muted; });
      rt.screenMic = null;
    }
    patch({ screen: false });
    if (c.id) wsSend('call:media', { call_id: c.id, muted: c.muted, cam: c.cam, screen: false });
    return;
  }
  if (!navigator.mediaDevices.getDisplayMedia) { toast('اشتراک صفحه در این مرورگر پشتیبانی نمی‌شود.', 'error'); return; }
  const video = { frameRate: SCREEN.fps, width: SCREEN.w, height: SCREEN.h };
  let stream;
  // System/tab audio is optional: requesting it can reject the whole capture on
  // some platforms, so fall back to video-only. A real cancel must not re-prompt.
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true }); }
  catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video }); }
    catch { return; }
  }
  const tr = stream.getVideoTracks()[0];
  if (!tr) { stream.getTracks().forEach((t) => t.stop()); return; }
  rt.screen = stream;
  rt.local?.addTrack(tr); // keep it in the local stream so a relay rebuild re-adds it
  tr.contentHint = 'detail';
  tr.onended = () => { if (rt.screen) toggleScreen(); };
  const vs = sender('video');
  if (vs) { await vs.replaceTrack(tr); await applyVideoProfile('screen'); }
  else { rt.pc.addTrack(tr, rt.local); await reoffer(); await applyVideoProfile('screen'); }
  // Tab audio replaces the mic for the duration of the share (one audio sender,
  // no renegotiation), then the mic is put back exactly as it was.
  const at = stream.getAudioTracks()[0];
  const as = sender('audio');
  if (at && as) {
    rt.screenMic = { track: as.track, muted: !!c.muted };
    rt.local?.getAudioTracks().forEach((t) => { t.enabled = false; });
    await as.replaceTrack(at);
  }
  patch({ screen: true });
  if (c.id) wsSend('call:media', { call_id: c.id, muted: c.muted, cam: c.cam, screen: true });
}

export default function CallLayer() {
  const c = useStore((s) => s.call);
  const [dur, setDur] = useState('');
  const rv = useRef(null); const lv = useRef(null); const ra = useRef(null);
  useEffect(() => {
    if (c?.phase !== 'active') { setDur(''); return undefined; }
    const t = setInterval(() => setDur(fmtDur((Date.now() - (c.since || Date.now())) / 1000)), 500);
    return () => clearInterval(t);
  }, [c?.phase, c?.since]);
  useEffect(() => {
    if (rv.current && rt.remote && rv.current.srcObject !== rt.remote) { rv.current.srcObject = rt.remote; rv.current.play().catch(() => {}); }
    if (ra.current && rt.remote && ra.current.srcObject !== rt.remote) { ra.current.srcObject = rt.remote; ra.current.play().catch(() => {}); }
    if (lv.current && rt.local && lv.current.srcObject !== (rt.screen || rt.local)) { lv.current.srcObject = rt.screen || rt.local; lv.current.play().catch(() => {}); }
  });
  if (!c) return null;
  const hasRemoteVideo = !!rt.remote?.getVideoTracks().length && (c.peerCam !== false || !!c.peerScreen) && c.phase === 'active';
  const showLocal = (c.cam || c.screen) && rt.local;
  const status = c.phase === 'requesting' ? 'در حال آماده‌سازی…' : c.phase === 'calling' ? (c.offline ? 'در انتظار آنلاین شدن…' : 'در حال برقراری تماس…')
    : c.phase === 'incoming' ? (c.video ? 'تماس تصویری ورودی' : 'تماس صوتی ورودی') : c.phase === 'connecting' ? 'در حال اتصال…'
      : c.phase === 'ended' ? ({ declined: 'تماس رد شد', missed: 'بی‌پاسخ', cancelled: 'لغو شد', ended: 'تماس پایان یافت' }[c.status] || 'تماس پایان یافت')
        : dur;
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
    <div className={cx('call-screen', hasRemoteVideo && 'has-video', c.screen && 'sharing-out', c.peerScreen && 'sharing-in')} role="dialog" aria-label="تماس">
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
      {hasRemoteVideo && <div className="call-over"><b>{userName(c.peer)}</b><span>{status}</span>{c.peerScreen && <span className="call-share-tag"><Icon name="screen" />اشتراک صفحه</span>}</div>}
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
