let ctx = null;
function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// unlock audio on first gesture (autoplay policy)
const unlock = () => { ac(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

function tone(freq, start, dur, gain = 0.07, type = 'sine') {
  const c = ac(); if (!c || c.state !== 'running') return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.02);
}
export function sound(kind) {
  try {
    if (kind === 'out') { tone(880, 0, 0.09, 0.04); tone(1320, 0.05, 0.1, 0.03); }
    else if (kind === 'in') { tone(660, 0, 0.12, 0.04); }
    else if (kind === 'notify') { tone(740, 0, 0.14, 0.06); tone(988, 0.12, 0.2, 0.05); }
    else if (kind === 'end') { tone(480, 0, 0.18, 0.06); tone(360, 0.18, 0.28, 0.06); }
  } catch { /* audio unsupported */ }
}
let ringT = null;
export function ring(outgoing) {
  stopRing();
  const once = () => {
    if (outgoing) { tone(425, 0, 1, 0.05); } else { tone(880, 0, 0.18, 0.07); tone(660, 0.2, 0.18, 0.07); tone(880, 0.4, 0.18, 0.07); tone(660, 0.6, 0.18, 0.07); }
  };
  once();
  ringT = setInterval(once, outgoing ? 4000 : 2400);
}
export function stopRing() { clearInterval(ringT); ringT = null; }
