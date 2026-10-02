import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = path.resolve(process.env.GUARDNET_DATA_DIR || path.join(ROOT, 'data'));
export const UPLOADS = path.join(DATA_DIR, 'uploads');
export const DB_PATH = path.join(DATA_DIR, 'guardnet.db');
fs.mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });

export const PORT = Number(process.env.PORT || 8000);
export const HOST = process.env.HOST || '0.0.0.0';
/** Serve built frontend/admin bundles from the backend (production single-origin mode). */
export const FRONTEND_DIST = process.env.FRONTEND_DIST || path.resolve(ROOT, '..', 'frontend', 'dist');
export const ADMIN_DIST = process.env.ADMIN_DIST || path.resolve(ROOT, '..', 'admin', 'dist');
/** Trust X-Forwarded-For only when explicitly behind a reverse proxy. */
export const TRUST_PROXY = process.env.TRUST_PROXY !== '0';

export const BRAND = 'GuardNet';
export const OFFICIAL_USERNAME = 'guardnet';
export const BOT_USERNAME = 'GuardNetBot';

export const MB = 1024 * 1024;
export const LIMITS = {
  free: { upload: 20 * MB, bio: 70, pins: 5, folders: 5, story_hours: 24 },
  premium: { upload: 200 * MB, bio: 300, pins: 20, folders: 15, story_hours: 48 },
};
export const CHUNK = 4 * MB;
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
export const COLORS = [
  ['#4f8cff', '#8b5cf6'], ['#8b5cf6', '#ec4899'], ['#ec4899', '#f97316'], ['#10b981', '#06b6d4'],
  ['#f59e0b', '#ef4444'], ['#06b6d4', '#3b82f6'], ['#ef4444', '#a855f7'], ['#22c55e', '#15803d'],
];
export const PREMIUM_STICKERS = new Set(['🦄', '🐉', '🌋', '💎', '👑', '🪐', '🧞', '🦚', '🎆', '🌌', '🫧', '🪄']);
export const STICKER_PACK_SIZES = { 1: 94, 2: 100, 3: 88 };
export const GIF_COUNT = 16;
export const MSG_TYPES = new Set(['text', 'image', 'video', 'file', 'voice', 'sticker', 'gif', 'poll', 'location', 'contact']);
export const DEFAULT_PRIVACY = { lastSeen: 'all', photo: 'all', calls: 'all', groups: 'all', forwards: 'all', readReceipts: true };

/** Security defaults — every value is editable at runtime from the admin panel (security_settings table). */
export const SECURITY_DEFAULTS = {
  registration_open: true,
  password_min: 8,
  password_require_mix: false,
  user_max_fails: 8,
  user_lock_minutes: 5,
  admin_max_fails: 5,
  admin_lock_minutes: 15,
  admin_idle_minutes: 15,
  admin_absolute_hours: 8,
  admin_ip_allowlist: '',
  max_sessions_per_user: 30,
  message_rate_per_min: 60,
};
