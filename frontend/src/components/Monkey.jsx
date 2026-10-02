import { useEffect, useState } from 'react';
import { cx } from '../lib/format.jsx';

/**
 * Animated monkey, inspired by Telegram's sign-in mascot.
 * mode: 'idle' | 'track' (eyes follow the caret) | 'close' (paws cover eyes) | 'peek' (one paw lowered)
 * progress: 0..1 caret position for tracking.
 */
export default function Monkey({ mode = 'idle', progress = 0, size = 160 }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let t;
    const loop = () => { t = setTimeout(() => { setBlink(true); setTimeout(() => setBlink(false), 140); loop(); }, 2600 + Math.random() * 2600); };
    loop();
    return () => clearTimeout(t);
  }, []);
  const p = Math.max(0, Math.min(1, progress));
  // RTL page but the typed text is LTR: caret moves left → right
  const ex = mode === 'track' ? -6 + p * 12 : 0;
  const ey = mode === 'track' ? 4 : 0;
  const tilt = mode === 'track' ? (-4 + p * 8) : 0;
  const covered = mode === 'close' || mode === 'peek';
  return (
    <svg className={cx('monkey', `m-${mode}`)} width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
      <defs>
        <radialGradient id="mk-head" cx=".45" cy=".35" r=".75">
          <stop offset="0" stopColor="#c98a52" /><stop offset="1" stopColor="#9a5f31" />
        </radialGradient>
        <radialGradient id="mk-face" cx=".5" cy=".35" r=".8">
          <stop offset="0" stopColor="#ffe2bd" /><stop offset="1" stopColor="#f1c08b" />
        </radialGradient>
        <radialGradient id="mk-paw" cx=".4" cy=".3" r=".8">
          <stop offset="0" stopColor="#c07f47" /><stop offset="1" stopColor="#8e552a" />
        </radialGradient>
        <clipPath id="mk-clip"><circle cx="80" cy="80" r="80" /></clipPath>
      </defs>
      <g clipPath="url(#mk-clip)">
        <circle cx="80" cy="80" r="80" className="mk-bg" />
        <g className="mk-headgrp" style={{ transform: `rotate(${tilt}deg)` }}>
          {/* ears */}
          <circle cx="27" cy="82" r="17" fill="url(#mk-head)" />
          <circle cx="133" cy="82" r="17" fill="url(#mk-head)" />
          <circle cx="28" cy="82" r="9.5" fill="#f1b983" />
          <circle cx="132" cy="82" r="9.5" fill="#f1b983" />
          {/* head */}
          <ellipse cx="80" cy="80" rx="52" ry="50" fill="url(#mk-head)" />
          <path d="M66 32c4-6 10-8 14-8s10 2 14 8c-5-2-9-2-14 2-5-4-9-4-14-2z" fill="#8a532a" opacity=".6" />
          {/* face mask */}
          <path d="M80 60c-6-10-16-14-26-13-14 1-22 12-22 25 0 8 3 14 7 18-2 4-3 7-3 11 0 15 20 27 44 27s44-12 44-27c0-4-1-7-3-11 4-4 7-10 7-18 0-13-8-24-22-25-10-1-20 3-26 13z" fill="url(#mk-face)" />
          {/* eyes */}
          <g className="mk-eyes" style={{ transform: `translate(${ex}px, ${ey}px)` }}>
            <g className={cx('mk-eye', blink && !covered && 'blink')} style={{ transformOrigin: '63px 76px' }}>
              <ellipse cx="63" cy="76" rx="7.5" ry="9" fill="#2a1a10" />
              <circle cx="65.5" cy="72.5" r="2.6" fill="#fff" />
              <circle cx="61" cy="79.5" r="1.1" fill="#fff" opacity=".7" />
            </g>
            <g className={cx('mk-eye', blink && !covered && 'blink')} style={{ transformOrigin: '97px 76px' }}>
              <ellipse cx="97" cy="76" rx="7.5" ry="9" fill="#2a1a10" />
              <circle cx="99.5" cy="72.5" r="2.6" fill="#fff" />
              <circle cx="95" cy="79.5" r="1.1" fill="#fff" opacity=".7" />
            </g>
          </g>
          {/* cheeks */}
          <ellipse cx="50" cy="96" rx="8" ry="5" fill="#ff9a8a" opacity=".45" />
          <ellipse cx="110" cy="96" rx="8" ry="5" fill="#ff9a8a" opacity=".45" />
          {/* nose */}
          <ellipse cx="75.5" cy="95" rx="2.2" ry="2.8" fill="#8a532a" />
          <ellipse cx="84.5" cy="95" rx="2.2" ry="2.8" fill="#8a532a" />
          {/* mouth */}
          {covered
            ? <ellipse className="mk-mouth" cx="80" cy="110" rx="5" ry="4.5" fill="#7a3f22" />
            : <path className="mk-mouth" d={mode === 'track' ? 'M68 106c6 7 18 7 24 0' : 'M70 107c5 5 15 5 20 0'} fill="none" stroke="#7a3f22" strokeWidth="3" strokeLinecap="round" />}
        </g>
        {/* paws */}
        <g className="mk-paw mk-paw-l" style={{ transform: covered ? 'translate(0,0) rotate(0)' : 'translate(-10px, 96px) rotate(-18deg)' }}>
          <Paw cx={60} cy={78} flip={false} />
        </g>
        <g className="mk-paw mk-paw-r" style={{ transform: mode === 'close' ? 'translate(0,0) rotate(0)' : mode === 'peek' ? 'translate(4px, 17px) rotate(8deg)' : 'translate(10px, 96px) rotate(18deg)' }}>
          <Paw cx={100} cy={78} flip />
        </g>
      </g>
    </svg>
  );
}

function Paw({ cx, cy, flip }) {
  const s = flip ? -1 : 1;
  return (
    <g>
      <path d={`M${cx - 24 * s} ${cy + 60} C ${cx - 26 * s} ${cy + 30}, ${cx - 20 * s} ${cy + 14}, ${cx - 8 * s} ${cy + 10}`} stroke="url(#mk-paw)" strokeWidth="16" strokeLinecap="round" fill="none" />
      <ellipse cx={cx} cy={cy} rx="21" ry="17" fill="url(#mk-paw)" />
      <ellipse cx={cx - 12} cy={cy - 12} rx="6.5" ry="8" fill="url(#mk-paw)" />
      <ellipse cx={cx - 1} cy={cy - 16} rx="6.5" ry="8.5" fill="url(#mk-paw)" />
      <ellipse cx={cx + 10} cy={cy - 13} rx="6.5" ry="8" fill="url(#mk-paw)" />
      <ellipse cx={cx + (flip ? -17 : 17)} cy={cy - 3} rx="5.5" ry="7" fill="url(#mk-paw)" />
      <ellipse cx={cx} cy={cy + 2} rx="11" ry="8" fill="#e9b07a" opacity=".55" />
    </g>
  );
}
