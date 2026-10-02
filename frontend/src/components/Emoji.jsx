import { useRef, useState } from 'react';
import Sticker from './Sticker.jsx';
import { settings, setSetting } from '../lib/actions.js';
import { cx } from '../lib/format.jsx';
import { Icon, useDismiss } from './ui.jsx';
import { stickerSrc } from './Sticker.jsx';

const CATS = [
  ['smile', 'شکلک‌ها', '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖'],
  ['heart', 'ژست‌ها', '👋🤚🖐✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆🖕👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍️💅🤳💪🦾🦵🦶👂🦻👃🧠👀👁👅👄💋❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟'],
  ['sun', 'طبیعت', '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐒🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🌸🌼🌻🌺🌹🌷🌱🌲🌳🌴🌵🍀🍁🍂🍃🌍🌙⭐🌟✨⚡🔥🌈☀️⛅☁️🌧⛈❄️☃️🌊'],
  ['gift', 'غذا', '🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🧀🥚🍳🥞🧇🥓🍗🍖🌭🍔🍟🍕🥪🌮🌯🥗🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍥🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪☕🍵🧃🥤🧋'],
  ['zap', 'فعالیت', '⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🏓🏸🏒🥅⛳🏹🎣🥊🥋🎽🛹⛸🎿🏆🥇🥈🥉🏅🎖🎗🎫🎟🎪🎭🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🎻🎲♟🎯🎳🎮🎰🧩🚗🚕🚙🚌🏎🚓🚑🚒✈️🚀🛸🚁⛵🚤🏠🏡🏢🏰🗼🗽⛲🎡🎢'],
  ['bulb', 'اشیا', '⌚📱💻⌨️🖥🖨🖱💾💿📷📸📹🎥📞☎️📺📻🎙⏰⌛📡🔋🔌💡🔦🕯💸💵💰💳💎⚖️🔧🔨⚒🛠⛏🔩⚙️🧲🔫💣🔪🛡🚬⚰️🔮📿💈⚗️🔭🔬💊💉🧬🦠🧪🌡🧹🧺🧻🚽🛁🔑🗝🚪🛋🛏🧸🖼🛍🛒🎁🎈🎏🎀🎊🎉✉️📩📦📜📄📑📊📈📉📅📆📌📍✂️📝✏️🔍🔒🔓'],
  ['hash', 'نمادها', '💯✅☑️✔️❌❎➕➖➗✖️♾️‼️⁉️❓❔❕❗〰️💱💲⚕️♻️⚜️🔱📛🔰⭕🟢🟡🟠🔴🟣🔵⚫⚪🟤🔶🔷🔸🔹🔺🔻💠🔘🔳🔲🏁🚩🎌🏴🏳️'],
];
const seg = (s) => [...new Intl.Segmenter('fa', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment).filter((x) => x.trim());
const CAT_ICONS = { smile: 'smile', heart: 'heart', sun: 'sun', gift: 'star', zap: 'zap', bulb: 'info', hash: 'hash' };
const STICKER_PACKS = [
  { id: 1, count: 94 },
  { id: 2, count: 100 },
  { id: 3, count: 88 },
];
const GIF_COUNT = 16;

export default function EmojiPanel({ onEmoji, onSticker, onGif, onClose }) {
  const [tab, setTab] = useState('emoji');
  const [cat, setCat] = useState(0);
  const [pack, setPack] = useState(1);
  const [preview, setPreview] = useState(null);
  const ref = useRef(null);
  useDismiss(ref, onClose, true, '.composer-wrap, .ctx-layer, .modal-layer');
  const recent = settings().recentEmoji || [];
  const pick = (e) => {
    onEmoji(e);
    setSetting('recentEmoji', [e, ...recent.filter((x) => x !== e)].slice(0, 24));
  };
  const cats = recent.length ? [['clock', 'اخیر', recent.join('')], ...CATS] : CATS;
  const cur = cats[Math.min(cat, cats.length - 1)];
  return (
    <div className="emoji-panel glass" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ep-tabs" role="tablist">
        {[['emoji', 'شکلک'], ['sticker', 'استیکر'], ['gif', 'GIF']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={cx(tab === k && 'active')} onClick={() => { setPreview(null); setTab(k); }}>{l}</button>)}
      </div>
      {tab === 'emoji' && (
        <>
          <div className="ep-cats">
            {cats.map((c, i) => <button key={c[1]} type="button" className={cx(i === cat && 'active')} onClick={() => setCat(i)} aria-label={c[1]} title={c[1]}><Icon name={CAT_ICONS[c[0]] || c[0]} /></button>)}
          </div>
          <div className="ep-grid scroll" key={cat}>
            {seg(cur[2]).map((e, i) => <button key={`${e}${i}`} type="button" onClick={() => pick(e)}>{e}</button>)}
          </div>
        </>
      )}
      {tab === 'sticker' && (
        <>
          <div className="st-packs" role="group" aria-label="مجموعه‌های استیکر">
            {STICKER_PACKS.map((p) => <button key={p.id} type="button" className={cx(pack === p.id && 'active')} aria-label={`مجموعه استیکر ${p.id}`} aria-pressed={pack === p.id} onClick={() => { setPreview(null); setPack(p.id); }}><img src={`/stickers/${p.id}/0.webp`} alt="" /></button>)}
          </div>
          <div className="ep-stickers scroll" key={pack}>
            <div className="st-grid st-images">
              {Array.from({ length: STICKER_PACKS.find((p) => p.id === pack).count }, (_, i) => {
                const id = `${pack}:${i}`;
                const src = pack === 2 ? `/stickers/2/${i}.webp` : stickerSrc(id);
                return <button key={id} type="button" aria-label={`ارسال استیکر ${i + 1} از مجموعه ${pack}`} onClick={() => onSticker({ sticker: id })}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPreview(id); }} onPointerLeave={() => setPreview(null)} onFocus={() => setPreview(id)} onBlur={() => setPreview(null)}
                  onTouchStart={() => setPreview(id)}>
                  {pack === 2 && preview === id ? <Sticker id={id} /> : <img src={src} alt="" loading="lazy" draggable="false" />}
                </button>;
              })}
            </div>
          </div>
        </>
      )}
      {tab === 'gif' && (
        <div className="ep-gifs scroll">
          {Array.from({ length: GIF_COUNT }, (_, i) => <button key={i} type="button" aria-label={`ارسال گیف ${i + 1}`} onClick={() => onGif({ gif: i })}>
            <video src={`/gifs/${i}.webm`} poster={`/gifs/${i}.webp`} autoPlay loop muted playsInline preload="none" aria-hidden="true" /><span>GIF</span>
          </button>)}
        </div>
      )}
    </div>
  );
}
