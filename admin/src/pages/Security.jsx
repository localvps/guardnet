import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, useLiveRefresh } from '../live.js';
import { Card, Icon, Spinner, Button, IconBtn, Field, Toggle, Badge, Empty, Pager, Select, toast, confirmDialog, fa, fmtNum, fmtDate, ago, cx } from '../ui.jsx';
import { useDebounced } from './Users.jsx';

const NUMS = [
  ['password_min', 'حداقل طول رمز کاربران', 6, 64, 'نویسه'],
  ['user_max_fails', 'تلاش ناموفق مجاز کاربر', 3, 50, 'بار'],
  ['user_lock_minutes', 'مدت قفل حساب کاربر', 1, 1440, 'دقیقه'],
  ['admin_max_fails', 'تلاش ناموفق مجاز مدیر', 3, 20, 'بار'],
  ['admin_lock_minutes', 'مدت قفل حساب مدیر', 5, 1440, 'دقیقه'],
  ['admin_idle_minutes', 'خروج خودکار مدیر پس از عدم فعالیت', 5, 120, 'دقیقه'],
  ['admin_absolute_hours', 'حداکثر عمر نشست مدیر', 1, 24, 'ساعت'],
  ['max_sessions_per_user', 'حداکثر نشست هم‌زمان هر کاربر', 1, 200, 'نشست'],
  ['message_rate_per_min', 'سقف ارسال پیام در دقیقه', 5, 600, 'پیام'],
];
const REASON_OK = { password: 'رمز صحیح', totp: 'کد ۲FA', recovery: 'کد بازیابی', register: 'ثبت‌نام', qr: 'ورود با QR', resume: 'ادامه نشست' };
const REASON_FA = { register: 'ثبت‌نام', password: 'رمز نادرست', totp: 'کد ۲FA نادرست', locked: 'حساب قفل', ip_denied: 'IP غیرمجاز', disabled: 'حساب غیرفعال', banned: 'کاربر مسدود', recovery: 'کد بازیابی', qr: 'ورود با QR', resume: 'ادامه نشست', unknown: 'کاربر ناموجود' };

export default function Security({ admin }) {
  const [d, setD] = useState(null); const [form, setForm] = useState(null); const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [ip, setIp] = useState(''); const [hours, setHours] = useState('24'); const [reason, setReason] = useState(''); const [blocking, setBlocking] = useState(false);
  const sup = can(admin, 'superadmin');
  const load = () => api('/security').then((r) => { setD(r); setForm((f) => f || { ...r.settings }); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useLiveRefresh(['audit'], (ev, e) => { if (e?.action?.startsWith('security.')) load(); }, 300);
  if (err) return <div className="alert error"><Icon name="alert" /><span>{err}</span></div>;
  if (!d || !form) return <div className="center"><Spinner size={30} /></div>;
  const changed = Object.keys(form).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(d.settings[k]));
  const set = (k, v) => setForm({ ...form, [k]: v });
  const save = async () => {
    const patch = Object.fromEntries(changed.map((k) => [k, form[k]]));
    for (const [k, , min, max] of NUMS) if (k in patch && (!Number.isInteger(patch[k]) || patch[k] < min || patch[k] > max)) { toast(`مقدار «${NUMS.find((n) => n[0] === k)[1]}» باید بین ${fa(min)} و ${fa(max)} باشد.`, 'error'); return; }
    if ('admin_ip_allowlist' in patch && patch.admin_ip_allowlist.trim() && !(await confirmDialog({ title: 'محدودیت IP پنل', text: 'اگر IP فعلی شما در فهرست نباشد، دسترسی خودتان هم قطع می‌شود. مطمئن هستید؟', ok: 'ذخیره', danger: true }))) return;
    setSaving(true);
    try { const r = await api('/security', { method: 'PATCH', body: patch }); setD({ ...d, settings: r.settings }); setForm({ ...r.settings }); toast('تنظیمات امنیتی ذخیره شد.', 'ok'); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const block = async (target = ip, h = hours, why = reason) => {
    if (!/^[0-9a-fA-F:.]{3,45}$/.test(target.trim())) { toast('IP نامعتبر است.', 'error'); return; }
    setBlocking(true);
    try { await api('/security/ip-blocks', { method: 'POST', body: { ip: target.trim(), hours: Number.parseInt(h, 10) || 0, reason: why } }); toast(`IP ${target} مسدود شد.`, 'ok'); setIp(''); setReason(''); load(); } catch (e) { toast(e.message, 'error'); } finally { setBlocking(false); }
  };
  return (
    <div className="page">
      <div className="grid-2">
        <Card title="سیاست‌های امنیتی" icon="shield" actions={sup && changed.length > 0 && <Badge tone="gold">{fa(changed.length)} تغییر ذخیره‌نشده</Badge>}>
          {!sup && <div className="alert info"><Icon name="info" /><span>فقط مدیر ارشد می‌تواند این تنظیمات را تغییر دهد.</span></div>}
          <div className="row-line"><div><b>ثبت‌نام کاربران جدید</b><span className="muted">در صورت خاموش بودن، فقط کاربران فعلی می‌توانند وارد شوند.</span></div><Toggle checked={form.registration_open} onChange={(v) => set('registration_open', v)} disabled={!sup} label="ثبت‌نام" /></div>
          <div className="row-line"><div><b>رمز ترکیبی برای کاربران</b><span className="muted">الزام حرف و عدد در رمز کاربران</span></div><Toggle checked={form.password_require_mix} onChange={(v) => set('password_require_mix', v)} disabled={!sup} label="رمز ترکیبی" /></div>
          <div className="num-grid">
            {NUMS.map(([k, l, min, max, unit]) => (
              <Field key={k} label={l} type="number" dir="ltr" value={String(form[k])} min={min} max={max} disabled={!sup}
                onChange={(v) => set(k, v === '' ? '' : Number.parseInt(v, 10))} hint={`${fa(min)} تا ${fa(max)} ${unit}`} error={form[k] !== '' && (form[k] < min || form[k] > max) ? `بین ${fa(min)} و ${fa(max)}` : ''} />
            ))}
          </div>
          <Field label="IPهای مجاز پنل مدیریت (خالی = همه)" textarea rows={3} dir="ltr" value={form.admin_ip_allowlist} onChange={(v) => set('admin_ip_allowlist', v)} disabled={!sup} placeholder="203.0.113.7, 198.51.100.0/24" hint="با کاما یا فاصله جدا کنید؛ CIDR پشتیبانی می‌شود." />
          {sup && <div className="actions end"><Button kind="ghost" disabled={!changed.length || saving} onClick={() => setForm({ ...d.settings })}>بازگردانی</Button><Button icon="check" loading={saving} disabled={!changed.length} onClick={save}>ذخیره تغییرات</Button></div>}
        </Card>
        <div className="stack">
          <Card title="رمزنگاری و حفاظت داده" icon="lock">
            <dl className="kv one">
              <div><dt>رمز عبور کاربران و مدیران</dt><dd dir="ltr">{d.encryption.passwords}</dd></div>
              <div><dt>رازهای ۲FA و توکن‌ها در پایگاه داده</dt><dd dir="ltr">{d.encryption.at_rest}</dd></div>
              <div><dt>توکن نشست‌ها</dt><dd dir="ltr">{d.encryption.tokens}</dd></div>
              <div><dt>گزارش ممیزی</dt><dd>زنجیره هش SHA-256 (ضد دست‌کاری)</dd></div>
            </dl>
          </Card>
          <Card title="IPهای پرتلاش ناموفق (۲۴ ساعت)" icon="alert" pad={false}>
            {!d.top_failed_ips.length ? <p className="muted pad">تلاش ناموفقی ثبت نشده است.</p> : (
              <ul className="list pad-x">{d.top_failed_ips.map((r) => (
                <li key={r.ip}><span className="f-ic red"><Icon name="globe" /></span><div><b dir="ltr">{r.ip}</b><span>{fa(r.n)} تلاش · آخرین {ago(r.last)}</span></div>
                  {sup && !d.ip_blocks.some((b) => b.ip === r.ip) && <Button kind="danger-soft" size="sm" icon="ban" onClick={() => block(r.ip, 24, 'تلاش‌های ناموفق زیاد')}>مسدود ۲۴ساعته</Button>}
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>
      <Card title={`IPهای مسدود (${fa(d.ip_blocks.length)})`} icon="ban">
        {sup && (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); block(); }}>
            <Field label="IP" value={ip} onChange={setIp} dir="ltr" placeholder="203.0.113.7" maxLength={45} />
            <Select value={hours} onChange={setHours} label="مدت" options={[['1', '۱ ساعت'], ['24', '۲۴ ساعت'], ['168', '۷ روز'], ['720', '۳۰ روز'], ['0', 'دائمی']]} />
            <Field label="دلیل" value={reason} onChange={setReason} maxLength={200} />
            <Button type="submit" icon="ban" loading={blocking} kind="danger">مسدود کن</Button>
          </form>
        )}
        {!d.ip_blocks.length ? <Empty icon="shield" title="IP مسدودی وجود ندارد" /> : (
          <ul className="list">{d.ip_blocks.map((b) => (
            <li key={b.ip}><span className="f-ic red"><Icon name="ban" /></span><div><b dir="ltr">{b.ip}</b><span>{b.reason || 'بدون دلیل'} · {b.expires_at ? `تا ${fmtDate(b.expires_at)}` : 'دائمی'} · توسط <span dir="ltr">{b.by_name || 'system'}</span></span></div>
              {sup && <IconBtn icon="trash" label="رفع مسدودی" className="danger" onClick={async () => { try { await api(`/security/ip-blocks/${encodeURIComponent(b.ip)}`, { method: 'DELETE' }); toast('رفع مسدودی شد.', 'ok'); load(); } catch (e) { toast(e.message, 'error'); } }} />}
            </li>
          ))}</ul>
        )}
      </Card>
      <LoginAttempts />
    </div>
  );
}

function LoginAttempts() {
  const [scope, setScope] = useState(''); const [ok, setOk] = useState(''); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [page, setPage] = useState(1); const [data, setData] = useState(null);
  const load = () => api(`/login-attempts?scope=${scope}&ok=${ok}&q=${encodeURIComponent(dq)}&page=${page}`).then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, [scope, ok, dq, page]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [scope, ok, dq]);
  useLiveRefresh(['tick:login', 'security'], () => { if (page === 1) load(); }, 800);
  return (
    <Card title="تلاش‌های ورود" icon="key" pad={false}>
      <div className="toolbar in-card">
        <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام کاربری یا IP" aria-label="جستجو" /></label>
        <Select value={scope} onChange={setScope} label="حوزه" options={[['', 'همه'], ['user', 'کاربران'], ['admin', 'مدیران']]} />
        <Select value={ok} onChange={setOk} label="نتیجه" options={[['', 'همه نتایج'], ['1', 'موفق'], ['0', 'ناموفق']]} />
      </div>
      {!data ? <div className="center"><Spinner /></div> : !data.items.length ? <Empty icon="key" title="موردی یافت نشد" /> : (
        <table className="table">
          <thead><tr><th>نتیجه</th><th>نام کاربری</th><th>حوزه</th><th>IP</th><th>زمان</th></tr></thead>
          <tbody>{data.items.map((l) => (
            <tr key={l.id}>
              <td data-label="نتیجه"><Badge tone={l.ok ? 'green' : 'red'} icon={l.ok ? 'check' : 'x'}>{l.ok ? 'موفق' : 'ناموفق'} · {(l.ok ? REASON_OK[l.reason] : REASON_FA[l.reason]) || l.reason}</Badge></td>
              <td data-label="نام کاربری"><span dir="ltr">{l.username || '—'}</span></td>
              <td data-label="حوزه">{l.scope === 'admin' ? 'مدیر' : 'کاربر'}</td>
              <td data-label="IP"><span dir="ltr">{l.ip}</span></td>
              <td data-label="زمان">{fmtDate(l.at)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data && <div className="card-foot"><span className="muted">{fmtNum(data.total)} مورد</span><Pager page={data.page} size={data.size} total={data.total} onPage={setPage} /></div>}
    </Card>
  );
}
export { cx };
