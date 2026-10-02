import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Icon, Spinner, Button, IconBtn, Field, Select, Badge, Modal, SecretBox, toast, confirmDialog, fmtDate, ago, cx } from '../ui.jsx';

const ROLES = [['viewer', 'ناظر (فقط مشاهده)'], ['moderator', 'ناظر محتوا'], ['superadmin', 'مدیر ارشد']];

export default function Admins({ admin }) {
  const [list, setList] = useState(null); const [creating, setCreating] = useState(false); const [secret, setSecret] = useState(null);
  const load = () => api('/admins').then(setList).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  const patch = async (a, body, msg) => { try { await api(`/admins/${a.id}`, { method: 'PATCH', body }); toast(msg, 'ok'); load(); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } };
  return (
    <div className="page">
      <div className="toolbar end"><Button icon="userPlus" onClick={() => setCreating(true)}>افزودن مدیر</Button></div>
      <div className="alert info"><Icon name="info" /><span>هر مدیر جدید با رمز تصادفی ۲۰ نویسه‌ای ساخته می‌شود و در اولین ورود باید رمز را تغییر دهد و تأیید دو مرحله‌ای را فعال کند.</span></div>
      {secret && <Card title={`اطلاعات ورود ${secret.username}`} icon="key"><p className="muted">این رمز فقط همین یک بار نمایش داده می‌شود؛ آن را از راه امن به مدیر تحویل دهید.</p><SecretBox value={secret.password} label="رمز موقت" /><Button kind="ghost" onClick={() => setSecret(null)}>بستن</Button></Card>}
      {!list ? <div className="center"><Spinner /></div> : (
        <div className="admin-grid">
          {list.map((a) => {
            const me = a.id === admin.id;
            return (
              <Card key={a.id} className={cx('admin-card', a.disabled && 'off')}>
                <div className="rp-head">
                  <span className={cx('f-ic', a.role === 'superadmin' ? 'violet' : a.role === 'moderator' ? 'blue' : 'muted')}><Icon name={a.role === 'superadmin' ? 'crown' : 'shield'} /></span>
                  <div><b dir="ltr">{a.username}</b><span>{a.role_fa}{me ? ' · شما' : ''}</span></div>
                </div>
                <div className="chips">
                  {a.totp_on ? <Badge tone="green" icon="lock">۲FA فعال</Badge> : <Badge tone="gold">۲FA فعال نشده</Badge>}
                  {a.must_change && <Badge tone="gold">نیازمند تغییر رمز</Badge>}
                  {a.disabled && <Badge tone="red">غیرفعال</Badge>}
                  {a.locked && <Badge tone="red" icon="lock">قفل موقت</Badge>}
                </div>
                <dl className="kv one">
                  <div><dt>آخرین ورود</dt><dd>{a.last_login ? ago(a.last_login) : 'هرگز'}</dd></div>
                  <div><dt>آخرین IP</dt><dd dir="ltr">{a.last_ip || '—'}</dd></div>
                  <div><dt>ایجاد</dt><dd>{fmtDate(a.created_at)}</dd></div>
                </dl>
                {!me && (
                  <div className="admin-actions">
                    <Select value={a.role} onChange={(v) => patch(a, { role: v }, 'نقش تغییر کرد.')} options={ROLES} label="نقش" />
                    <div className="actions">
                      {a.locked && <Button size="sm" kind="ghost" icon="key" onClick={() => patch(a, { unlock: true }, 'قفل برداشته شد.')}>رفع قفل</Button>}
                      <Button size="sm" kind="ghost" icon={a.disabled ? 'check' : 'ban'} onClick={async () => { if (a.disabled || await confirmDialog({ title: 'غیرفعال‌سازی مدیر', text: 'همه نشست‌های این مدیر بسته می‌شود.', ok: 'غیرفعال کن', danger: true })) patch(a, { disabled: !a.disabled }, a.disabled ? 'حساب فعال شد.' : 'حساب غیرفعال شد.'); }}>{a.disabled ? 'فعال‌سازی' : 'غیرفعال‌سازی'}</Button>
                      <Button size="sm" kind="ghost" icon="refresh" onClick={async () => { if (!(await confirmDialog({ title: 'بازنشانی مدیر', text: 'رمز و ۲FA این مدیر بازنشانی و همه نشست‌هایش بسته می‌شود.', ok: 'بازنشانی', danger: true }))) return; try { const r = await api(`/admins/${a.id}/reset`, { method: 'POST', body: {} }); setSecret({ username: a.username, password: r.password }); load(); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } }}>بازنشانی</Button>
                      <IconBtn icon="trash" label="حذف مدیر" className="danger" onClick={async () => { if (!(await confirmDialog({ title: 'حذف مدیر', text: `حساب ${a.username} حذف شود؟`, ok: 'حذف', danger: true }))) return; try { await api(`/admins/${a.id}`, { method: 'DELETE' }); toast('مدیر حذف شد.', 'ok'); load(); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } }} />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {creating && <CreateAdmin onClose={() => setCreating(false)} onDone={(r) => { setCreating(false); setSecret({ username: r.admin.username, password: r.password }); load(); }} />}
    </div>
  );
}

function CreateAdmin({ onClose, onDone }) {
  const [u, setU] = useState(''); const [role, setRole] = useState('moderator'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const valid = /^[A-Za-z][A-Za-z0-9_.-]{3,31}$/.test(u);
  const submit = async (e) => {
    e?.preventDefault(); setErr('');
    if (!valid) { setErr('نام کاربری باید با حرف انگلیسی شروع شود و ۴ تا ۳۲ نویسه باشد.'); return; }
    setBusy(true);
    try { onDone(await api('/admins', { method: 'POST', body: { username: u, role } })); } catch (e2) { if (e2.status !== 428) setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="افزودن مدیر" onClose={onClose} footer={<><Button kind="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ساخت حساب</Button></>}>
      <form onSubmit={submit} noValidate>
        <Field label="نام کاربری (انگلیسی)" value={u} onChange={setU} dir="ltr" autoFocus maxLength={32} autoCapitalize="off" spellCheck="false" hint="حروف، اعداد، نقطه، خط تیره و زیرخط" />
        <Select value={role} onChange={setRole} options={ROLES} label="نقش" />
        {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
