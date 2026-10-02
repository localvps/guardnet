import { useEffect, useState } from 'react';
import { api, assetUrl } from '../api.js';
import { can, useLiveRefresh } from '../live.js';
import {
  Card, Icon, Spinner, Button, IconBtn, Modal, Badge, Empty, Avatar, Pager, Select, SecretBox, toast, confirmDialog, promptDialog,
  fa, fmtNum, fmtDate, ago, cx,
} from '../ui.jsx';

const FILTERS = [['', 'همه کاربران'], ['online', 'آنلاین'], ['active', 'فعال'], ['banned', 'مسدود'], ['premium', 'پریمیوم'], ['verified', 'تأییدشده'], ['twofa', 'دارای ۲FA'], ['deleted', 'حذف‌شده']];

export function useDebounced(v, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Users({ admin }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [filter, setFilter] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => api(`/users?q=${encodeURIComponent(dq)}&filter=${filter}&page=${page}`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [dq, filter, page]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [dq, filter]);
  useLiveRefresh(['tick:user', 'tick:presence'], load, 1500);
  return (
    <div className="page">
      <div className="toolbar">
        <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو با نام، @نام کاربری، شناسه یا IP" aria-label="جستجوی کاربران" />{q && <IconBtn icon="x" label="پاک کردن" onClick={() => setQ('')} />}</label>
        <Select value={filter} onChange={setFilter} options={FILTERS} label="فیلتر" />
      </div>
      <Card pad={false}>
        {err && <div className="alert error m"><Icon name="alert" /><span>{err}</span></div>}
        {!data ? <div className="center"><Spinner /></div> : !data.items.length ? <Empty icon="users" title="کاربری یافت نشد" sub="عبارت جستجو یا فیلتر را تغییر دهید." /> : (
          <table className="table">
            <thead><tr><th>کاربر</th><th>وضعیت</th><th>عضویت</th><th>آخرین بازدید</th><th>IP ثبت‌نام</th><th aria-label="عملیات" /></tr></thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} onClick={() => setOpen(u.id)} className="clickable">
                  <td data-label="کاربر"><div className="who"><Avatar src={assetUrl(u.avatar)} name={u.name} color={u.color} /><div><b>{u.name}{u.verified && <Icon name="verified" className="vf" />}</b><span dir="ltr">@{u.username} · #{u.id}</span></div></div></td>
                  <td data-label="وضعیت"><UserBadges u={u} /></td>
                  <td data-label="عضویت">{fmtDate(u.created_at)}</td>
                  <td data-label="آخرین بازدید">{u.online ? <span className="on-txt">آنلاین</span> : ago(u.last_seen)}</td>
                  <td data-label="IP ثبت‌نام"><span dir="ltr">{u.reg_ip || '—'}</span></td>
                  <td className="td-act"><Icon name="chevLeft" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <div className="card-foot"><span className="muted">{fmtNum(data.total)} کاربر</span><Pager page={data.page} size={data.size} total={data.total} onPage={setPage} /></div>}
      </Card>
      {open && <UserModal id={open} admin={admin} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

export function UserBadges({ u }) {
  return (
    <div className="chips">
      {u.online && <Badge tone="green">آنلاین</Badge>}
      {u.banned && <Badge tone="red" icon="ban">مسدود</Badge>}
      {u.deleted && <Badge tone="muted">حذف‌شده</Badge>}
      {u.premium && <Badge tone="gold" icon="star">پریمیوم</Badge>}
      {u.totp && <Badge tone="blue" icon="lock">۲FA</Badge>}
      {u.system && <Badge tone="violet">سیستمی</Badge>}
      {!u.online && !u.banned && !u.deleted && !u.premium && !u.totp && !u.system && <Badge>عادی</Badge>}
    </div>
  );
}

function UserModal({ id, admin, onClose, onChanged }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [secret, setSecret] = useState(null);
  const load = () => api(`/users/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); await load(); onChanged(); return r; } catch (e) { if (e.status !== 428) toast(e.message, 'error'); return null; } finally { setBusy(''); }
  };
  const mod = can(admin, 'moderator'); const sup = can(admin, 'superadmin');
  const u = d?.user;
  return (
    <Modal title={u ? u.name : 'جزئیات کاربر'} onClose={onClose} wide>
      {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
      {!d ? <div className="center"><Spinner /></div> : (
        <div className="detail">
          <div className="detail-hero">
            <Avatar src={assetUrl(u.avatar)} name={u.name} color={u.color} size={64} />
            <div>
              <b>{u.name}{u.verified && <Icon name="verified" className="vf" />}</b>
              <span dir="ltr">@{u.username} · #{u.id}</span>
              <UserBadges u={u} />
            </div>
          </div>
          {u.banned && <div className="alert error"><Icon name="ban" /><span>مسدود از {fmtDate(u.banned_at)} — دلیل: {u.ban_reason}</span></div>}
          {u.bio && <p className="muted bio">{u.bio}</p>}
          <div className="mini-stats">
            {[['پیام', d.counts.messages], ['گفتگو', d.counts.chats], ['مخاطب', d.counts.contacts], ['فایل', d.counts.files], ['گزارش علیه', d.counts.reports_against], ['مسدودشده توسط', d.counts.blocked_by]].map(([l, v]) => <div key={l}><b>{fmtNum(v)}</b><span>{l}</span></div>)}
          </div>
          <dl className="kv">
            <div><dt>عضویت</dt><dd>{fmtDate(u.created_at)}</dd></div>
            <div><dt>آخرین بازدید</dt><dd>{u.online ? 'آنلاین' : fmtDate(u.last_seen)}</dd></div>
            <div><dt>IP ثبت‌نام</dt><dd dir="ltr">{u.reg_ip || '—'}</dd></div>
            <div><dt>پریمیوم تا</dt><dd>{u.premium ? fmtDate(u.premium_until) : '—'}</dd></div>
          </dl>
          {secret && <SecretBox value={secret} label="رمز موقت جدید (فقط یک بار نمایش داده می‌شود)" />}
          {!u.system && !u.deleted && mod && (
            <div className="actions">
              {u.banned
                ? <Button kind="ghost" icon="check" loading={busy === 'unban'} onClick={() => act('unban', () => api(`/users/${id}/unban`, { method: 'POST', body: {} }), 'مسدودیت برداشته شد.')}>رفع مسدودیت</Button>
                : <Button kind="danger-soft" icon="ban" loading={busy === 'ban'} onClick={async () => { const reason = await promptDialog({ title: 'مسدودسازی کاربر', label: 'دلیل مسدودسازی', text: 'کاربر از همه دستگاه‌ها خارج می‌شود و امکان ورود نخواهد داشت.', ok: 'مسدود کن', danger: true, maxLength: 200 }); if (reason != null) act('ban', () => api(`/users/${id}/ban`, { method: 'POST', body: { reason } }), 'کاربر مسدود شد.'); }}>مسدودسازی</Button>}
              <Button kind="ghost" icon="logout" loading={busy === 'logout'} onClick={async () => { if (await confirmDialog({ title: 'خروج اجباری', text: 'همه نشست‌های این کاربر بسته شود؟', ok: 'خروج از همه' })) act('logout', () => api(`/users/${id}/logout`, { method: 'POST', body: {} }), 'کاربر از همه دستگاه‌ها خارج شد.'); }}>خروج از همه دستگاه‌ها</Button>
              <Button kind="ghost" icon="verified" loading={busy === 'verify'} onClick={() => act('verify', () => api(`/users/${id}/verify`, { method: 'POST', body: { verified: !u.verified } }), u.verified ? 'تیک تأیید برداشته شد.' : 'حساب تأیید شد.')}>{u.verified ? 'لغو تیک تأیید' : 'اعطای تیک تأیید'}</Button>
              <Button kind="ghost" icon="send" loading={busy === 'msg'} onClick={async () => { const text = await promptDialog({ title: 'پیام رسمی GuardNet', label: 'متن پیام', textarea: true, ok: 'ارسال', required: true, maxLength: 4000 }); if (text) act('msg', () => api(`/users/${id}/message`, { method: 'POST', body: { text } }), 'پیام ارسال شد.'); }}>ارسال پیام رسمی</Button>
              {sup && <Button kind="ghost" icon="star" loading={busy === 'prem'} onClick={async () => { const v = await promptDialog({ title: 'پریمیوم', label: 'تعداد روز (۰ برای لغو)', value: u.premium ? '0' : '30', type: 'number', dir: 'ltr', ok: 'اعمال' }); if (v != null) act('prem', () => api(`/users/${id}/premium`, { method: 'POST', body: { days: Number.parseInt(v, 10) || 0 } }), 'وضعیت پریمیوم به‌روزرسانی شد.'); }}>مدیریت پریمیوم</Button>}
              {sup && <Button kind="ghost" icon="key" loading={busy === 'pw'} onClick={async () => { if (await confirmDialog({ title: 'بازنشانی رمز', text: 'رمز تصادفی تازه‌ای ساخته و همه نشست‌ها بسته می‌شود.', ok: 'بازنشانی', danger: true })) { const r = await act('pw', () => api(`/users/${id}/reset-password`, { method: 'POST', body: {} }), 'رمز بازنشانی شد.'); if (r?.password) setSecret(r.password); } }}>بازنشانی رمز</Button>}
              {sup && u.totp && <Button kind="ghost" icon="lock" loading={busy === '2fa'} onClick={async () => { if (await confirmDialog({ title: 'غیرفعال‌سازی ۲FA', text: 'فقط پس از احراز هویت قطعی مالک حساب انجام دهید.', ok: 'غیرفعال کن', danger: true })) act('2fa', () => api(`/users/${id}/disable-2fa`, { method: 'POST', body: {} }), '۲FA غیرفعال شد.'); }}>غیرفعال‌سازی ۲FA</Button>}
              {sup && <Button kind="danger-soft" icon="trash" loading={busy === 'del'} onClick={async () => { if (await confirmDialog({ title: 'حذف حساب', text: `حساب @${u.username} برای همیشه حذف شود؟ این کار برگشت‌پذیر نیست.`, ok: 'حذف دائمی', danger: true })) act('del', () => api(`/users/${id}`, { method: 'DELETE' }), 'حساب حذف شد.'); }}>حذف حساب</Button>}
            </div>
          )}
          <h4 className="sub-title">نشست‌های فعال ({fa(d.sessions.length)})</h4>
          {d.sessions.length ? (
            <ul className="list">{d.sessions.map((s) => (
              <li key={s.id}>
                <span className={cx('f-ic', s.online ? 'green' : 'muted')}><Icon name={/Android|iPhone|iPad/i.test(s.device) ? 'smartphone' : 'monitor'} /></span>
                <div><b>{s.device}</b><span><span dir="ltr">{s.ip}</span> · {s.online ? 'آنلاین' : ago(s.last_active)} · ورود {fmtDate(s.created_at)}</span></div>
                {mod && !u.system && <IconBtn icon="trash" label="خاتمه نشست" className="danger" onClick={() => act(`s${s.id}`, () => api(`/users/${id}/sessions/${s.id}`, { method: 'DELETE' }), 'نشست بسته شد.')} />}
              </li>
            ))}</ul>
          ) : <p className="muted">نشست فعالی ندارد.</p>}
          <h4 className="sub-title">آخرین تلاش‌های ورود</h4>
          {d.logins.length ? (
            <ul className="list">{d.logins.map((l, i) => <li key={i}><span className={cx('f-ic', l.ok ? 'green' : 'red')}><Icon name={l.ok ? 'check' : 'x'} /></span><div><b>{l.ok ? 'ورود موفق' : 'ورود ناموفق'}</b><span><span dir="ltr">{l.ip}</span> · {fmtDate(l.at)}</span></div></li>)}</ul>
          ) : <p className="muted">ثبت نشده است.</p>}
          {d.groups.length > 0 && (<><h4 className="sub-title">گروه‌ها و کانال‌ها</h4><div className="chips">{d.groups.map((g) => <Badge key={g.id} tone={g.role === 'owner' ? 'violet' : 'muted'} icon={g.type === 'channel' ? 'megaphone' : 'users'}>{g.title}{g.role !== 'member' ? ` · ${g.role === 'owner' ? 'مالک' : 'مدیر'}` : ''}</Badge>)}</div></>)}
        </div>
      )}
    </Modal>
  );
}
