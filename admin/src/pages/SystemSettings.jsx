import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Icon, Button, Field, Toggle, Badge, toast, confirmDialog, fa, cx } from '../ui.jsx';

export default function SystemSettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/system-settings').then(setS).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  if (!s) return <div className="center"><Icon name="gear" /></div>;

  const patch = async (changes) => {
    setBusy(true);
    try {
      const r = await api('/system-settings', { method: 'PATCH', body: changes });
      setS(r.settings);
      toast('تنظیمات ذخیره شد.', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <Card title="حالت نگهداری" icon="gear">
        <div className="rows">
          <div className="row">
            <div className="row-body"><div className="row-title">حالت نگهداری</div><div className="row-sub">غیرفعال کردن موقت ثبت‌نام و دسترسی کاربران</div></div>
            <Toggle checked={s.maintenance} disabled={busy} onChange={(v) => patch({ maintenance: v })} />
          </div>
          {s.maintenance && <Field label="پیام حالت نگهداری" value={s.maintenance_msg} onChange={(v) => patch({ maintenance_msg: v })} maxLength={500} textarea rows={2} />}
        </div>
        {s.maintenance && <div className="alert warn"><Icon name="alert" /><span>حالت نگهداری فعال است. کاربران جدید نمی‌توانند ثبت‌نام کنند.</span></div>}
      </Card>

      <Card title="ثبت‌نام و دسترسی" icon="users">
        <div className="rows">
          <div className="row"><div className="row-body"><div className="row-title">ثبت‌نام کاربران جدید</div><div className="row-sub">اجازه ساخت حساب کاربری جدید</div></div><Toggle checked={s.registrations} disabled={busy} onChange={(v) => patch({ registrations: v })} /></div>
          <div className="row"><div className="row-body"><div className="row-title">دسترسی مهمان به خواندن پیام‌ها</div><div className="row-sub">مشاهده پیام‌های عمومی بدون ورود</div></div><Toggle checked={s.guest_read} disabled={busy} onChange={(v) => patch({ guest_read: v })} /></div>
        </div>
      </Card>

      <Card title="محدودیت‌ها" icon="shield">
        <div className="rows">
          <div className="row"><div className="row-body"><div className="row-title">حداکثر حجم آپلود (MB)</div><div className="row-sub">حداکثر حجم هر فایل آپلودی</div></div><Field value={String(s.max_upload_mb)} onChange={(v) => patch({ max_upload_mb: +v || 100 })} type="number" dir="ltr" style={{ width: 100 }} /></div>
          <div className="row"><div className="row-body"><div className="row-title">نرخ پیام (پیام/دقیقه)</div><div className="row-sub">حداکثر پیام‌های قابل ارسال هر کاربر در دقیقه</div></div><Field value={String(s.message_rate)} onChange={(v) => patch({ message_rate: +v || 30 })} type="number" dir="ltr" style={{ width: 100 }} /></div>
        </div>
      </Card>

      <Card title="تنظیمات تماس (WebRTC/TURN)" icon="phone">
        <div className="rows">
          <div className="row"><div className="row-body"><div className="row-title">سرور TURN</div><div className="row-sub">کانفیگ TURN برای تماس‌های صوتی و تصویری</div></div><Badge tone={s.turn_configured ? 'green' : 'muted'} icon={s.turn_configured ? 'check' : 'alert'}>{s.turn_configured ? 'فعال' : 'غیرفعال'}</Badge></div>
          {s.turn_urls && <div className="row"><div className="row-body"><div className="row-title">آدرس TURN</div><div className="row-sub" dir="ltr">{s.turn_urls}</div></div></div>}
          {s.turn_user && <div className="row"><div className="row-body"><div className="row-title">کاربر TURN</div><div className="row-sub" dir="ltr">{s.turn_user}</div></div></div>}
          <div className="row"><div className="row-body"><div className="row-title">اجبار به عبور از TURN</div><div className="row-sub">همه ترافیک تماس از سرور TURN عبور کند</div></div><Toggle checked={s.force_turn} disabled={busy} onChange={(v) => patch({ force_turn: v })} /></div>
        </div>
        {!s.turn_configured && <div className="alert warn"><Icon name="alert" /><span>سرور TURN تنظیم نشده است. برای کیفیت بهتر تماس‌ها، یک سرور coturn با Docker راه‌اندازی کنید. راهنما در deploy/coturn/README.md</span></div>}
      </Card>
    </div>
  );
}
