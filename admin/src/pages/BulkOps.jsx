import { useState } from 'react';
import { api } from '../api.js';
import { Card, Icon, Button, Field, Select, Toggle, toast, confirmDialog, fa, fmtNum, cx } from '../ui.jsx';

const FILTERS = [
  ['active', 'همه کاربران فعال'],
  ['banned', 'مسدودشده'],
  ['unbanned', 'غیرمسدود'],
  ['premium', 'پریمیوم'],
  ['verified', 'تأییدشده'],
  ['unverified', 'تأییدنشده'],
  ['twofa', 'دارای ۲FA'],
  ['inactive', 'غیرفعال (۳۰ روز)'],
];
const ACTIONS = [
  ['ban', 'مسدودسازی دسته‌جمعی', 'ban'],
  ['unban', 'رفع مسدودیت دسته‌جمعی', 'shield'],
  ['verify', 'تأیید حساب دسته‌جمعی', 'check'],
  ['unverify', 'لغو تأیید دسته‌جمعی', 'x'],
  ['premium', 'اعطای پریمیوم دسته‌جمعی', 'star'],
  ['message', 'پیام دسته‌جمعی', 'megaphone'],
  ['force_logout', 'خروج اجباری همه', 'logout'],
];

export default function BulkOps() {
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('ban');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const curAction = ACTIONS.find((a) => a[0] === action);

  const run = async () => {
    const body = { action, filter, search };
    if (action === 'ban') body.reason = reason;
    if (action === 'premium') body.days = +days;
    if (action === 'message') body.text = msg;
    const conf = await confirmDialog({
      title: 'تأیید اقدام دسته‌جمعی',
      text: `آیا مطمئن هستید؟ این عمل روی کاربران فیلترشده اعمال می‌شود.`,
      ok: 'تأیید و اجرا',
      danger: true,
    });
    if (!conf) return;
    setBusy(true);
    try {
      const r = await api('/bulk-action', { method: 'POST', body });
      toast(`${fmtNum(r.affected)} کاربر تحت تأثیر قرار گرفت.`, 'ok');
      setPreview(null);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <Card title="فیلتر کاربران" icon="layers">
        <div className="inline-form">
          <Field label="جستجو (نام، @نام کاربری، IP)" value={search} onChange={setSearch} dir="ltr" maxLength={64} />
          <Select label="فیلتر" value={filter} onChange={setFilter} options={FILTERS} />
        </div>
      </Card>

      <Card title="اقدام دسته‌جمعی" icon="zap">
        <div className="bulk-actions">
          {ACTIONS.map(([k, l, ic]) => (
            <button key={k} type="button" className={cx('bulk-btn', action === k && 'active', k === 'ban' && 'danger')} onClick={() => setAction(k)}>
              <Icon name={ic} /><span>{l}</span>
            </button>
          ))}
        </div>
        {action === 'ban' && <Field label="دلیل مسدودسازی" value={reason} onChange={setReason} maxLength={200} />}
        {action === 'premium' && <Field label="تعداد روز پریمیوم" value={String(days)} onChange={(v) => setDays(+v || 0)} type="number" dir="ltr" />}
        {action === 'message' && <Field label="متن پیام" value={msg} onChange={setMsg} textarea rows={3} maxLength={4000} />}
        <div className="form-foot">
          <Button kind="danger" icon={curAction?.[2]} loading={busy} onClick={run}>اجرا</Button>
        </div>
      </Card>

      <Card title="راهنما" icon="info">
        <ul className="help-list">
          <li><Icon name="alert" />اقدامات دسته‌جمعی روی همه کاربران منطبق با فیلتر اعمال می‌شود.</li>
          <li><Icon name="shield" />حساب‌های سیستمی از اقدامات مستثنی هستند.</li>
          <li><Icon name="scroll" />تمام اقدامات در گزارش ممیزی ثبت می‌شوند.</li>
          <li><Icon name="clock" />پیام دسته‌جمعی ممکن است برای تعداد زیاد زمان ببرد.</li>
        </ul>
      </Card>
    </div>
  );
}
