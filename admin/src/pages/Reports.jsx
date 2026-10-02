import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, useLiveRefresh } from '../live.js';
import { Card, Icon, Spinner, Button, Badge, Empty, Pager, toast, promptDialog, fa, fmtNum, fmtDate, cx } from '../ui.jsx';

export const REASONS = { spam: 'هرزنامه', violence: 'خشونت', porn: 'محتوای مستهجن', child: 'کودک‌آزاری', copyright: 'نقض کپی‌رایت', fake: 'جعل هویت', scam: 'کلاهبرداری', other: 'سایر' };
const KIND = { user: ['کاربر', 'user'], message: ['پیام', 'message'], chat: ['گفتگو', 'users'] };
const CT = { private: 'گفتگوی خصوصی', group: 'گروه', channel: 'کانال' };
const TABS = [['open', 'باز'], ['resolved', 'رسیدگی‌شده'], ['dismissed', 'ردشده']];

export default function Reports({ admin }) {
  const [status, setStatus] = useState('open'); const [page, setPage] = useState(1);
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const load = () => api(`/reports?status=${status}&page=${page}`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [status, page]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [status]);
  useLiveRefresh(['report:new', 'report:update'], load, 400);
  const mod = can(admin, 'moderator');
  const resolve = async (r, action, label) => {
    const note = await promptDialog({ title: label, label: 'یادداشت (اختیاری)', text: 'گزارش‌دهنده از نتیجه بررسی مطلع می‌شود.', ok: 'ثبت', danger: ['ban_user', 'delete_message', 'freeze_chat'].includes(action), maxLength: 300 });
    if (note == null) return;
    setBusy(`${r.id}${action}`);
    try { await api(`/reports/${r.id}/resolve`, { method: 'POST', body: { action, note } }); toast('گزارش بررسی شد.', 'ok'); load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="page">
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={status === k} className={cx(status === k && 'active')} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {err && <div className="alert error"><Icon name="alert" /><span>{err}</span></div>}
      {!data ? <div className="center"><Spinner /></div> : !data.items.length ? <Card><Empty icon="flag" title={status === 'open' ? 'گزارش بازی وجود ندارد' : 'موردی نیست'} sub={status === 'open' ? 'گزارش‌های تازه به‌صورت زنده اینجا ظاهر می‌شوند.' : undefined} /></Card> : (
        <div className="report-list">
          {data.items.map((r) => {
            const s = r.snapshot || {}; const [kl, ki] = KIND[r.kind] || [r.kind, 'flag'];
            return (
              <Card key={r.id} className="report">
                <div className="rp-head">
                  <span className="f-ic red"><Icon name={ki} /></span>
                  <div><b>گزارش #{fa(r.id)} · {kl} · {REASONS[r.reason] || r.reason}</b><span>از <span dir="ltr">@{r.reporter_name || '—'}</span> · {fmtDate(r.created_at)}</span></div>
                  <Badge tone={r.status === 'open' ? 'red' : r.status === 'resolved' ? 'green' : 'muted'}>{TABS.find((t) => t[0] === r.status)?.[1]}</Badge>
                </div>
                <div className="rp-snap">
                  {r.kind === 'user' && <><b>{s.name}</b> <span dir="ltr">@{s.username}</span>{s.bio && <p dir="auto">{s.bio}</p>}</>}
                  {r.kind === 'message' && <><b>{s.chat_title || CT[s.chat_type] || '—'}</b> · فرستنده <span dir="ltr">@{s.sender}</span><p dir="auto">{s.text || `[${s.type}]`}</p></>}
                  {r.kind === 'chat' && <><b>{s.title}</b> · {CT[s.type] || ''} {s.username && <span dir="ltr">@{s.username}</span>}</>}
                  {r.note && <p className="muted">توضیح گزارش‌دهنده: {r.note}</p>}
                </div>
                {r.status !== 'open' && <p className="muted">نتیجه: {r.resolution} · توسط <span dir="ltr">{r.resolved_by_name || '—'}</span> · {fmtDate(r.resolved_at)}</p>}
                {r.status === 'open' && mod && (
                  <div className="actions">
                    {r.kind === 'message' && <Button kind="danger-soft" size="sm" icon="trash" loading={busy === `${r.id}delete_message`} onClick={() => resolve(r, 'delete_message', 'حذف پیام')}>حذف پیام</Button>}
                    {r.kind !== 'chat' && <Button kind="danger-soft" size="sm" icon="ban" loading={busy === `${r.id}ban_user`} onClick={() => resolve(r, 'ban_user', 'مسدودسازی کاربر')}>مسدودسازی کاربر</Button>}
                    {r.chat_id && <Button kind="danger-soft" size="sm" icon="lock" loading={busy === `${r.id}freeze_chat`} onClick={() => resolve(r, 'freeze_chat', 'مسدودسازی گفتگو')}>مسدودسازی گفتگو</Button>}
                    <Button kind="ghost" size="sm" icon="check" loading={busy === `${r.id}resolve`} onClick={() => resolve(r, 'resolve', 'علامت رسیدگی')}>رسیدگی شد</Button>
                    <Button kind="ghost" size="sm" icon="x" loading={busy === `${r.id}dismiss`} onClick={() => resolve(r, 'dismiss', 'رد گزارش')}>رد گزارش</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {data && data.total > data.size && <div className="card-foot bare"><span className="muted">{fmtNum(data.total)} گزارش</span><Pager page={data.page} size={data.size} total={data.total} onPage={setPage} /></div>}
    </div>
  );
}
