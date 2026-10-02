import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PORT, HOST, FRONTEND_DIST, ADMIN_DIST, BRAND } from './config.js';
import { securityHeaders, clientIp } from './lib/security.js';
import { ipBlocked } from './lib/settings.js';
import { router as authRouter } from './routes/auth.js';
import { router as meRouter } from './routes/me.js';
import { router as socialRouter } from './routes/social.js';
import { router as chatsRouter, inviteRouter } from './routes/chats.js';
import { chatScoped, router as messagesRouter } from './routes/messages.js';
import { files, serveFile, stories, calls } from './routes/media.js';
import { router as adminAuth } from './admin/auth.js';
import { router as adminApi } from './admin/api.js';
import { bootstrapAdmin } from './admin/session.js';
import { attachWs } from './realtime/ws.js';
import { startScheduler } from './system.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);

// CORS: bearer-token API (no cookies), so any origin may call it safely.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Visitor-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// global IP blocklist
app.use((req, res, next) => {
  const b = ipBlocked(clientIp(req));
  if (b) return res.status(403).json({ error: 'دسترسی از این شبکه توسط مدیریت GuardNet مسدود شده است.', code: 'ip_blocked' });
  next();
});

const json = express.json({ limit: '512kb' });
app.use('/api', (req, res, next) => (req.method === 'PUT' && req.path.startsWith('/files/') ? next() : json(req, res, next)));
app.use('/admin-api', express.json({ limit: '64kb' }));
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/admin-api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY'); next(); });

// Device identifier for "keep me signed in": the hosting proxy may inject X-Visitor-Id; otherwise we
// fall back to an HttpOnly, SameSite=Strict cookie scoped to /api/auth (never readable by page scripts).
app.use('/api/auth', (req, res, next) => {
  if (!req.headers['x-visitor-id']) {
    const m = /(?:^|;\s*)gn_vid=([A-Za-z0-9_-]{20,64})/.exec(req.headers.cookie || '');
    let vid = m ? m[1] : null;
    if (!vid) {
      vid = crypto.randomBytes(24).toString('base64url');
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `gn_vid=${vid}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`);
    }
    req.headers['x-visitor-id'] = 'c:' + vid;
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, name: BRAND, time: Date.now() }));
app.use('/api/auth', authRouter);
app.use('/api', meRouter);
app.use('/api', socialRouter);
app.use('/api/chats', chatScoped);
app.use('/api/chats', chatsRouter);
app.use('/api/invite', inviteRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/files', files);
app.use('/api/stories', stories);
app.use('/api/calls', calls);
app.get('/files/:fid', serveFile);
app.use('/admin-api/auth', adminAuth);
app.use('/admin-api', adminApi);
app.use(['/api', '/admin-api'], (req, res) => res.status(404).json({ error: 'مسیر یافت نشد.' }));

// Optional single-origin production mode: serve built bundles when present.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; form-action 'self'";
function spa(mount, dir, frameAncestors) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) return;
  app.use(mount, express.static(dir, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(mount === '/' ? /^\/(?!api|admin-api|files|ws|admin).*/ : new RegExp(`^${mount}(/.*)?$`), (req, res) => {
    res.setHeader('Content-Security-Policy', `${CSP}; frame-ancestors ${frameAncestors}`);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dir, 'index.html'));
  });
  console.log(`[${BRAND}] serving ${mount} from ${dir}`);
}
spa('/admin', ADMIN_DIST, "'none'");
spa('/', FRONTEND_DIST, "'self'");

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'حجم درخواست بیش از حد مجاز است.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'بدنه درخواست نامعتبر است.' });
  console.error(err);
  res.status(500).json({ error: 'خطای داخلی سرور.' });
});

const server = http.createServer(app);
server.headersTimeout = 30e3;
server.requestTimeout = 120e3;
attachWs(server);
startScheduler();
await bootstrapAdmin();
server.listen(PORT, HOST, () => console.log(`[${BRAND}] backend listening on http://${HOST}:${PORT}`));

const shutdown = () => { console.log(`[${BRAND}] shutting down`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
