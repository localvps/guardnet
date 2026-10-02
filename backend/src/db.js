import Database from 'better-sqlite3';
import { DB_PATH } from './config.js';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('secure_delete = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE COLLATE NOCASE NOT NULL,
  name TEXT NOT NULL, bio TEXT DEFAULT '', color TEXT, avatar TEXT,
  pass_hash TEXT, totp_secret TEXT, totp_on INTEGER DEFAULT 0, totp_pending TEXT,
  created_at INTEGER, last_seen INTEGER, premium_until INTEGER DEFAULT 0, trial_used INTEGER DEFAULT 0,
  emoji_status TEXT, privacy TEXT DEFAULT '{}', settings TEXT DEFAULT '{}',
  is_bot INTEGER DEFAULT 0, verified INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0, ban_reason TEXT, banned_at INTEGER, reg_ip TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE NOT NULL, token_enc TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device TEXT, ip TEXT, visitor TEXT, remember INTEGER DEFAULT 0, created_at INTEGER, last_active INTEGER);
CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sess_visitor ON sessions(visitor);
CREATE TABLE IF NOT EXISTS contacts(owner INTEGER, contact INTEGER, created_at INTEGER, PRIMARY KEY(owner, contact));
CREATE TABLE IF NOT EXISTS blocks(owner INTEGER, blocked INTEGER, created_at INTEGER, PRIMARY KEY(owner, blocked));
CREATE TABLE IF NOT EXISTS chats(
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, title TEXT, description TEXT DEFAULT '',
  username TEXT UNIQUE COLLATE NOCASE, photo TEXT, color TEXT, owner_id INTEGER, invite TEXT UNIQUE,
  pkey TEXT UNIQUE, is_public INTEGER DEFAULT 0, created_at INTEGER, frozen INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS members(
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE, user_id INTEGER, role TEXT DEFAULT 'member',
  joined_at INTEGER, last_read INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0, cleared INTEGER DEFAULT 0, draft TEXT DEFAULT '', mark_unread INTEGER DEFAULT 0,
  left INTEGER DEFAULT 0, PRIMARY KEY(chat_id, user_id));
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE, sender_id INTEGER,
  type TEXT, text TEXT DEFAULT '', data TEXT DEFAULT '{}', reply_to INTEGER, fwd TEXT,
  created_at INTEGER, edited_at INTEGER, deleted INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
  sched_at INTEGER, silent INTEGER DEFAULT 0, ttl INTEGER DEFAULT 0, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_sched ON messages(sched_at);
CREATE TABLE IF NOT EXISTS hidden(msg_id INTEGER, user_id INTEGER, PRIMARY KEY(msg_id, user_id));
CREATE TABLE IF NOT EXISTS reactions(msg_id INTEGER, user_id INTEGER, emoji TEXT, at INTEGER, PRIMARY KEY(msg_id, user_id));
CREATE TABLE IF NOT EXISTS votes(msg_id INTEGER, user_id INTEGER, opt INTEGER, PRIMARY KEY(msg_id, user_id, opt));
CREATE TABLE IF NOT EXISTS views(msg_id INTEGER, user_id INTEGER, PRIMARY KEY(msg_id, user_id));
CREATE TABLE IF NOT EXISTS files(
  id TEXT PRIMARY KEY, owner INTEGER, name TEXT, mime TEXT, size INTEGER, received INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS stories(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT, data TEXT, created_at INTEGER, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS story_views(story_id INTEGER, user_id INTEGER, at INTEGER, reaction TEXT, PRIMARY KEY(story_id, user_id));
CREATE TABLE IF NOT EXISTS calls(
  id INTEGER PRIMARY KEY AUTOINCREMENT, caller INTEGER, callee INTEGER, video INTEGER, started_at INTEGER,
  answered_at INTEGER, ended_at INTEGER, status TEXT);
CREATE TABLE IF NOT EXISTS qr_logins(
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE, code TEXT UNIQUE, status TEXT DEFAULT 'pending',
  ip TEXT, ua TEXT, visitor TEXT, remember INTEGER DEFAULT 1, created_at INTEGER, expires_at INTEGER,
  user_id INTEGER, session_token_enc TEXT);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, reporter INTEGER, kind TEXT, target_id INTEGER, chat_id INTEGER,
  reason TEXT, note TEXT, snapshot TEXT, status TEXT DEFAULT 'open', created_at INTEGER,
  resolved_by INTEGER, resolved_at INTEGER, resolution TEXT);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, id);
CREATE TABLE IF NOT EXISTS login_attempts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT, username TEXT, ip TEXT, ua TEXT, ok INTEGER, reason TEXT, at INTEGER);
CREATE INDEX IF NOT EXISTS idx_la ON login_attempts(scope, at);

CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE COLLATE NOCASE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer', totp_enc TEXT, totp_pending_enc TEXT, totp_on INTEGER DEFAULT 0,
  must_change INTEGER DEFAULT 1, disabled INTEGER DEFAULT 0, fails INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0,
  created_at INTEGER, created_by INTEGER, last_login INTEGER, last_ip TEXT, pw_changed_at INTEGER,
  recovery_enc TEXT);
CREATE TABLE IF NOT EXISTS admin_sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT UNIQUE NOT NULL, admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, ip TEXT, ua TEXT, created_at INTEGER, last_active INTEGER, expires_at INTEGER, reauth_at INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, admin_name TEXT, action TEXT, target TEXT, detail TEXT,
  ip TEXT, at INTEGER, prev_hash TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS security_settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS ip_blocks(ip TEXT PRIMARY KEY, reason TEXT, created_at INTEGER, created_by INTEGER, expires_at INTEGER);
`);

// Migrations for existing databases
try { db.exec('ALTER TABLE messages ADD COLUMN ttl INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER'); } catch {}

const cache = new Map();
const prep = (sql) => {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
};
const norm = (args) => args.map((a) => (typeof a === 'boolean' ? (a ? 1 : 0) : a === undefined ? null : a));
/** all rows */
export const q = (sql, ...args) => prep(sql).all(...norm(args));
/** first row */
export const q1 = (sql, ...args) => prep(sql).get(...norm(args));
/** scalar */
export const qv = (sql, ...args) => { const r = prep(sql).raw(true).get(...norm(args)); prep(sql).raw(false); return r ? r[0] : undefined; };
/** execute → lastInsertRowid */
export const ex = (sql, ...args) => Number(prep(sql).run(...norm(args)).lastInsertRowid);
export const run = (sql, ...args) => prep(sql).run(...norm(args)).changes;
export const tx = (fn) => db.transaction(fn)();
export const now = () => Date.now();
export const likeEsc = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
