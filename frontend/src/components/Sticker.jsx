import { useEffect, useRef } from 'react';

const sizes = { 1: 94, 2: 100, 3: 88 };
const motion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const players = new Set();
function updatePlayers() {
  let playing = 0;
  for (const player of players) {
    if (player.visible && !document.hidden && motion() && playing < 2) { player.animation.play(); playing++; }
    else player.animation.pause();
  }
}

export function stickerSrc(id) {
  const m = typeof id === 'string' && /^([123]):(0|[1-9]\d{0,2})$/.exec(id);
  if (!m || Number(m[2]) >= sizes[m[1]]) return null;
  return `/stickers/${m[1]}/${m[2]}.${m[1] === '2' ? 'tgs' : 'webp'}`;
}

export default function Sticker({ id, className = '' }) {
  const ref = useRef(null);
  const src = stickerSrc(id);
  useEffect(() => {
    if (!src?.endsWith('.tgs')) return;
    let cancelled = false;
    let animation;
    let started = false;
    const player = { animation: null, visible: false };
    const load = async () => {
      try {
        const [lottie, response] = await Promise.all([import('lottie-web/build/player/lottie_light'), fetch(src)]);
        if (!response.ok) throw new Error(`Sticker ${src}: ${response.status}`);
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        const data = JSON.parse(await new Response(stream).text());
        for (const layer of data.layers) if (layer.ty === 4 && !layer.shapes) layer.shapes = [];
        if (!cancelled && ref.current) {
          animation = lottie.default.loadAnimation({
            container: ref.current, renderer: 'svg', loop: true, autoplay: false, animationData: data,
            rendererSettings: { progressiveLoad: true },
          });
          animation.setSubframe(false);
          animation.addEventListener('DOMLoaded', () => { if (!cancelled) { player.animation = animation; players.add(player); updatePlayers(); } });
        }
      } catch (error) {
        if (!cancelled) { console.error(error); if (ref.current) ref.current.textContent = 'استیکر بارگذاری نشد'; }
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      player.visible = entry.isIntersecting;
      if (player.visible && !started) { started = true; load(); }
      updatePlayers();
    });
    document.addEventListener('visibilitychange', updatePlayers);
    observer.observe(ref.current);
    return () => { cancelled = true; observer.disconnect(); document.removeEventListener('visibilitychange', updatePlayers); players.delete(player); animation?.destroy(); updatePlayers(); };
  }, [src]);
  if (!src) return null;
  if (src.endsWith('.webp')) return <img className={className} src={src} alt="استیکر" loading="lazy" draggable="false" />;
  return <span ref={ref} className={className} role="img" aria-label="استیکر" />;
}
