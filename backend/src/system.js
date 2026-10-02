import crypto from 'node:crypto';
import { q, q1, qv, ex, run, now } from './db.js';
import { hub } from './realtime/hub.js';
import { COLORS, DEFAULT_PRIVACY, OFFICIAL_USERNAME, BOT_USERNAME } from './config.js';
import { getOrCreatePrivate, deliverMessage, insertMessage, rowUser, isPremium, releaseScheduled } from './domain.js';

function ensureSystem() {
  const list = [
    [OFFICIAL_USERNAME, 'GuardNet', 'حساب رسمی GuardNet — اعلان‌های امنیتی، اطلاعیه‌ها و خوش‌آمدگویی', 0, COLORS[0]],
    [BOT_USERNAME, 'دستیار GuardNet', 'ربات رسمی GuardNet. برای دیدن دستورها /help را بفرستید.', 1, COLORS[3]],
  ];
  for (const [u, n, b, bot, col] of list) {
    if (!q1('SELECT 1 FROM users WHERE username=?', u)) {
      ex('INSERT INTO users(username,name,bio,color,created_at,last_seen,is_bot,verified,privacy) VALUES(?,?,?,?,?,?,?,1,?)',
        u, n, b, JSON.stringify(col), now(), now(), bot, JSON.stringify(DEFAULT_PRIVACY));
    }
  }
}
ensureSystem();
export const OFFICIAL_ID = q1('SELECT id FROM users WHERE username=?', OFFICIAL_USERNAME).id;
export const BOT_ID = q1('SELECT id FROM users WHERE username=?', BOT_USERNAME).id;

export function systemMessage(to, text, sender = OFFICIAL_ID) {
  const cid = getOrCreatePrivate(sender, to);
  const mid = insertMessage(cid, sender, 'text', text);
  deliverMessage(mid);
  return mid;
}

const JOKES = [
  'برنامه‌نویس به کافه میره، میگه یه قهوه بدین. میپرسن شکر؟ میگه: nullable باشه 😄',
  'چرا برنامه‌نویس‌ها شب کار می‌کنن؟ چون روز پر از باگه ☀️🐛',
  'دو نوع آدم هست: اونایی که بک‌آپ می‌گیرن و اونایی که هنوز فایلشون پاک نشده 💾',
  'CSS مثل عشقه؛ هیچ‌وقت دقیقاً جایی که می‌خوای وسط نمی‌ایسته 😅',
  'رمز عبورم رو گذاشتم «اشتباه». هر وقت یادم بره، سیستم خودش میگه: رمز شما اشتباه است 🔐',
];
const QUOTES = [
  '«سادگی، نهایت پیچیدگی است.» — لئوناردو داوینچی',
  '«بهترین راه پیش‌بینی آینده، ساختن آن است.» — آلن کِی',
  '«کیفیت یک عمل نیست؛ یک عادت است.» — ارسطو',
  '«امنیت یک محصول نیست، یک فرایند است.» — بروس اشنایر',
];
const KB = [['🎲 تاس', '/dice'], ['😂 جوک', '/joke'], ['🕐 ساعت', '/time'], ['💡 نقل‌قول', '/quote'], ['📊 آمار', '/stats'], ['🪪 شناسه من', '/id']];
const pick = (a) => a[crypto.randomInt(a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export async function botHandle(cid, uid, text) {
  await sleep(300);
  hub.send(uid, 'typing', { chat_id: cid, user_id: BOT_ID, kind: 'text' });
  await sleep(600);
  const t = String(text || '').trim();
  const cmd = (t.split(/\s+/)[0] || '').toLowerCase().replace(/@guardnetbot$/i, '');
  const u = rowUser(uid);
  if (!u) return;
  let reply = ''; let data = {};
  switch (cmd) {
    case '/start': case '/help':
      reply = '🤖 دستورهای من:\n/dice — انداختن تاس (تصادفی امن)\n/joke — یک جوک\n/time — ساعت سرور\n/quote — نقل‌قول\n/stats — آمار زنده سرویس\n/id — اطلاعات حساب شما\n/echo متن — تکرار متن';
      data = { kb: KB }; break;
    case '/dice': {
      const n = crypto.randomInt(1, 7);
      deliverMessage(insertMessage(cid, BOT_ID, 'sticker', '', { e: '🎲' }));
      await sleep(500);
      reply = `عدد شما: **${fa(n)}** ${n === 6 ? '🎉' : ''}`; break;
    }
    case '/joke': reply = pick(JOKES); break;
    case '/quote': reply = pick(QUOTES); break;
    case '/time': reply = `🕐 زمان سرور (UTC): ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`; break;
    case '/stats': {
      const users = qv('SELECT COUNT(*) FROM users WHERE is_bot=0 AND deleted=0 AND pass_hash IS NOT NULL');
      const msgs = qv("SELECT COUNT(*) FROM messages WHERE deleted=0 AND type<>'service'");
      const groups = qv("SELECT COUNT(*) FROM chats WHERE type='group'");
      const chans = qv("SELECT COUNT(*) FROM chats WHERE type='channel'");
      reply = `📊 آمار زنده GuardNet:\n👥 کاربران: ${fa(users)}\n🟢 آنلاین: ${fa(hub.onlineCount())}\n💬 پیام‌ها: ${fa(msgs)}\n👨‍👩‍👧 گروه‌ها: ${fa(groups)}\n📢 کانال‌ها: ${fa(chans)}`;
      break;
    }
    case '/id':
      reply = `🪪 حساب شما:\nشناسه: \`${uid}\`\nنام کاربری: @${u.username}\nعضویت: ${new Date(u.created_at).toISOString().slice(0, 10)}\nپریمیوم: ${isPremium(u) ? 'فعال ⭐' : 'غیرفعال'}`;
      break;
    case '/echo': reply = t.slice(5).trim().slice(0, 1000) || 'چیزی برای تکرار نیست 🙂'; break;
    default: reply = 'این دستور را نمی‌شناسم 🤔 برای دیدن فهرست دستورها /help را بفرستید.'; data = { kb: KB };
  }
  deliverMessage(insertMessage(cid, BOT_ID, 'text', reply, data));
}

/** Delivers due scheduled messages and purges expired data every 3 s. */
export function startScheduler() {
  const tick = () => {
    try {
      const t = now();
      for (const r of q('SELECT id FROM messages WHERE sched_at IS NOT NULL AND sched_at<=? AND deleted=0', t)) {
        releaseScheduled(r.id);
      }
      run('DELETE FROM stories WHERE expires_at<?', t);
      run("DELETE FROM qr_logins WHERE expires_at<? AND status<>'approved'", t - 60e3);
      run('DELETE FROM qr_logins WHERE expires_at<?', t - 300e3);
      run('DELETE FROM admin_sessions WHERE expires_at<?', t);
    } catch (e) { console.error('scheduler', e); }
  };
  setInterval(tick, 3000).unref();
  // prune old login attempts daily (keep 90 days)
  setInterval(() => run('DELETE FROM login_attempts WHERE at<?', now() - 90 * 86400e3), 86400e3).unref();
}
