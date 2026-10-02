import { useEffect, useState } from 'react';
import { api, assetUrl } from '../api.js';
import { can, useLiveRefresh } from '../live.js';
import {
  Card, Icon, Spinner, Button, IconBtn, Modal, Badge, Empty, Avatar, Pager, Select, toast, confirmDialog, fa, fmtNum, fmtDate, ago, cx,
} from '../ui.jsx';
import { useDebounced } from './Users.jsx';

const TYPES = [['', 'همه انواع'], ['group', 'گروه‌ها'], ['channel', 'کانال‌ها'], ['private', 'گفتگوهای خصوصی']];
const TYPE_FA = { group: 'گروه', channel: 'کانال', private: 'خصوصی', saved: 'ذخیره‌شده' };
const TYPE_IC = { group: 'users', channel: 'megaphone', private: 'user', saved: 'bookmark' };

export default function Chats({ admin }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [type, setType] = useState(''); const [frozen, setFrozen] = useState(false); const [page, setPage] = useState(1);
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [open, setOpen] = useState(null);
  const load = () => api(`/chats?q=${encodeURIComponent(dq)}&type=${type}&frozen=${frozen ? 1 : 0}&page=${page}`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [dq, type, frozen, page]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [dq, type, frozen]);
  useLiveRefresh(['tick:message'], load, 2500);
  return (
    <div className="page">
      <div className="toolbar">
        <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو با عنوان، @پیوند یا شناسه" aria-label="جستجوی گفتگوها" />{q && <IconBtn icon="x" label="پاک کردن" onClick={() => setQ('')} />}</label>
        <Select value={type} onChange={setType} options={TYPES} label="نوع" />
        <button type="button" className={cx('chip-toggle', frozen && 'on')} onClick={() => setFrozen(!frozen)} aria-pressed={frozen}><Icon name="lock" />فقط مسدودشده‌ها</button>
      </div>
      <Card pad={false}>
        {err && <div className="alert error m"><Icon name="alert" /><span>{err}</span></div>}
        {!data ? <div className="center"><Spinner /></div> : !data.items.length ? <Empty icon="message" title="گفتگویی یافت نشد" /> : (
          <table className="table">
            <thead><tr><th>گفتگو</th><th>نوع</th><th>اعضا</th><th>پیام‌ها</th><th>آخرین فعالیت</th><th aria-label="عملیات" /></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                  <td data-label="گفتگو"><div className="who"><Avatar src={assetUrl(c.photo)} name={c.type === 'private' ? (c.title || '').replace(/[@↔]/g, ' ') : c.title} color={c.color} /><div><b><span dir={c.type === 'private' ? 'ltr' : 'auto'}>{c.title || '—'}</span></b><span dir="ltr">{c.username ? `@${c.username} · ` : ''}#{c.id}</span></div></div></td>
                  <td data-label="نوع"><div className="chips"><Badge icon={TYPE_IC[c.type]}>{TYPE_FA[c.type]}</Badge>{c.frozen && <Badge tone="red" icon="lock">مسدود</Badge>}{c.is_public && <Badge tone="blue">عمومی</Badge>}</div></td>
                  <td data-label="اعضا">{fmtNum(c.members)}</td>
                  <td data-label="پیام‌ها">{fmtNum(c.messages)}</td>
                  <td data-label="آخرین فعالیت">{ago(c.last_at || c.created_at)}</td>
                  <td className="td-act"><Icon name="chevLeft" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <div className="card-foot"><span className="muted">{fmtNum(data.total)} گفتگو</span><Pager page={data.page} size={data.size} total={data.total} onPage={setPage} /></div>}
      </Card>
      {open && <ChatModal id={open} admin={admin} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

export function ChatModal({ id, admin, onClose, onChanged }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [msgs, setMsgs] = useState(null); const [more, setMore] = useState(true);
  const load = () => api(`/chats/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  const mod = can(admin, 'moderator'); const sup = can(admin, 'superadmin');
  const loadMsgs = async (before) => {
    try {
      const r = await api(`/chats/${id}/messages${before ? `?before=${before}` : ''}`);
      setMsgs((m) => [...(before ? m || [] : []), ...r.messages]); setMore(r.messages.length === 50);
    } catch (e) { toast(e.message, 'error'); }
  };
  const c = d?.chat;
  return (
    <Modal title={c ? (c.title || `گفتگوی #${fa(c.id)}`) : 'جزئیات گفتگو'} onClose={onClose} wide>
      {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
      {!d ? <div className="center"><Spinner /></div> : (
        <div className="detail">
          <div className="detail-hero">
            <Avatar src={assetUrl(c.photo)} name={c.title} color={c.color} size={64} />
            <div>
              <b dir="auto">{c.title || TYPE_FA[c.type]}</b>
              <span dir="ltr">{c.username ? `@${c.username} · ` : ''}#{c.id}</span>
              <div className="chips"><Badge icon={TYPE_IC[c.type]}>{TYPE_FA[c.type]}</Badge>{c.frozen && <Badge tone="red" icon="lock">مسدود</Badge>}<Badge>{fa(d.members.length)} عضو</Badge></div>
            </div>
          </div>
          {c.description && <p className="muted bio">{c.description}</p>}
          <dl className="kv"><div><dt>ایجاد</dt><dd>{fmtDate(c.created_at)}</dd></div><div><dt>عمومی</dt><dd>{c.is_public ? 'بله' : 'خیر'}</dd></div></dl>
          {mod && (
            <div className="actions">
              <Button kind={c.frozen ? 'ghost' : 'danger-soft'} icon="lock" loading={busy === 'f'} onClick={async () => {
                if (!c.frozen && !(await confirmDialog({ title: 'مسدودسازی گفتگو', text: 'ارسال پیام در این گفتگو برای همه اعضا متوقف می‌شود.', ok: 'مسدود کن', danger: true }))) return;
                setBusy('f'); try { await api(`/chats/${id}/freeze`, { method: 'POST', body: { frozen: !c.frozen } }); toast(c.frozen ? 'گفتگو آزاد شد.' : 'گفتگو مسدود شد.', 'ok'); await load(); onChanged?.(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
              }}>{c.frozen ? 'رفع مسدودی' : 'مسدودسازی گفتگو'}</Button>
              {msgs === null && <Button kind="ghost" icon="eye" onClick={async () => { if (await confirmDialog({ title: 'مشاهده پیام‌ها', text: 'مشاهده پیام‌های کاربران فقط برای بررسی تخلف مجاز است و در گزارش ممیزی ثبت می‌شود.', ok: 'ادامه' })) loadMsgs(); }}>مشاهده پیام‌ها (ثبت در ممیزی)</Button>}
              {sup && <Button kind="danger-soft" icon="trash" loading={busy === 'd'} onClick={async () => {
                if (!(await confirmDialog({ title: 'حذف گفتگو', text: 'گفتگو و همه پیام‌هایش برای همه اعضا حذف می‌شود. برگشت‌پذیر نیست.', ok: 'حذف دائمی', danger: true }))) return;
                setBusy('d'); try { await api(`/chats/${id}`, { method: 'DELETE' }); toast('گفتگو حذف شد.', 'ok'); onChanged?.(); onClose(); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } finally { setBusy(''); }
              }}>حذف گفتگو</Button>}
            </div>
          )}
          {msgs && (
            <>
              <h4 className="sub-title">پیام‌ها</h4>
              {!msgs.length ? <p className="muted">پیامی وجود ندارد.</p> : (
                <ul className="list msgs">
                  {msgs.map((m) => (
                    <li key={m.id} className={cx(m.deleted && 'deleted')}>
                      <div><b><span dir="ltr">@{m.username || 'system'}</span> · {fmtDate(m.created_at)}</b><span dir="auto" className="msg-text">{m.deleted ? 'حذف‌شده' : m.text || `[${m.type}]`}</span></div>
                      {mod && !m.deleted && m.type !== 'service' && <IconBtn icon="trash" label="حذف پیام" className="danger" onClick={async () => { if (await confirmDialog({ title: 'حذف پیام', text: 'این پیام برای همه حذف شود؟', ok: 'حذف', danger: true })) { try { await api(`/messages/${m.id}`, { method: 'DELETE' }); setMsgs((l) => l.map((x) => (x.id === m.id ? { ...x, deleted: true } : x))); toast('پیام حذف شد.', 'ok'); } catch (e) { toast(e.message, 'error'); } } }} />}
                    </li>
                  ))}
                </ul>
              )}
              {more && msgs.length > 0 && <Button kind="ghost" className="full" onClick={() => loadMsgs(msgs[msgs.length - 1].id)}>پیام‌های قدیمی‌تر</Button>}
            </>
          )}
          <h4 className="sub-title">اعضا</h4>
          <ul className="list">{d.members.map((m) => (
            <li key={m.user_id}><span className={cx('f-ic', m.role === 'owner' ? 'violet' : m.role === 'admin' ? 'blue' : 'muted')}><Icon name={m.role === 'member' ? 'user' : 'crown'} /></span><div><b>{m.name}</b><span><span dir="ltr">@{m.username}</span> · {m.role === 'owner' ? 'مالک' : m.role === 'admin' ? 'مدیر' : 'عضو'} · پیوستن {fmtDate(m.joined_at)}</span></div>{m.banned ? <Badge tone="red">مسدود</Badge> : null}</li>
          ))}</ul>
        </div>
      )}
    </Modal>
  );
}
