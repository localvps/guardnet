import { useEffect, useState } from 'react';
import { api, assetUrl } from '../api.js';
import { Card, Icon, Spinner, Button, Badge, Empty, Pager, toast, confirmDialog, fa, fmtSize, fmtDate, cx } from '../ui.jsx';

const TYPES = [['', 'همه'], ['image', 'تصویر'], ['video', 'ویدیو'], ['audio', 'صوت'], ['doc', 'سایر']];

export default function MediaBrowser() {
  const [data, setData] = useState(null);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const load = () => {
    setErr('');
    api(`/media?page=${page}&type=${type}`).then(setData).catch((e) => setErr(e.message));
  };
  useEffect(load, [page, type]);

  if (err) return <div className="alert error"><Icon name="alert" /><span>{err}</span></div>;
  if (!data) return <div className="center"><Spinner size={30} /></div>;

  const del = async (id) => {
    const r = await confirmDialog({ title: 'حذف فایل', text: 'این فایل برای همیشه حذف شود؟', ok: 'حذف', danger: true });
    if (!r) return;
    try { await api(`/media/${id}`, { method: 'DELETE' }); toast('فایل حذف شد.', 'ok'); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page">
      <Card title="مرورگر رسانه‌ها" icon="image" actions={
        <div className="chips">
          {TYPES.map(([k, l]) => <button key={k} type="button" className={cx('chip-toggle', type === k && 'active')} onClick={() => { setType(k); setPage(1); }}>{l}</button>)}
        </div>
      }>
        {data.items.length === 0 ? <Empty icon="image" title="فایلی یافت نشد" sub="رسانه‌ای مطابق فیلتر انتخاب‌شده وجود ندارد." /> : (
          <div className="media-grid">
            {data.items.map((f) => (
              <div key={f.id} className="media-card">
                <div className="media-thumb">
                  {f.mime?.startsWith('image/') ? <img src={f.url} alt={f.name} loading="lazy" /> :
                   f.mime?.startsWith('video/') ? <><Icon name="video" /><span>{f.mime}</span></> :
                   f.mime?.startsWith('audio/') ? <><Icon name="volume" /><span>صوت</span></> :
                   <><Icon name="file" /><span>{f.name?.split('.').pop()?.toUpperCase() || 'FILE'}</span></>}
                </div>
                <div className="media-info">
                  <b title={f.name}>{f.name || 'بدون نام'}</b>
                  <span>{fmtSize(f.size)} · {f.owner_name ? `@${f.owner_name}` : '—'}</span>
                  <time>{fmtDate(f.created_at)}</time>
                </div>
                <div className="media-actions">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="btn sm ghost"><Icon name="eye" />مشاهده</a>
                  <button type="button" className="btn sm danger" onClick={() => del(f.id)}><Icon name="trash" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        {data.total > data.size && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
