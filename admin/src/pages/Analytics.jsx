import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Icon, Spinner, fa, fmtNum, fmtSize, cx, Badge } from '../ui.jsx';

export default function Analytics() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/analytics').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="alert error"><Icon name="alert" /><span>{err}</span></div>;
  if (!d) return <div className="center"><Spinner size={30} /></div>;

  const e = d.engagement;
  const m = d.media;

  return (
    <div className="page">
      <div className="stat-grid">
        <div className="stat t-blue"><span className="stat-ic"><Icon name="userPlus" /></span><span className="stat-body"><span className="stat-l">کاربران (۳۰ روز)</span><b className="stat-v">{fmtNum(d.totals.users_30d)}</b></span></div>
        <div className="stat t-violet"><span className="stat-ic"><Icon name="message" /></span><span className="stat-body"><span className="stat-l">پیام‌ها (۳۰ روز)</span><b className="stat-v">{fmtNum(d.totals.messages_30d)}</b></span></div>
        <div className="stat t-green"><span className="stat-ic"><Icon name="activity" /></span><span className="stat-body"><span className="stat-l">کاربران فعال روزانه</span><b className="stat-v">{fmtNum(e.dau)}</b><span className="stat-s">از {fmtNum(e.mau)} ماهانه</span></span></div>
        <div className="stat t-gold"><span className="stat-ic"><Icon name="star" /></span><span className="stat-body"><span className="stat-l">نرخ درگیرسازی</span><b className="stat-v">{fmtNum(Math.round(e.ratio * 100))}٪</b><span className="stat-s">حبوط: {fmtNum(Math.round(e.retention * 100))}٪</span></span></div>
      </div>

      <div className="grid-2">
        <Card title="رشد کاربران (۳۰ روز)" icon="userPlus">
          <MultiChart data={d.growth} keys={['users', 'active']} colors={['var(--accent)', 'var(--ok)']} labels={['ثبت‌نام', 'فعال']} />
        </Card>
        <Card title="حجم پیام‌ها (۳۰ روز)" icon="message">
          <MultiChart data={d.growth} keys={['messages']} colors={['var(--accent)']} labels={['پیام']} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="برترین کاربران فعال" icon="users" pad={false}>
          {d.topUsers.length ? (
            <ul className="feed">
              {d.topUsers.map((u, i) => (
                <li key={u.sender_id}>
                  <span className={cx('f-ic', i < 3 ? 'gold' : 'blue')}><Icon name="star" /></span>
                  <div><b>{u.name}</b><span dir="ltr">@{u.username}</span></div>
                  <time>{fmtNum(u.n)} پیام</time>
                </li>
              ))}
            </ul>
          ) : <p className="muted pad">داده‌ای موجود نیست.</p>}
        </Card>
        <Card title="پرمخاطب‌ترین گفتگوها" icon="message" pad={false}>
          {d.topChats.length ? (
            <ul className="feed">
              {d.topChats.map((c, i) => (
                <li key={c.chat_id}>
                  <span className={cx('f-ic', i < 3 ? 'gold' : 'violet')}><Icon name="message" /></span>
                  <div><b>{c.title || `گفتگو #${c.chat_id}`}</b><span>{c.type === 'group' ? 'گروه' : c.type === 'channel' ? 'کانال' : 'خصوصی'}</span></div>
                  <time>{fmtNum(c.n)} پیام</time>
                </li>
              ))}
            </ul>
          ) : <p className="muted pad">داده‌ای موجود نیست.</p>}
        </Card>
      </div>

      <Card title="آمار رسانه‌ها" icon="image">
        <div className="grid-3">
          <div className="mini-stat"><span className="ms-ic blue"><Icon name="image" /></span><div><b>{fmtNum(m.images)}</b><span>تصویر</span></div></div>
          <div className="mini-stat"><span className="ms-ic violet"><Icon name="video" /></span><div><b>{fmtNum(m.videos)}</b><span>ویدیو</span></div></div>
          <div className="mini-stat"><span className="ms-ic gold"><Icon name="file" /></span><div><b>{fmtNum(m.audio)}</b><span>صوت</span></div></div>
          <div className="mini-stat"><span className="ms-ic green"><Icon name="file" /></span><div><b>{fmtNum(m.docs)}</b><span>سایر</span></div></div>
          <div className="mini-stat"><span className="ms-ic orange"><Icon name="database" /></span><div><b>{fmtSize(m.total_bytes)}</b><span>کل حجم</span></div></div>
        </div>
      </Card>
    </div>
  );
}

function MultiChart({ data, keys, colors, labels }) {
  const [h, setH] = useState(-1);
  const W = 480; const H = 180;
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => d[k] || 0)));
  const bw = W / data.length;
  const cur = h >= 0 ? data[h] : data[data.length - 1];
  return (
    <div className="chart">
      <div className="chart-cap">
        {keys.map((k, i) => <b key={k} style={{ color: colors[i] }}>{fmtNum(cur[k] || 0)} {labels[i]}</b>)}
        <span>{new Date(cur.t).toLocaleDateString('fa-IR')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" dir="ltr" onPointerLeave={() => setH(-1)}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="grid-line" />)}
        {keys.map((k, ki) => data.map((d, i) => {
          const v = d[k] || 0;
          const bh = Math.max(2, (v / max) * (H - 8));
          const offset = ki * (bw / keys.length);
          return <rect key={`${k}-${d.t}`} x={i * bw + offset + bw * 0.1} y={H - bh} width={bw / keys.length * 0.7} height={bh} rx="2" fill={colors[ki]} opacity={h === -1 || h === i ? 0.9 : 0.4} onPointerEnter={() => setH(i)} />;
        }))}
      </svg>
      <div className="chart-axis" dir="ltr"><span>{new Date(data[0].t).toLocaleDateString('fa-IR')}</span><span>{new Date(data[Math.floor(data.length / 2)].t).toLocaleDateString('fa-IR')}</span><span>{new Date(data[data.length - 1].t).toLocaleDateString('fa-IR')}</span></div>
    </div>
  );
}
