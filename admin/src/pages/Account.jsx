import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Icon, Spinner, Button, IconBtn, PasswordField, Badge, SecretBox, toast, confirmDialog, fa, fmtDate, ago, cx, pwChecks, PwChecklist } from '../ui.jsx';

export default function Account({ admin, setAdmin, session }) {
  const [old, setOld] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState(''); const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState(null); const [codes, setCodes] = useState(null);
  const loadS = () => api('/auth/sessions').then(setSessions).catch((e) => toast(e.message, 'error'));
  useEffect(() => { loadS(); }, []);
  const valid = pwChecks(a, admin.username).every(([ok]) => ok) && a === b && old;
  const change = async (e) => {
    e.preventDefault(); if (!valid) return;
    setBusy(true);
    try { const r = await api('/auth/password', { method: 'POST', body: { old, new: a } }); setAdmin(r.admin); setOld(''); setA(''); setB(''); toast('رمز تغییر کرد؛ سایر نشست‌ها بسته شدند.', 'ok'); loadS(); } catch (e2) { toast(e2.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <div className="grid-2">
        <Card title="حساب مدیریت" icon="user">
          <dl className="kv one">
            <div><dt>نام کاربری</dt><dd dir="ltr">{admin.username}</dd></div>
            <div><dt>نقش</dt><dd>{admin.role_fa}</dd></div>
            <div><dt>تأیید دو مرحله‌ای</dt><dd>{admin.totp_on ? <Badge tone="green" icon="lock">فعال</Badge> : <Badge tone="red">غیرفعال</Badge>}</dd></div>
            <div><dt>آخرین تغییر رمز</dt><dd>{admin.pw_changed_at ? fmtDate(admin.pw_changed_at) : '—'}</dd></div>
            <div><dt>انقضای نشست فعلی</dt><dd>{session?.expires_at ? fmtDate(session.expires_at) : '—'}</dd></div>
            <div><dt>خروج خودکار پس از</dt><dd>{fa(session?.idle_minutes || 15)} دقیقه عدم فعالیت</dd></div>
          </dl>
        </Card>
        <Card title="تغییر رمز عبور" icon="key">
          <form onSubmit={change} noValidate>
            <PasswordField label="رمز فعلی" value={old} onChange={setOld} autoComplete="current-password" />
            <PasswordField label="رمز جدید" value={a} onChange={setA} autoComplete="new-password" />
            <PwChecklist pw={a} username={admin.username} />
            <PasswordField label="تکرار رمز جدید" value={b} onChange={setB} autoComplete="new-password" error={b && a !== b ? 'تکرار رمز یکسان نیست' : ''} />
            <Button type="submit" loading={busy} disabled={!valid} className="full">تغییر رمز</Button>
          </form>
        </Card>
      </div>
      <div className="grid-2">
        <Card title="نشست‌های مدیریت" icon="monitor" pad={false}>
          {!sessions ? <div className="center sm"><Spinner /></div> : (
            <ul className="list pad-x">{sessions.map((s) => (
              <li key={s.id}>
                <span className={cx('f-ic', s.current ? 'green' : 'muted')}><Icon name={/Android|iPhone|iPad/i.test(s.device) ? 'smartphone' : 'monitor'} /></span>
                <div><b>{s.device}{s.current ? ' · همین دستگاه' : ''}</b><span><span dir="ltr">{s.ip}</span> · {ago(s.last_active || s.created_at)}</span></div>
                {!s.current && <IconBtn icon="trash" label="خاتمه نشست" className="danger" onClick={async () => { try { await api(`/auth/sessions/${s.id}`, { method: 'DELETE' }); toast('نشست بسته شد.', 'ok'); loadS(); } catch (e) { toast(e.message, 'error'); } }} />}
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="کدهای بازیابی" icon="scroll">
          <p className="muted">اگر به برنامه احراز هویت دسترسی نداشته باشید، با یکی از کدهای بازیابی وارد می‌شوید. ساخت کدهای جدید، کدهای قبلی را باطل می‌کند.</p>
          {codes && <><div className="codes-grid" dir="ltr">{codes.map((c) => <code key={c}>{c}</code>)}</div><SecretBox value={codes.join('\n')} label="کپی همه کدها" /></>}
          <Button kind="ghost" icon="refresh" onClick={async () => { if (!(await confirmDialog({ title: 'ساخت کدهای جدید', text: 'کدهای قبلی دیگر کار نمی‌کنند.', ok: 'ساخت' }))) return; try { const r = await api('/auth/recovery/regenerate', { method: 'POST', body: {} }); setCodes(r.recovery_codes); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } }}>ساخت کدهای بازیابی جدید</Button>
        </Card>
      </div>
    </div>
  );
}
