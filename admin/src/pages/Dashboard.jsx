import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { live, useLive, useLiveRefresh, can } from '../live.js';
import { Card, Icon, Spinner, fa, fmtNum, fmtSize, fmtUptime, fmtHour, fmtDay, ago, cx, Badge } from '../ui.jsx';

const ACT = {
  'auth.login': 'ورود مدیر', 'auth.logout': 'خروج مدیر', 'auth.password_ok': 'رمز مدیر تأیید شد', 'auth.password_changed': 'تغییر رمز مدیر', 'auth.totp_enrolled': 'فعال‌سازی TOTP',
  'auth.reauth': 'تأیید دوباره هویت', 'auth.reauth_failed': 'تأیید هویت ناموفق', 'user.ban': 'مسدودسازی کاربر', 'user.unban': 'رفع مسدودیت', 'user.force_logout': 'خروج اجباری کاربر',
  'user.verify': 'تأیید حساب', 'user.unverify': 'لغو تأیید حساب', 'user.premium_grant': 'اعطای پریمیوم', 'user.premium_revoke': 'لغو پریمیوم', 'user.password_reset': 'بازنشانی رمز کاربر',
  'user.2fa_disabled': 'غیرفعال‌سازی ۲FA کاربر', 'user.delete': 'حذف کاربر', 'user.official_message': 'پیام رسمی', 'chat.freeze': 'مسدودسازی گفتگو', 'chat.unfreeze': 'رفع مسدودی گفتگو',
  'chat.delete': 'حذف گفتگو', 'chat.read_messages': 'مشاهده پیام‌های گفتگو', 'message.delete': 'حذف پیام', 'broadcast.send': 'اطلاعیه همگانی', 'security.update': 'تغییر تنظیمات امنیتی',
  'security.ip_block': 'مسدودسازی IP', 'security.ip_unblock': 'رفع مسدودی IP', 'admin.create': 'ساخت مدیر', 'admin.update': 'ویرایش مدیر', 'admin.reset': 'بازنشانی مدیر', 'admin.delete': 'حذف مدیر',
  'auth.recovery_code_used': 'استفاده از کد بازیابی', 'auth.recovery_regenerated': 'ساخت کدهای بازیابی جدید', 'auth.session_revoked': 'خاتمه نشست مدیر',
};
export const actionLabel = (a) => ACT[a] || (a?.startsWith('report.') ? 'رسیدگی به گزارش' : a);

export default function Dashboard({ go, admin }) {
  const s = useLive((x) => x.stats);
  const feed = useLive((x) => x.feed);
  const [act, setAct] = useState(null);
  const load = () => api('/activity').then(setAct).catch(() => {});
  useEffect(() => {
    load();
    if (can(admin, 'superadmin') && !live.get().feed.length) api('/audit?page=1').then((r) => { if (!live.get().feed.length) live.set({ feed: r.items.slice(0, 40) }); }).catch(() => {});
  }, []); // eslint-disable-line
  useLiveRefresh(['tick:user', 'tick:login', 'report:new', 'report:update', 'security'], load, 900);
  if (!s) return <div className="center"><Spinner size={30} /></div>;
  const cards = [
    ['users', 'کاربران', s.users, `${fmtNum(s.new_today)} عضو تازه امروز`, 'blue', 'users'],
    ['activity', 'آنلاین اکنون', s.online, `${fmtNum(s.sockets)} اتصال زنده`, 'green', 'users'],
    ['message', 'پیام‌ها (۲۴ ساعت)', s.messages_24h, `کل: ${fmtNum(s.messages)}`, 'violet', 'chats'],
    ['flag', 'گزارش‌های باز', s.reports_open, 'در انتظار بررسی', s.reports_open ? 'red' : 'muted', 'reports'],
    ['star', 'پریمیوم', s.premium, `${fmtNum(s.twofa)} کاربر با ۲FA`, 'gold', 'users'],
    ['alert', 'ورود ناموفق (۲۴ ساعت)', s.failed_logins_24h, `${fmtNum(s.ip_blocks)} IP مسدود`, s.failed_logins_24h > 20 ? 'red' : 'orange', 'security'],
  ];
  return (
    <div className="page">
      <div className="stat-grid">
        {cards.map(([ic, l, v, sub, tone, to]) => (
          <button key={l} type="button" className={cx('stat', `t-${tone}`)} onClick={() => go(to)}>
            <span className="stat-ic"><Icon name={ic} /></span>
            <span className="stat-body"><span className="stat-l">{l}</span><b className="stat-v">{fmtNum(v)}</b><span className="stat-s">{sub}</span></span>
          </button>
        ))}
      </div>
      <div className="grid-2">
        <Card title="پیام‌ها در ۲۴ ساعت گذشته" icon="message"><BarChart data={s.series.messages.map((x) => ({ t: x.t, v: x.n }))} label={(x) => fmtHour(x.t)} tone="var(--accent)" /></Card>
        <Card title="ورودها در ۲۴ ساعت گذشته" icon="key"><StackChart data={s.series.logins} /></Card>
      </div>
      <div className="grid-2">
        <Card title="ثبت‌نام در ۱۴ روز گذشته" icon="userPlus"><AreaChart data={s.series.signups.map((x) => ({ t: x.t, v: x.n }))} /></Card>
        <Card title="وضعیت سرور" icon="server">
          <dl className="kv">
            <div><dt>مدت فعالیت</dt><dd>{fmtUptime(s.server.uptime)}</dd></div>
            <div><dt>حافظه (RSS)</dt><dd>{fmtSize(s.server.rss)}</dd></div>
            <div><dt>Heap</dt><dd>{fmtSize(s.server.heap)}</dd></div>
            <div><dt>حجم پایگاه داده</dt><dd>{fmtSize(s.server.db_size)}</dd></div>
            <div><dt>فایل‌ها</dt><dd>{fmtNum(s.files)} ({fmtSize(s.files_bytes)})</dd></div>
            <div><dt>گروه / کانال / خصوصی</dt><dd>{fmtNum(s.groups)} / {fmtNum(s.channels)} / {fmtNum(s.privates)}</dd></div>
            <div><dt>استوری‌های فعال</dt><dd>{fmtNum(s.stories)}</dd></div>
            <div><dt>تماس‌ها (۲۴ ساعت)</dt><dd>{fmtNum(s.calls_24h)}</dd></div>
            <div><dt>نشست‌های کاربران</dt><dd>{fmtNum(s.sessions)}</dd></div>
            <div><dt>Node.js</dt><dd dir="ltr">{s.server.node}</dd></div>
          </dl>
        </Card>
      </div>
      <div className="grid-3">
        <Card title="عضوهای تازه" icon="userPlus" pad={false}>
          {!act ? <div className="center sm"><Spinner /></div> : act.signups.length ? (
            <ul className="feed">{act.signups.map((u) => <li key={u.id}><span className="f-ic blue"><Icon name="user" /></span><div><b>{u.name}</b><span dir="ltr">@{u.username}</span></div><time>{ago(u.created_at)}</time></li>)}</ul>
          ) : <p className="muted pad">هنوز کاربری ثبت‌نام نکرده است.</p>}
        </Card>
        <Card title="آخرین تلاش‌های ورود" icon="key" pad={false}>
          {!act ? <div className="center sm"><Spinner /></div> : act.logins.length ? (
            <ul className="feed">{act.logins.map((l, i) => <li key={i}><span className={cx('f-ic', l.ok ? 'green' : 'red')}><Icon name={l.ok ? 'check' : 'x'} /></span><div><b dir="ltr">{l.username || '—'}</b><span><span dir="ltr">{l.ip}</span> · {l.scope === 'admin' ? 'مدیر' : 'کاربر'}</span></div><time>{ago(l.at)}</time></li>)}</ul>
          ) : <p className="muted pad">تلاش ورودی ثبت نشده است.</p>}
        </Card>
        <Card title="رویدادهای زنده مدیریت" icon="activity" pad={false}>
          {feed.length ? (
            <ul className="feed">{feed.slice(0, 12).map((e) => <li key={e.id}><span className="f-ic violet"><Icon name="scroll" /></span><div><b>{actionLabel(e.action)}</b><span><span dir="ltr">{e.admin_name}</span>{e.target ? <> · <span dir="auto">{e.target}</span></> : null}</span></div><time>{fmtHour(e.at)}</time></li>)}</ul>
          ) : <p className="muted pad">رویدادهای مدیریتی به محض وقوع اینجا نمایش داده می‌شوند.</p>}
        </Card>
      </div>
      {act?.reports?.length > 0 && (
        <Card title="گزارش‌های باز اخیر" icon="flag" actions={<button type="button" className="link" onClick={() => go('reports')}>مشاهده همه</button>}>
          <div className="chips">{act.reports.map((r) => <Badge key={r.id} tone="red" icon="flag">#{fa(r.id)} · {r.reason} · {fmtDay(r.created_at)}</Badge>)}</div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ lightweight SVG charts */
function useHover() { const [h, setH] = useState(-1); return [h, setH]; }
function BarChart({ data, label, tone }) {
  const [h, setH] = useHover();
  const max = Math.max(1, ...data.map((d) => d.v));
  const W = 480; const H = 160; const bw = W / data.length;
  const cur = h >= 0 ? data[h] : data[data.length - 1];
  return (
    <div className="chart">
      <div className="chart-cap"><b>{fmtNum(cur.v)}</b><span>{label(cur)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="نمودار ستونی" onPointerLeave={() => setH(-1)} dir="ltr">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="grid-line" />)}
        {data.map((d, i) => {
          const bh = Math.max(2, (d.v / max) * (H - 8));
          return <rect key={d.t} x={i * bw + bw * 0.18} y={H - bh} width={bw * 0.64} height={bh} rx="3" fill={tone} opacity={h === -1 || h === i ? 1 : 0.45} onPointerEnter={() => setH(i)} />;
        })}
      </svg>
      <div className="chart-axis" dir="ltr"><span>{label(data[0])}</span><span>{label(data[Math.floor(data.length / 2)])}</span><span>{label(data[data.length - 1])}</span></div>
    </div>
  );
}
function StackChart({ data }) {
  const [h, setH] = useHover();
  const max = Math.max(1, ...data.map((d) => d.ok + d.bad));
  const W = 480; const H = 160; const bw = W / data.length;
  const cur = h >= 0 ? data[h] : data[data.length - 1];
  return (
    <div className="chart">
      <div className="chart-cap"><b className="ok">{fmtNum(cur.ok)} موفق</b><b className="bad">{fmtNum(cur.bad)} ناموفق</b><span>{fmtHour(cur.t)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="نمودار ورودها" onPointerLeave={() => setH(-1)} dir="ltr">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="grid-line" />)}
        {data.map((d, i) => {
          const a = (d.ok / max) * (H - 8); const b = (d.bad / max) * (H - 8);
          const op = h === -1 || h === i ? 1 : 0.45;
          return (
            <g key={d.t} opacity={op} onPointerEnter={() => setH(i)}>
              <rect x={i * bw} y="0" width={bw} height={H} fill="transparent" />
              {a > 0 && <rect x={i * bw + bw * 0.18} y={H - a} width={bw * 0.64} height={a} rx="2" fill="var(--ok)" />}
              {b > 0 && <rect x={i * bw + bw * 0.18} y={H - a - b} width={bw * 0.64} height={b} rx="2" fill="var(--danger)" />}
              {a + b === 0 && <rect x={i * bw + bw * 0.18} y={H - 2} width={bw * 0.64} height="2" rx="1" fill="var(--line-2)" />}
            </g>
          );
        })}
      </svg>
      <div className="chart-axis" dir="ltr"><span>{fmtHour(data[0].t)}</span><span>{fmtHour(data[12].t)}</span><span>{fmtHour(data[data.length - 1].t)}</span></div>
    </div>
  );
}
function AreaChart({ data }) {
  const [h, setH] = useHover();
  const max = Math.max(1, ...data.map((d) => d.v));
  const W = 480; const H = 160; const step = W / (data.length - 1);
  const pts = data.map((d, i) => [i * step, H - 6 - (d.v / max) * (H - 18)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const cur = h >= 0 ? data[h] : data[data.length - 1];
  const hp = pts[h >= 0 ? h : pts.length - 1];
  return (
    <div className="chart">
      <div className="chart-cap"><b>{fmtNum(cur.v)}</b><span>{fmtDay(cur.t)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="نمودار ثبت‌نام" dir="ltr"
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setH(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1))))); }}
        onPointerLeave={() => setH(-1)}>
        <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="grid-line" />)}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#ag)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <line x1={hp[0]} x2={hp[0]} y1="0" y2={H} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis" dir="ltr"><span>{fmtDay(data[0].t)}</span><span>{fmtDay(data[7].t)}</span><span>{fmtDay(data[data.length - 1].t)}</span></div>
    </div>
  );
}
