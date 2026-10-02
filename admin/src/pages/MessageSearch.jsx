import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Icon, Spinner, Badge, Empty, Pager, fa, fmtDate, cx } from '../ui.jsx';

export default function MessageSearch() {
  const [q, setQ] = useState('');
  const [committed, setCommitted] = useState('');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const search = async (query, p = 1) => {
    if (!query || query.length < 2) return;
    setLoading(true);
    try {
      const r = await api(`/search/messages?q=${encodeURIComponent(query)}&page=${p}`);
      setData(r);
    } catch (e) { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (committed) search(committed, page); }, [page]);

  const submit = (e) => { e.preventDefault(); setCommitted(q); setPage(1); search(q, 1); };

  return (
    <div className="page">
      <Card title="جستجوی سراسری پیام‌ها" icon="search">
        <form onSubmit={submit} className="search-bar">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="متن پیام را بنویسید…" dir="auto" autoFocus maxLength={200} />
          <button type="submit" className="btn sm" disabled={loading || q.length < 2}>جستجو</button>
        </form>
        {committed && <div className="search-meta"><span>جستجو برای: <b dir="auto">{committed}</b></span></div>}
      </Card>

      {loading && <div className="center sm"><Spinner /></div>}
      {data && !loading && (
        data.items.length === 0 ? <Empty icon="search" title="نتیجه‌ای یافت نشد" sub="پیامی مطابق جستجوی شما پیدا نشد." /> : (
          <Card title={`${fa(data.total)} نتیجه`} icon="message" pad={false}>
            <ul className="feed">
              {data.items.map((m) => (
                <li key={m.id}>
                  <span className="f-ic blue"><Icon name="message" /></span>
                  <div className="search-result">
                    <b>{m.sender_name || 'ناشناس'} <span dir="ltr">@{m.username}</span></b>
                    <span className="search-chat">{m.chat_title || `گفتگو #${m.chat_id}`} · {m.chat_type === 'group' ? 'گروه' : m.chat_type === 'channel' ? 'کانال' : 'خصوصی'}</span>
                    <div className="search-text" dir="auto">{m.text}</div>
                  </div>
                  <time>{fmtDate(m.created_at)}</time>
                </li>
              ))}
            </ul>
            {data.total > data.size && <Pager page={data.page} size={data.size} total={data.total} onPage={setPage} />}
          </Card>
        )
      )}
    </div>
  );
}
