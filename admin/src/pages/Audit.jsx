import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useLiveRefresh } from '../live.js';
import { Card, Icon, Spinner, Button, Badge, Empty, Pager, toast, fa, fmtNum, fmtDate } from '../ui.jsx';
import { useDebounced } from './Users.jsx';
import { actionLabel } from './Dashboard.jsx';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return s; } };
const tone = (a) => (/delete|ban|freeze|failed|disable|reset|block/.test(a) && !/unban|unblock|unfreeze/.test(a) ? 'red' : a.startsWith('auth.') ? 'blue' : 'muted');

export default function Audit() {
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [page, setPage] = useState(1);
  const [data, setData] = useState(null); const [chk, setChk] = useState(null); const [checking, setChecking] = useState(false);
  const load = () => api(`/audit?q=${encodeURIComponent(dq)}&page=${page}`).then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, [dq, page]); // eslint-disable-line
  useEffect(() => { setPage(1); }, [dq]);
  useLiveRefresh(['audit'], () => { if (page === 1) load(); }, 400);
  const verify = async () => { setChecking(true); try { setChk(await api('/audit/verify')); } catch (e) { toast(e.message, 'error'); } finally { setChecking(false); } };
  return (
    <div className="page">
      <Card title="یکپارچگی گزارش ممیزی" icon="shield" actions={<Button size="sm" kind="ghost" icon="refresh" loading={checking} onClick={verify}>بررسی زنجیره</Button>}>
        <p className="muted">هر رویداد با هش SHA-256 رویداد قبلی زنجیر شده است؛ هرگونه ویرایش یا حذف مستقیم در پایگاه داده، زنجیره را می‌شکند و اینجا آشکار می‌شود.</p>
        {chk && (chk.ok
          ? <div className="alert ok"><Icon name="checkCircle" /><span>زنجیره سالم است — {fa(chk.checked)} رویداد بررسی شد.</span></div>
          : <div className="alert error"><Icon name="alert" /><span>دست‌کاری شناسایی شد: زنجیره در رویداد #{fa(chk.broken_at)} شکسته است ({fa(chk.checked)} رویداد سالم پیش از آن).</span></div>)}
      </Card>
      <div className="toolbar"><label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در اقدام، مدیر یا هدف" aria-label="جستجو در ممیزی" /></label></div>
      <Card pad={false}>
        {!data ? <div className="center"><Spinner /></div> : !data.items.length ? <Empty icon="scroll" title="رویدادی یافت نشد" /> : (
          <table className="table">
            <thead><tr><th>#</th><th>اقدام</th><th>مدیر</th><th>هدف</th><th>IP</th><th>زمان</th></tr></thead>
            <tbody>{data.items.map((r) => {
              const det = parse(r.detail);
              return (
                <tr key={r.id}>
                  <td data-label="#">{fa(r.id)}</td>
                  <td data-label="اقدام"><Badge tone={tone(r.action)}>{actionLabel(r.action)}</Badge>{det && typeof det === 'object' && Object.keys(det).length > 0 && <code className="det" dir="ltr" title={JSON.stringify(det)}>{JSON.stringify(det).slice(0, 80)}</code>}</td>
                  <td data-label="مدیر"><span dir="ltr">{r.admin_name || 'system'}</span></td>
                  <td data-label="هدف"><span dir="auto" className="clip">{r.target || '—'}</span></td>
                  <td data-label="IP"><span dir="ltr">{r.ip || '—'}</span></td>
                  <td data-label="زمان">{fmtDate(r.at)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {data && <div className="card-foot"><span className="muted">{fmtNum(data.total)} رویداد</span><Pager page={data.page} size={data.size} total={data.total} onPage={setPage} /></div>}
      </Card>
    </div>
  );
}
