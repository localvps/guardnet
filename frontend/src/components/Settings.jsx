import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useStore, setState, getState, putUsers, toast } from '../lib/store.js';
import { pushView, popView, settings, setSetting, logout, uploadAvatar, userName, openModal, sortedChats, chatTitle, chatAvatarProps, meId } from '../lib/actions.js';
import { api } from '../lib/api.js';
import { cx, fa, ago, fmtDay } from '../lib/format.jsx';
import { Avatar, Icon, IconBtn, NameLine, Row, Toggle, Radio, Spinner, Empty, Field, Button, PremiumStar, Logo, Check } from './ui.jsx';
import { confirmDialog, promptDialog, Modal } from './overlay.jsx';
import { SideHead } from './Views.jsx';
import { hashPasscode } from './Lock.jsx';
import { pwScore } from './Auth.jsx';

export default function SettingsView({ view }) {
  const sub = view.name.split(':')[1] || 'main';
  switch (sub) {
    case 'profile': return <Profile />;
    case 'privacy': return <Privacy />;
    case 'security': return <Security />;
    case 'devices': return <Devices />;
    case 'appearance': return <Appearance />;
    case 'notifications': return <Notifications />;
    case 'folders': return <Folders />;
    case 'premium': return <Premium />;
    case 'blocked': return <Blocked />;
    default: return <Main />;
  }
}

function Main() {
  const me = useStore((s) => s.me);
  const file = useRef(null);
  return (
    <div className="side-view">
      <SideHead title="تنظیمات">
        <IconBtn icon="pencil" label="ویرایش پروفایل" onClick={() => pushView('settings:profile')} />
        <IconBtn icon="logout" label="خروج" onClick={async () => { if (await confirmDialog({ title: 'خروج', text: 'از حساب GuardNet در این دستگاه خارج می‌شوید؟', ok: 'خروج', danger: true })) logout(); }} />
      </SideHead>
      <div className="scroll">
        <div className="profile-hero settings-hero">
          <div className="av-edit"><Avatar src={me.avatar} name={me.name} color={me.color} size={112} /><button type="button" className="av-cam" onClick={() => file.current?.click()} aria-label="تغییر عکس"><Icon name="camera" /></button><input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ''; }} /></div>
          <div className="ph-name"><NameLine name={me.name} user={me} /></div>
          <div className="ph-status online">آنلاین</div>
        </div>
        <div className="info-card">
          <Row icon="at" title={<span dir="ltr">@{me.username}</span>} sub="نام کاربری" onClick={() => pushView('settings:profile')} />
          <Row icon="info" title={me.bio || 'بیوگرافی خود را بنویسید'} sub="بیوگرافی" onClick={() => pushView('settings:profile')} className={!me.bio ? 'placeholder' : ''} />
        </div>
        <div className="info-card">
          <Row icon="bell" iconBg="#e74c3c" title="اعلان‌ها و صداها" onClick={() => pushView('settings:notifications')} chevron />
          <Row icon="lock" iconBg="#34a853" title="حریم خصوصی" onClick={() => pushView('settings:privacy')} chevron />
          <Row icon="shield" iconBg="#1a73e8" title="امنیت" sub={me.totp ? 'تأیید دو مرحله‌ای فعال' : 'تأیید دو مرحله‌ای غیرفعال'} onClick={() => pushView('settings:security')} chevron />
          <Row icon="monitor" iconBg="#f59e0b" title="دستگاه‌ها" onClick={() => pushView('settings:devices')} chevron />
          <Row icon="palette" iconBg="#8b5cf6" title="ظاهر و تم" onClick={() => pushView('settings:appearance')} chevron />
          <Row icon="folder" iconBg="#06b6d4" title="پوشه‌های گفتگو" onClick={() => pushView('settings:folders')} chevron />
        </div>
        <div className="info-card">
          <div className="row clickable premium-row" onClick={() => pushView('settings:premium')} role="button" tabIndex={0}>
            <span className="row-ic prem"><PremiumStar size={22} /></span>
            <span className="row-body"><span className="row-title">GuardNet پریمیوم</span>{me.premium && <span className="row-sub">فعال تا {fmtDay(me.premium_until)}</span>}</span>
            <Icon name="chevLeft" className="row-chev" />
          </div>
        </div>
        <div className="about-foot"><Logo size={22} /><span>GuardNet Web · نسخه ۳٫۰</span><span>پیام‌رسان امن با رمزنگاری ذخیره‌سازی</span></div>
      </div>
    </div>
  );
}

function Profile() {
  const me = useStore((s) => s.me);
  const [name, setName] = useState(me.name);
  const [bio, setBio] = useState(me.bio || '');
  const [un, setUn] = useState(me.username);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  const limit = me.limits?.bio || 70;
  const dirty = name !== me.name || bio !== (me.bio || '') || un !== me.username;
  const save = async () => {
    const body = {};
    if (!name.trim()) { setErr({ name: 'نام الزامی است' }); return; }
    if (name !== me.name) body.name = name.trim();
    if (bio !== (me.bio || '')) body.bio = bio;
    if (un !== me.username) {
      if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(un)) { setErr({ un: '۵ تا ۳۲ نویسه؛ با حرف انگلیسی شروع شود' }); return; }
      body.username = un;
    }
    setBusy(true);
    try { const m = await api('/me', { method: 'PATCH', body }); setState({ me: m }); putUsers([m]); toast('ذخیره شد.', 'ok'); popView(); } catch (e) { setErr({ [e.message.includes('کاربری') ? 'un' : 'bio']: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="side-view">
      <SideHead title="ویرایش پروفایل" />
      <div className="scroll pad">
        <div className="create-head">
          <div className="av-edit">
            <Avatar src={me.avatar} name={me.name} color={me.color} size={112} />
            <button type="button" className="av-cam" onClick={() => file.current?.click()} aria-label="تغییر عکس"><Icon name="camera" /></button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ''; }} />
          </div>
          {me.avatar && <button type="button" className="auth-link danger" onClick={async () => { try { const m = await api('/me', { method: 'PATCH', body: { avatar: null } }); setState({ me: m }); putUsers([m]); } catch (e) { toast(e.message, 'error'); } }}>حذف عکس</button>}
        </div>
        <Field label="نام" value={name} onChange={(v) => { setName(v); setErr({}); }} maxLength={64} error={err.name} />
        <Field label="بیوگرافی" value={bio} onChange={(v) => { setBio(v); setErr({}); }} textarea rows={3} error={err.bio} counter={fa(limit - [...bio].length)}
          hint={`هر چیزی درباره خودتان. حداکثر ${fa(limit)} نویسه${me.premium ? '' : ' (پریمیوم: ۵۰۰)'}.`} />
        <Field label="نام کاربری" value={un} onChange={(v) => { setUn(v.replace(/[^A-Za-z0-9_]/g, '')); setErr({}); }} dir="ltr" maxLength={32} error={err.un} suffix={<span className="at">@</span>}
          hint="دیگران می‌توانند شما را با این نام کاربری پیدا کنند. ورود به حساب هم با همین نام انجام می‌شود." />
        {me.premium && <EmojiStatus />}
        <Button full loading={busy} disabled={!dirty} onClick={save}>ذخیره</Button>
      </div>
    </div>
  );
}
function EmojiStatus() {
  const me = useStore((s) => s.me);
  const opts = ['⭐', '💎', '🔥', '🚀', '👑', '🦄', '🎧', '💻', '🌙', '☕', '🎮', '❤️'];
  const set = async (e) => { try { const m = await api('/me', { method: 'PATCH', body: { emoji_status: e } }); setState({ me: m }); putUsers([m]); } catch (err) { toast(err.message, 'error'); } };
  return (
    <div className="emoji-status-pick">
      <div className="sec-title"><PremiumStar size={14} /> وضعیت ایموجی</div>
      <div className="es-grid">
        <button type="button" className={cx(!me.emoji_status && 'on')} onClick={() => set(null)} aria-label="بدون وضعیت"><PremiumStar size={20} /></button>
        {opts.map((e) => <button key={e} type="button" className={cx(me.emoji_status === e && 'on')} onClick={() => set(e)}>{e}</button>)}
      </div>
    </div>
  );
}

const WHO = [['all', 'همه'], ['contacts', 'مخاطبین من'], ['none', 'هیچ‌کس']];
function Privacy() {
  const me = useStore((s) => s.me);
  const p = me.privacy || {};
  const [open, setOpen] = useState(null);
  const set = async (k, v) => {
    try { const r = await api('/me/privacy', { method: 'PATCH', body: { [k]: v } }); setState({ me: { ...getState().me, privacy: r.privacy } }); } catch (e) { toast(e.message, 'error'); }
  };
  const items = [['lastSeen', 'آخرین بازدید و آنلاین بودن', 'clock'], ['photo', 'عکس پروفایل', 'image'], ['calls', 'تماس‌ها', 'phone'], ['groups', 'افزودن به گروه‌ها', 'users'], ['forwards', 'پیام‌های بازارسال‌شده', 'forward']];
  const label = (v) => WHO.find((x) => x[0] === v)?.[1] || 'همه';
  return (
    <div className="side-view">
      <SideHead title="حریم خصوصی" />
      <div className="scroll">
        <div className="info-card">
          <div className="card-title">حریم خصوصی</div>
          {items.map(([k, t, ic]) => <Row key={k} icon={ic} title={t} value={label(p[k])} onClick={() => setOpen(k)} chevron />)}
        </div>
        <div className="info-card">
          <Row icon="checks" title="رسید خواندن" sub="اگر خاموش باشد، رسید خواندن دیگران را هم نمی‌بینید." right={<Toggle checked={p.readReceipts !== false} onChange={(v) => set('readReceipts', v)} label="رسید خواندن" />} />
          <Row icon="ban" title="کاربران مسدود" onClick={() => pushView('settings:blocked')} chevron />
          <Row icon="ghost" title="حالت مخفی استوری" sub={me.premium ? 'استوری‌ها را بدون ثبت بازدید ببینید' : 'مخصوص پریمیوم'} right={<Toggle checked={!!me.settings?.stealth} disabled={!me.premium} onChange={(v) => setSetting('stealth', v)} label="حالت مخفی" />} />
        </div>
      </div>
      {open && (
        <Modal title={items.find((x) => x[0] === open)[1]} onClose={() => setOpen(null)}>
          <p className="dialog-text">چه کسانی می‌توانند این مورد را ببینند یا انجام دهند؟</p>
          {WHO.map(([v, l]) => <div key={v} className="row clickable" onClick={() => { set(open, v); setOpen(null); }}><Radio checked={(p[open] || 'all') === v} /><span className="row-body"><span className="row-title">{l}</span></span></div>)}
        </Modal>
      )}
    </div>
  );
}
function Blocked() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/blocks').then((r) => { putUsers(r); setList(r); }).catch(() => setList([])); }, []);
  return (
    <div className="side-view">
      <SideHead title="کاربران مسدود" />
      <div className="chat-list scroll">
        {list === null && <div className="list-loading"><Spinner /></div>}
        {list?.map((u) => (
          <div key={u.id} className="chat-item compact">
            <Avatar src={u.avatar} name={u.name} color={u.color} size={44} />
            <div className="ci-body"><div className="ci-top"><span className="ci-title"><NameLine name={userName(u)} user={u} /></span></div><div className="ci-bottom"><span className="ci-text" dir="ltr">@{u.username}</span></div></div>
            <button type="button" className="btn btn-text primary sm" onClick={async () => { try { putUsers([await api(`/blocks/${u.id}`, { method: 'DELETE' })]); setList((l) => l.filter((x) => x.id !== u.id)); } catch (e) { toast(e.message, 'error'); } }}>رفع مسدودیت</button>
          </div>
        ))}
        {list?.length === 0 && <Empty icon="ban" title="کسی مسدود نیست" sub="کاربرانی که مسدود کنید اینجا نمایش داده می‌شوند." />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ security */
function Security() {
  const me = useStore((s) => s.me);
  const [modal, setModal] = useState(null);
  const s = me.settings || {};
  return (
    <div className="side-view">
      <SideHead title="امنیت" />
      <div className="scroll">
        <div className="sec-banner"><Icon name="shield" /><div><b>حساب شما محافظت می‌شود</b><span>رمزها با scrypt هش و رازهای ۲FA با AES-256-GCM رمزنگاری می‌شوند.</span></div></div>
        <div className="info-card">
          <Row icon="key" title="تغییر رمز عبور" sub="پس از تغییر، همه نشست‌های دیگر خاتمه می‌یابند" onClick={() => setModal('password')} chevron />
          <Row icon="fingerprint" title="تأیید دو مرحله‌ای" sub={me.totp ? 'فعال — با برنامه احراز هویت' : 'غیرفعال'} value={me.totp ? 'روشن' : 'خاموش'} onClick={() => setModal(me.totp ? 'totpOff' : 'totpOn')} chevron />
          <Row icon="lock" title="رمز محلی (قفل برنامه)" sub={s.passcode ? 'فعال در این حساب' : 'غیرفعال'} value={s.passcode ? 'روشن' : 'خاموش'} onClick={() => setModal('passcode')} chevron />
          {s.passcode && <Row icon="clock" title="قفل خودکار" value={s.autolock ? `${fa(s.autolock)} دقیقه` : 'خاموش'} onClick={() => setModal('autolock')} chevron />}
          {s.passcode && <Row icon="lock" title="همین حالا قفل کن" onClick={() => setState({ phase: 'locked' })} />}
          <Row icon="monitor" title="دستگاه‌های فعال" onClick={() => pushView('settings:devices')} chevron />
        </div>
        <div className="info-card">
          <Row icon="trash" title="حذف حساب کاربری" danger onClick={() => setModal('delete')} />
        </div>
      </div>
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} />}
      {modal === 'totpOn' && <TotpSetup onClose={() => setModal(null)} />}
      {modal === 'totpOff' && <TotpOff onClose={() => setModal(null)} />}
      {modal === 'passcode' && <PasscodeModal onClose={() => setModal(null)} />}
      {modal === 'autolock' && (
        <Modal title="قفل خودکار" onClose={() => setModal(null)}>
          {[0, 1, 5, 15, 60].map((v) => <div key={v} className="row clickable" onClick={() => { setSetting('autolock', v); setModal(null); }}><Radio checked={(s.autolock || 0) === v} /><span className="row-body"><span className="row-title">{v ? `پس از ${fa(v)} دقیقه عدم فعالیت` : 'خاموش'}</span></span></div>)}
        </Modal>
      )}
      {modal === 'delete' && <DeleteAccount onClose={() => setModal(null)} />}
    </div>
  );
}
function PasswordModal({ onClose }) {
  const [o, setO] = useState(''); const [n, setN] = useState(''); const [n2, setN2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (n !== n2) { setErr('تکرار رمز یکسان نیست'); return; }
    setBusy(true);
    try { const r = await api('/me/password', { method: 'POST', body: { old: o, new: n } }); toast(`رمز عبور تغییر کرد${r.terminated ? ` و ${fa(r.terminated)} نشست دیگر خاتمه یافت` : ''}.`, 'ok'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="تغییر رمز عبور" onClose={onClose} footer={<><button type="button" className="btn btn-text" onClick={onClose}>انصراف</button><button type="button" className="btn btn-text primary" onClick={go} disabled={busy || !o || !n}>{busy ? <Spinner size={18} /> : 'ذخیره'}</button></>}>
      <Field label="رمز فعلی" type="password" value={o} onChange={setO} dir="ltr" autoComplete="current-password" autoFocus />
      <Field label="رمز جدید" type="password" value={n} onChange={(v) => { setN(v); setErr(''); }} dir="ltr" autoComplete="new-password" />
      {n && <div className={cx('pw-meter', `s${pwScore(n)}`)}><div className="pw-bars">{[0, 1, 2, 3].map((i) => <span key={i} className={cx(i < pwScore(n) && 'on')} />)}</div></div>}
      <Field label="تکرار رمز جدید" type="password" value={n2} onChange={(v) => { setN2(v); setErr(''); }} dir="ltr" error={err} autoComplete="new-password" />
    </Modal>
  );
}
function TotpSetup({ onClose }) {
  const [data, setData] = useState(null); const [qr, setQr] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/2fa/setup', { method: 'POST', body: {} }).then(async (r) => { setData(r); setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' })); }).catch((e) => setErr(e.message)); }, []);
  const go = async () => {
    setBusy(true);
    try { const m = await api('/2fa/enable', { method: 'POST', body: { code } }); setState({ me: m }); toast('تأیید دو مرحله‌ای فعال شد.', 'ok'); onClose(); } catch (e) { setErr(e.message); setCode(''); } finally { setBusy(false); }
  };
  return (
    <Modal title="فعال‌سازی تأیید دو مرحله‌ای" onClose={onClose} footer={<><button type="button" className="btn btn-text" onClick={onClose}>انصراف</button><button type="button" className="btn btn-text primary" onClick={go} disabled={busy || code.length !== 6}>{busy ? <Spinner size={18} /> : 'فعال‌سازی'}</button></>}>
      <p className="dialog-text">با Google Authenticator یا هر برنامه TOTP این کد را اسکن کنید، سپس کد ۶ رقمی را وارد کنید.</p>
      <div className="totp-qr">{qr ? <img src={qr} alt="کد QR تأیید دو مرحله‌ای" width="200" height="200" /> : <Spinner size={30} />}</div>
      {data && <div className="totp-secret"><span>کلید دستی:</span><code dir="ltr">{data.secret.replace(/(.{4})/g, '$1 ').trim()}</code><IconBtn icon="copy" label="کپی کلید" onClick={() => navigator.clipboard?.writeText(data.secret).then(() => toast('کپی شد.', 'ok'))} /></div>}
      <Field label="کد ۶ رقمی" value={code} onChange={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setErr(''); }} dir="ltr" inputMode="numeric" error={err} autoComplete="one-time-code" />
    </Modal>
  );
}
function TotpOff({ onClose }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const m = await api('/2fa/disable', { method: 'POST', body: { password: pw } }); setState({ me: m }); toast('تأیید دو مرحله‌ای غیرفعال شد.'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Modal title="غیرفعال‌سازی تأیید دو مرحله‌ای" onClose={onClose} footer={<><button type="button" className="btn btn-text" onClick={onClose}>انصراف</button><button type="button" className="btn btn-text danger" onClick={go} disabled={busy || !pw}>{busy ? <Spinner size={18} /> : 'غیرفعال کن'}</button></>}>
      <p className="dialog-text">برای امنیت، رمز عبور حساب را وارد کنید.</p>
      <Field label="رمز عبور" type="password" value={pw} onChange={(v) => { setPw(v); setErr(''); }} dir="ltr" error={err} autoFocus />
    </Modal>
  );
}
function PasscodeModal({ onClose }) {
  const has = !!settings().passcode;
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState('');
  const go = async () => {
    if (has) { setSetting('passcode', null); setSetting('autolock', 0); toast('رمز محلی حذف شد.'); onClose(); return; }
    if (!/^\d{4,8}$/.test(a)) { setErr('۴ تا ۸ رقم وارد کنید'); return; }
    if (a !== b) { setErr('تکرار رمز یکسان نیست'); return; }
    setSetting('passcode', await hashPasscode(a, meId()));
    if (!settings().autolock) setSetting('autolock', 15);
    toast('رمز محلی فعال شد.', 'ok'); onClose();
  };
  return (
    <Modal title="رمز محلی" onClose={onClose} footer={<><button type="button" className="btn btn-text" onClick={onClose}>انصراف</button><button type="button" className={cx('btn btn-text', has ? 'danger' : 'primary')} onClick={go}>{has ? 'حذف رمز محلی' : 'فعال‌سازی'}</button></>}>
      {has ? <p className="dialog-text">با حذف رمز محلی، برنامه بدون رمز باز می‌شود.</p> : (
        <>
          <p className="dialog-text">با رمز محلی، GuardNet پس از مدتی عدم فعالیت قفل می‌شود. این رمز جدا از رمز حساب است.</p>
          <Field label="رمز محلی (۴ تا ۸ رقم)" type="password" value={a} onChange={(v) => { setA(v.replace(/\D/g, '').slice(0, 8)); setErr(''); }} dir="ltr" inputMode="numeric" autoFocus />
          <Field label="تکرار رمز محلی" type="password" value={b} onChange={(v) => { setB(v.replace(/\D/g, '').slice(0, 8)); setErr(''); }} dir="ltr" inputMode="numeric" error={err} />
        </>
      )}
    </Modal>
  );
}
function DeleteAccount({ onClose }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api('/me', { method: 'DELETE', body: { password: pw } }); toast('حساب شما حذف شد.'); logout(); } catch (e) { setErr(e.message); setBusy(false); } };
  return (
    <Modal title="حذف حساب کاربری" onClose={onClose} footer={<><button type="button" className="btn btn-text" onClick={onClose}>انصراف</button><button type="button" className="btn btn-text danger" onClick={go} disabled={busy || !pw}>{busy ? <Spinner size={18} /> : 'حذف همیشگی'}</button></>}>
      <p className="dialog-text danger-text">این کار برگشت‌پذیر نیست. پروفایل، مخاطبین و استوری‌ها حذف می‌شوند و از همه دستگاه‌ها خارج می‌شوید.</p>
      <Field label="رمز عبور" type="password" value={pw} onChange={(v) => { setPw(v); setErr(''); }} dir="ltr" error={err} autoFocus />
    </Modal>
  );
}

/* ------------------------------------------------------------------ devices */
function Devices() {
  const [list, setList] = useState(null);
  const [link, setLink] = useState(false);
  const load = () => api('/sessions').then(setList).catch((e) => { toast(e.message, 'error'); setList([]); });
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const cur = list?.find((s) => s.current); const others = (list || []).filter((s) => !s.current);
  const kill = async (s) => { if (!(await confirmDialog({ title: 'خاتمه نشست', text: `نشست «${s.device}» خاتمه یابد؟`, ok: 'خاتمه', danger: true }))) return; try { await api(`/sessions/${s.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="side-view">
      <SideHead title="دستگاه‌ها" />
      <div className="scroll">
        <div className="link-hero">
          <span className="lh-ic"><Icon name="qrScan" /></span>
          <div className="lh-text">GuardNet را روی دستگاه دیگری باز کنید و «ورود با کد QR» را بزنید، سپس اینجا کد را اسکن یا وارد کنید.</div>
          <Button icon="qr" onClick={() => setLink(true)}>اتصال دستگاه</Button>
        </div>
        {list === null && <div className="list-loading"><Spinner /></div>}
        {cur && <div className="info-card"><div className="card-title">این دستگاه</div><SessionRow s={cur} /></div>}
        {others.length > 0 && (
          <div className="info-card">
            <Row icon="x" danger title="خاتمه همه نشست‌های دیگر" onClick={async () => { if (!(await confirmDialog({ title: 'خاتمه نشست‌ها', text: 'از همه دستگاه‌های دیگر خارج می‌شوید.', ok: 'خاتمه همه', danger: true }))) return; try { const r = await api('/sessions', { method: 'DELETE' }); toast(`${fa(r.count)} نشست خاتمه یافت.`, 'ok'); load(); } catch (e) { toast(e.message, 'error'); } }} />
            <div className="card-title">نشست‌های فعال</div>
            {others.map((s) => <SessionRow key={s.id} s={s} onKill={() => kill(s)} />)}
          </div>
        )}
      </div>
      {link && <LinkDevice onClose={() => { setLink(false); load(); }} />}
    </div>
  );
}
function SessionRow({ s, onKill }) {
  const mobile = /Android|iPhone|iPad|iOS/i.test(s.device);
  return (
    <div className="row session-row">
      <span className="row-ic filled" style={{ background: mobile ? '#34a853' : '#1a73e8' }}><Icon name={mobile ? 'smartphone' : 'monitor'} /></span>
      <span className="row-body">
        <span className="row-title">{s.device}</span>
        <span className="row-sub"><span dir="ltr">{s.ip}</span> · {s.current ? 'آنلاین' : s.online ? 'آنلاین' : ago(s.last_active)}</span>
        <span className="row-sub">ورود: {fmtDay(s.created_at)}</span>
      </span>
      {onKill && <IconBtn icon="trash" label="خاتمه نشست" className="danger" onClick={onKill} />}
    </div>
  );
}

/** Approve a QR login: scan with camera (BarcodeDetector) or type the short code. */
export function LinkDevice({ onClose, token: initialToken }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState(false);
  const video = useRef(null);
  const streamRef = useRef(null);
  const approve = async (body) => {
    setBusy(true); setErr('');
    try { const r = await api('/auth/qr/approve', { method: 'POST', body }); toast(`دستگاه «${r.device}» متصل شد.`, 'ok'); stop(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCam(false); };
  useEffect(() => () => stop(), []);
  useEffect(() => { if (initialToken) approve({ token: initialToken }); }, [initialToken]); // eslint-disable-line
  const startCam = async () => {
    if (!('BarcodeDetector' in window)) { setErr('مرورگر شما اسکن QR را پشتیبانی نمی‌کند؛ کد کوتاه را وارد کنید.'); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = st; setCam(true);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = st; video.current.play().catch(() => {}); } });
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!streamRef.current) return;
        try {
          const r = await det.detect(video.current);
          const raw = r[0]?.rawValue;
          const m = raw && /#qr\/([A-Za-z0-9_-]+)/.exec(raw);
          if (m) { approve({ token: m[1] }); return; }
        } catch { /* keep scanning */ }
        setTimeout(scan, 300);
      };
      setTimeout(scan, 500);
    } catch { setErr('دسترسی به دوربین داده نشد.'); }
  };
  return (
    <Modal title="اتصال دستگاه" onClose={() => { stop(); onClose(); }}>
      {cam ? (
        <div className="cam-box"><video ref={video} playsInline muted /><span className="cam-frame" /></div>
      ) : (
        <button type="button" className="cam-start" onClick={startCam}><Icon name="camera" /><span>اسکن کد QR با دوربین</span></button>
      )}
      <div className="or-sep"><span>یا</span></div>
      <form onSubmit={(e) => { e.preventDefault(); if (code.replace(/[^A-Z0-9]/gi, '').length >= 8) approve({ code }); else setErr('کد ۸ نویسه‌ای را وارد کنید'); }}>
        <Field label="کد کوتاه (مثلاً ABCD-1234)" value={code} onChange={(v) => { setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9)); setErr(''); }} dir="ltr" error={err} autoComplete="off" />
        <Button type="submit" full loading={busy}>تأیید ورود</Button>
      </form>
      <p className="muted-note">فقط کدی را تأیید کنید که خودتان روی دستگاه خود می‌بینید. هرگز کد را برای دیگران نفرستید.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ appearance */
const THEMES = [
  { id: 'dark', name: 'شب', bg: '#0e1621', bub: '#2b5278', side: '#17212b' },
  { id: 'light', name: 'روز', bg: '#dfe7d5', bub: '#effdde', side: '#ffffff' },
  { id: 'midnight', name: 'نیمه‌شب', bg: '#000000', bub: '#1e3a5f', side: '#0b0b0f' },
  { id: 'system', name: 'سیستم', bg: 'linear-gradient(90deg,#0e1621 50%,#dfe7d5 50%)', bub: '#5eb5f7', side: '#17212b' },
  { id: 'aurora', name: 'شفق', bg: 'linear-gradient(135deg,#1b1340,#0d2a4a)', bub: '#6d4bd8', side: '#1a1535', premium: true },
  { id: 'gold', name: 'طلایی', bg: 'linear-gradient(135deg,#1d1608,#2a1f0a)', bub: '#9a7424', side: '#1f190d', premium: true },
];
const ACCENTS = ['#3390ec', '#8774e1', '#e17076', '#40a7a0', '#eea95b', '#e36cb0', '#54b848', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#06b6d4'];
const WALLS = [['gradient', 'گرادیان'], ['aurora', 'شفق'], ['ocean', 'اقیانوس'], ['sunset', 'غروب'], ['pattern', 'الگو'], ['plain', 'ساده'], ['mesh', 'مش'], ['dots', 'نقطه‌ها']];
function Appearance() {
  const me = useStore((s) => s.me);
  const s = { ...settings(), ...(me.settings || {}) };
  return (
    <div className="side-view">
      <SideHead title="ظاهر و تم" />
      <div className="scroll">
        <div className="info-card">
          <div className="card-title">تم</div>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={cx('theme-card', s.theme === t.id && 'on')} onClick={() => { if (t.premium && !me.premium) { toast('این تم مخصوص کاربران پریمیوم است.', 'error'); return; } setSetting('theme', t.id); }}>
                <span className="tc-prev" style={{ background: t.bg }}>
                  <span className="tc-b in" style={{ background: t.side }} /><span className="tc-b out" style={{ background: t.bub }} />
                </span>
                <span className="tc-name">{t.name}{t.premium && <PremiumStar size={13} />}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="info-card">
          <div className="card-title">رنگ اصلی</div>
          <div className="accent-row">
            {ACCENTS.map((a) => <button key={a} type="button" className={cx('accent-dot', s.accent === a && 'on')} style={{ background: a }} onClick={() => setSetting('accent', a)} aria-label={`رنگ ${a}`}>{s.accent === a && <Icon name="check" />}</button>)}
          </div>
        </div>
        <div className="info-card">
          <div className="card-title">پس‌زمینه گفتگو</div>
          <div className="wall-grid">
            {WALLS.map(([id, n]) => <button key={id} type="button" className={cx('wall-card', s.wallpaper === id && 'on')} onClick={() => setSetting('wallpaper', id)}><span className={cx('wall-prev', `wp-${id}`)}><span className="wp-dots" /></span><span className="tc-name">{n}</span></button>)}
          </div>
        </div>
        <div className="info-card">
          <div className="card-title">سبک حباب‌ها</div>
          <div className="wall-grid">
            {[['classic', 'کلاسیک'], ['glass', 'شیشه‌ای'], ['minimal', 'مینیمال'], ['rounded', 'گرد']].map(([id, n]) => <button key={id} type="button" className={cx('wall-card', s.bubbleStyle === id && 'on')} onClick={() => setSetting('bubbleStyle', id)}><span className={cx('wall-prev', `bs-${id}`)}><span className="wp-dots" /></span><span className="tc-name">{n}</span></button>)}
          </div>
        </div>
        <div className="info-card">
          <div className="card-title">عرض گفتگو</div>
          <div className="wall-grid">
            {[['compact', 'فشرده'], ['normal', 'معمولی'], ['wide', 'عریض']].map(([id, n]) => <button key={id} type="button" className={cx('wall-card', s.chatWidth === id && 'on')} onClick={() => setSetting('chatWidth', id)}><span className={cx('wall-prev', `cw-${id}`)}><span className="wp-dots" /></span><span className="tc-name">{n}</span></button>)}
          </div>
        </div>
        <div className="info-card">
          <div className="card-title">متن و حباب‌ها</div>
          <Slider label="اندازه متن" min={13} max={20} value={s.fontSize} onChange={(v) => setSetting('fontSize', v)} fmt={(v) => `${fa(v)}px`} />
          <Slider label="گردی گوشه حباب‌ها" min={6} max={22} value={s.radius} onChange={(v) => setSetting('radius', v)} fmt={(v) => `${fa(v)}px`} />
          <Slider label="عرض حداکثر حباب" min={400} max={1200} step={20} value={s.bubbleMaxWidth} onChange={(v) => setSetting('bubbleMaxWidth', v)} fmt={(v) => `${fa(v)}px`} />
          <Slider label="شفافیت پس‌زمینه" min={0} max={100} value={s.wallpaperIntensity} onChange={(v) => setSetting('wallpaperIntensity', v)} fmt={(v) => `${fa(v)}٪`} />
          <div className="preview-bubbles">
            <div className="msg in first last"><div className="bubble"><div className="b-text">سلام، GuardNet چطوره؟<span className="meta-space" /></div><span className="b-meta"><span>۱۲:۳۰</span></span></div></div>
            <div className="msg out first last"><div className="bubble"><div className="b-text">عالیه، سریع و امن<span className="meta-space out" /></div><span className="b-meta"><span>۱۲:۳۱</span><Icon name="checks" className="m-check read" /></span></div></div>
          </div>
        </div>
        <div className="info-card">
          <div className="card-title">رفتار چت</div>
          <Row icon="layers" title="جلوه شیشه‌ای (Blur)" right={<Toggle checked={s.blur} onChange={(v) => setSetting('blur', v)} label="شیشه‌ای" />} />
          <Row icon="activity" title="انیمیشن‌ها و حرکت" right={<Toggle checked={s.motion} onChange={(v) => setSetting('motion', v)} label="انیمیشن" />} />
          <Row icon="smile" title="ایموجی‌های بزرگ" right={<Toggle checked={s.bigEmoji} onChange={(v) => setSetting('bigEmoji', v)} label="ایموجی بزرگ" />} />
          <Row icon="send" title="ارسال با Enter" sub={s.sendEnter ? 'Shift+Enter برای خط جدید' : 'Ctrl+Enter برای ارسال'} right={<Toggle checked={s.sendEnter} onChange={(v) => setSetting('sendEnter', v)} label="ارسال با Enter" />} />
          <Row icon="menu" title="فهرست فشرده گفتگوها" right={<Toggle checked={s.chatList === 'compact'} onChange={(v) => setSetting('chatList', v ? 'compact' : 'comfortable')} label="فهرست فشرده" />} />
          <Row icon="image" title="نمایش آواتار در گروه‌ها" right={<Toggle checked={s.showAvatars} onChange={(v) => setSetting('showAvatars', v)} label="آواتار" />} />
          <Row icon="user" title="نمایش نام فرستنده در گروه" right={<Toggle checked={s.showNames} onChange={(v) => setSetting('showNames', v)} label="نام فرستنده" />} />
          <Row icon="link" title="پیش‌نمایش لینک" right={<Toggle checked={s.linkPreview} onChange={(v) => setSetting('linkPreview', v)} label="پیش‌نمایش" />} />
          <Row icon="type" title="نمایش «در حال تایپ...»" right={<Toggle checked={s.typingIndicator} onChange={(v) => setSetting('typingIndicator', v)} label="در حال تایپ" />} />
          <Row icon="circle" title="نمایش وضعیت آنلاین" right={<Toggle checked={s.showOnlineStatus} onChange={(v) => setSetting('showOnlineStatus', v)} label="آنلاین" />} />
          <Row icon="trash" title="تأیید قبل از حذف پیام" right={<Toggle checked={s.confirmDelete} onChange={(v) => setSetting('confirmDelete', v)} label="تأیید حذف" />} />
        </div>
      </div>
    </div>
  );
}
function Slider({ label, min, max, step = 1, value, onChange, fmt }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const pct = ((v - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <div className="sl-head"><span>{label}</span><span className="sl-val">{fmt(v)}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(+e.target.value)} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} onBlur={() => v !== value && onChange(v)}
        style={{ '--p': `${pct}%` }} aria-label={label} dir="ltr" />
    </div>
  );
}

function Notifications() {
  const me = useStore((s) => s.me);
  const s = { ...settings(), ...(me.settings || {}) };
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const ask = async () => { if (typeof Notification === 'undefined') return; const p = await Notification.requestPermission(); setPerm(p); if (p === 'granted') toast('اعلان‌های مرورگر فعال شد.', 'ok'); };
  return (
    <div className="side-view">
      <SideHead title="اعلان‌ها و صداها" />
      <div className="scroll">
        <div className="info-card">
          <div className="card-title">اعلان‌ها</div>
          <Row icon="bell" title="اعلان پیام‌ها" right={<Toggle checked={s.notify} onChange={(v) => { setSetting('notify', v); if (v && perm === 'default') ask(); }} label="اعلان‌ها" />} />
          <Row icon="eye" title="پیش‌نمایش متن در اعلان" sub="نمایش متن پیام در اعلان دسکتاپ" right={<Toggle checked={s.preview} onChange={(v) => setSetting('preview', v)} label="پیش‌نمایش" />} />
          {perm !== 'granted' && perm !== 'unsupported' && <Row icon="monitor" title="اعلان‌های دسکتاپ" sub={perm === 'denied' ? 'در تنظیمات مرورگر مسدود است' : 'اجازه نمایش اعلان را بدهید'} onClick={perm === 'default' ? ask : undefined} chevron={perm === 'default'} />}
        </div>
        <div className="info-card">
          <div className="card-title">صدا</div>
          <Row icon="volume" title="صدای پیام‌ها" sub="پخش صدا هنگام دریافت پیام جدید" right={<Toggle checked={s.sound} onChange={(v) => setSetting('sound', v)} label="صدای پیام" />} />
          <Row icon="music" title="صدای پیام درون برنامه" sub="پخش صدا هنگام باز بودن برنامه" right={<Toggle checked={s.messageSound} onChange={(v) => setSetting('messageSound', v)} label="صدا در برنامه" />} />
        </div>
        <div className="info-card">
          <div className="card-title">حریم خصوصی اعلان</div>
          <Row icon="circle" title="نمایش وضعیت آنلاین" sub="به دیگران نشان داده شود" right={<Toggle checked={s.showOnlineStatus} onChange={(v) => setSetting('showOnlineStatus', v)} label="آنلاین" />} />
          <Row icon="checks" title="رسید خواندن" sub="اگر خاموش باشد، رسید خواندن دیگران را هم نمی‌بینید" right={<Toggle checked={s.readReceipts} onChange={(v) => setSetting('readReceipts', v)} label="رسید خواندن" />} />
          <Row icon="type" title="نمایش «در حال تایپ...»" sub="به دیگران نشان داده شود" right={<Toggle checked={s.typingIndicator} onChange={(v) => setSetting('typingIndicator', v)} label="در حال تایپ" />} />
        </div>
        <div className="info-card">
          <div className="card-title">واکنش سریع (دوبار کلیک روی پیام)</div>
          <div className="es-grid">{['👍', '❤️', '🔥', '😂', '🙏', '👏', '🎉', '💯', '😮', '😢', '👎', '🤩'].map((e) => <button key={e} type="button" className={cx(s.quickReaction === e && 'on')} onClick={() => setSetting('quickReaction', e)}>{e}</button>)}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ folders */
const PRESETS = [
  { name: 'خوانده‌نشده', emoji: '🔵', include: ['unread'] },
  { name: 'شخصی', emoji: '👤', include: ['private'] },
  { name: 'گروه‌ها', emoji: '👥', include: ['group'] },
  { name: 'کانال‌ها', emoji: '📢', include: ['channel'] },
  { name: 'ربات‌ها', emoji: '🤖', include: ['bot'] },
];
function Folders() {
  const me = useStore((s) => s.me);
  const folders = me.settings?.folders || [];
  const [edit, setEdit] = useState(null);
  const lim = me.limits?.folders || 5;
  const save = (list) => setSetting('folders', list);
  const add = (f) => { if (folders.length >= lim) { toast(`حداکثر ${fa(lim)} پوشه مجاز است.${me.premium ? '' : ' با پریمیوم تا ۳۰.'}`, 'error'); return; } save([...folders, { id: `f${Date.now().toString(36)}`, chats: [], ...f }]); };
  const move = (i, d) => { const l = folders.slice(); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; save(l); };
  return (
    <div className="side-view">
      <SideHead title="پوشه‌های گفتگو" />
      <div className="scroll">
        <div className="link-hero"><span className="lh-ic"><Icon name="folder" /></span><div className="lh-text">گفتگوها را در پوشه‌ها مرتب کنید تا سریع‌تر پیدا شوند. پوشه‌ها بالای فهرست گفتگوها نمایش داده می‌شوند.</div></div>
        <div className="info-card">
          <div className="card-title">پوشه‌های من ({fa(folders.length)} از {fa(lim)})</div>
          {folders.map((f, i) => (
            <div key={f.id} className="row">
              <span className="row-ic emoji">{f.emoji || '📁'}</span>
              <span className="row-body clickable" onClick={() => setEdit(f)}><span className="row-title">{f.name}</span><span className="row-sub">{folderDesc(f)}</span></span>
              <IconBtn icon="chevUp" label="بالا" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconBtn icon="trash" label="حذف" className="danger" onClick={async () => { if (await confirmDialog({ title: 'حذف پوشه', text: `پوشه «${f.name}» حذف شود؟ گفتگوها حذف نمی‌شوند.`, ok: 'حذف', danger: true })) { save(folders.filter((x) => x.id !== f.id)); if (getState().folder === f.id) setState({ folder: 'all' }); } }} />
            </div>
          ))}
          <Row icon="plus" title="ساخت پوشه جدید" onClick={() => setEdit({ id: null, name: '', emoji: '📁', include: [], chats: [] })} className="accent-row-btn" />
        </div>
        <div className="info-card">
          <div className="card-title">پیشنهادها</div>
          {PRESETS.filter((p) => !folders.some((f) => f.name === p.name)).map((p) => (
            <div key={p.name} className="row">
              <span className="row-ic emoji">{p.emoji}</span>
              <span className="row-body"><span className="row-title">{p.name}</span></span>
              <button type="button" className="btn btn-primary sm" onClick={() => add(p)}>افزودن</button>
            </div>
          ))}
        </div>
      </div>
      {edit && <FolderEdit f={edit} onClose={() => setEdit(null)} onSave={(f) => { if (f.id) save(folders.map((x) => (x.id === f.id ? f : x))); else add({ ...f, id: undefined }); setEdit(null); }} />}
    </div>
  );
}
const folderDesc = (f) => {
  const m = { unread: 'خوانده‌نشده', private: 'شخصی', group: 'گروه‌ها', channel: 'کانال‌ها', bot: 'ربات‌ها' };
  const parts = (f.include || []).map((x) => m[x]);
  if (f.chats?.length) parts.push(`${fa(f.chats.length)} گفتگو`);
  return parts.join('، ') || 'خالی';
};
function FolderEdit({ f, onClose, onSave }) {
  const [name, setName] = useState(f.name); const [emoji, setEmoji] = useState(f.emoji || '📁');
  const [inc, setInc] = useState(f.include || []); const [chats, setChats] = useState(f.chats || []);
  const all = sortedChats(getState().chats);
  const tog = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const EMO = ['📁', '💼', '🏠', '❤️', '⭐', '🎮', '📚', '💬', '🔔', '🎓', '✈️', '💰'];
  return (
    <Modal title={f.id ? 'ویرایش پوشه' : 'پوشه جدید'} onClose={onClose} footer={<><button type="button" className="btn btn-text" onClick={onClose}>انصراف</button><button type="button" className="btn btn-text primary" disabled={!name.trim() || (!inc.length && !chats.length)} onClick={() => onSave({ ...f, name: name.trim().slice(0, 20), emoji, include: inc, chats })}>ذخیره</button></>}>
      <Field label="نام پوشه" value={name} onChange={setName} maxLength={20} autoFocus />
      <div className="es-grid sm">{EMO.map((e) => <button key={e} type="button" className={cx(emoji === e && 'on')} onClick={() => setEmoji(e)}>{e}</button>)}</div>
      <div className="sec-title">انواع گفتگو</div>
      {[['private', 'شخصی', 'user'], ['group', 'گروه‌ها', 'users'], ['channel', 'کانال‌ها', 'megaphone'], ['bot', 'ربات‌ها', 'bot'], ['unread', 'فقط خوانده‌نشده', 'eye']].map(([k, l, ic]) => (
        <div key={k} className="row clickable" onClick={() => tog(inc, setInc, k)}><span className="row-ic"><Icon name={ic} /></span><span className="row-body"><span className="row-title">{l}</span></span><Check checked={inc.includes(k)} /></div>
      ))}
      <div className="sec-title">گفتگوهای انتخابی</div>
      <div className="folder-chats">
        {all.map((c) => (
          <div key={c.id} className="row clickable" onClick={() => tog(chats, setChats, c.id)}>
            <Avatar {...chatAvatarProps(c)} size={34} /><span className="row-body"><span className="row-title">{chatTitle(c)}</span></span><Check checked={chats.includes(c.id)} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ premium */
function Premium() {
  const me = useStore((s) => s.me);
  const feats = [
    ['upload', 'آپلود تا ۵۰۰ مگابایت', 'به‌جای ۲۰ مگابایت برای هر فایل'],
    ['pin', 'سنجاق ۵۰ گفتگو', 'به‌جای ۵ گفتگو'],
    ['folder', '۳۰ پوشه گفتگو', 'به‌جای ۵ پوشه'],
    ['info', 'بیوگرافی ۵۰۰ نویسه‌ای', 'به‌جای ۷۰ نویسه'],
    ['sparkles', 'وضعیت ایموجی', 'ایموجی دلخواه کنار نام شما'],
    ['sticker', 'استیکرهای ویژه', '۱۲ استیکر انحصاری'],
    ['palette', '۶ تم ویژه', 'کریستال، نئون، سایبر، اقیانوس، شفق، طلایی'],
    ['story', 'استوری ۷۲ ساعته', 'و حالت مخفی مشاهده'],
    ['shield', 'حالت مخفی استوری', 'استوری‌ها را بدون ثبت بازدید ببینید'],
    ['ghost', 'پروفایل ناشناس', 'مخفی کردن آخرین بازدید و آنلاین بودن'],
    ['crown', 'نشان پریمیوم', 'نشان ستاره کنار نام و آواتار'],
    ['zap', 'اولویت در صف', 'ارسال سریع‌تر پیام‌ها و فایل‌ها'],
    ['star', 'حلقه درخشان آواتار', 'افکت گرافیکی دور آواتار'],
    ['gift', 'استیکرها و ری‌اکشن‌های ویژه', 'پک‌های انحصاری ری‌اکشن و استیکر'],
    ['lock', 'قفل پیشرفته برنامه', 'رمز محلی با الگوریتم پیشرفته'],
    ['cloud', 'پشتیبان‌گیری خودکار', 'ذخیره خودکار تنظیمات و گفتگوها'],
    ['palette', 'پس‌زمینه‌های انیمیشنی', 'والپیپرهای متحرک و زنده'],
    ['sliders', 'سبک حباب‌های ویژه', 'حباب‌های کریستال و نئون'],
    ['messageCircle', 'پاسخ خودکار', 'پاسخ خودکار هنگام عدم آنلاین بودن'],
    ['archive', 'آرشیو نامحدود', 'آرشیو نامحدود گفتگوهای قدیمی'],
    ['users', 'گروه‌های بزرگ‌تر', 'تا ۵۰۰۰ عضو در گروه‌ها'],
    ['star', 'اموجی‌های متحرک', 'ایموجی‌های انیمیشنی اختصاصی'],
  ];
  const cancel = async () => { if (!(await confirmDialog({ title: 'لغو پریمیوم', text: 'امکانات پریمیوم فوراً غیرفعال می‌شوند.', ok: 'لغو پریمیوم', danger: true }))) return; try { const m = await api('/premium/cancel', { method: 'POST', body: {} }); setState({ me: m }); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="side-view">
      <SideHead title="GuardNet پریمیوم" />
      <div className="scroll">
        <div className="prem-hero">
          <div className="prem-orb"><PremiumStar size={84} /></div>
          <div className="ph-name">GuardNet پریمیوم</div>
          <div className="ph-status">{me.premium ? `فعال تا ${fmtDay(me.premium_until)}` : 'امکانات بیشتر، محدودیت‌های کمتر'}</div>
        </div>
        <div className="info-card">
          <div className="card-title">امکانات پریمیوم</div>
          {feats.map(([ic, t, s], i) => (
            <div key={t} className="row"><span className="row-ic filled" style={{ background: `hsl(${260 - i * 16} 80% 62%)` }}><Icon name={ic} /></span><span className="row-body"><span className="row-title">{t}</span><span className="row-sub">{s}</span></span><span className="row-chev"><PremiumStar size={14} /></span></div>
          ))}
        </div>
        {me.premium && <div className="pad"><Button kind="ghost" full onClick={cancel}>لغو اشتراک</Button></div>}
      </div>
    </div>
  );
}
export { promptDialog };
