import { useState } from 'react';
import { api } from '../api.js';
import { useLive } from '../live.js';
import { Card, Icon, Button, Field, Toggle, toast, confirmDialog, fa, fmtNum } from '../ui.jsx';

export default function Broadcast() {
  const [text, setText] = useState(''); const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false); const [last, setLast] = useState(null);
  const s = useLive((x) => x.stats);
  const send = async () => {
    const t = text.trim(); if (!t) { toast('متن اطلاعیه را بنویسید.', 'error'); return; }
    const n = online ? s?.online : s?.users;
    if (!(await confirmDialog({ title: 'ارسال اطلاعیه همگانی', text: `این پیام از طرف حساب رسمی GuardNet برای ${n != null ? fmtNum(n) : 'همه'} کاربر ارسال می‌شود. ادامه می‌دهید؟`, ok: 'ارسال' }))) return;
    setBusy(true);
    try { const r = await api('/broadcast', { method: 'POST', body: { text: t, online_only: online } }); setLast(r.recipients); setText(''); toast(`اطلاعیه برای ${fa(r.recipients)} کاربر ارسال شد.`, 'ok'); } catch (e) { if (e.status !== 428) toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <Card title="اطلاعیه همگانی" icon="megaphone">
        <p className="muted">پیام در گفتگوی «GuardNet» هر کاربر با تیک تأیید رسمی نمایش داده می‌شود و به‌صورت زنده می‌رسد. این عملیات نیازمند تأیید دوباره هویت است و در گزارش ممیزی ثبت می‌شود.</p>
        <Field label="متن اطلاعیه" value={text} onChange={setText} textarea rows={6} maxLength={4000} hint={`${fa(text.length)} از ${fa(4000)} نویسه`} />
        <div className="row-line"><div><b>فقط کاربران آنلاین</b><span className="muted">{s ? `${fmtNum(s.online)} کاربر هم‌اکنون آنلاین هستند` : ''}</span></div><Toggle checked={online} onChange={setOnline} label="فقط کاربران آنلاین" /></div>
        {text.trim() && <div className="preview-msg"><span className="pm-head"><Icon name="verified" />GuardNet</span><p dir="auto">{text}</p></div>}
        <Button icon="send" loading={busy} onClick={send} className="full">ارسال اطلاعیه</Button>
        {last != null && <p className="muted center-t">آخرین ارسال: {fa(last)} گیرنده</p>}
      </Card>
    </div>
  );
}
