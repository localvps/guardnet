'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, screen, session, shell, dialog, ipcMain, nativeTheme, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_ID = 'ir.guardnet.desktop';
const SCHEME = 'guardnet';
const DEFAULT_BASE = 'https://xxxxxx';

const argv = process.argv.slice(1);
const flag = (name, def) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};
const SMOKE = argv.includes('--smoke');
const SMOKE_OUT = String(flag('smoke-out', 'smoke.png'));
const SMOKE_JSON = String(flag('smoke-json', 'smoke-result.json'));
const TRACE = String(flag('smoke-trace', ''));
const trace = (m) => { if (TRACE) { try { fs.appendFileSync(TRACE, `${new Date().toISOString()} ${m}\n`); } catch { /* */ } } };
trace(`boot argv=${JSON.stringify(argv.slice(0, 4))}`);

const asset = (file) => (app.isPackaged ? path.join(process.resourcesPath, file) : path.join(__dirname, 'build', file));

function serverBase() {
  const cli = flag('app', null);
  const env = process.env.GN_SERVER;
  const raw = (typeof cli === 'string' && cli) || env || DEFAULT_BASE;
  return raw.replace(/\/+$/, '');
}

const kernel = os.release();                    // 6.1=Win7 6.2=Win8 6.3=Win8.1 10.x=Win10/11
const isWin7 = process.platform === 'win32' && kernel.startsWith('6.1');
const isWin8 = process.platform === 'win32' && (kernel.startsWith('6.2') || kernel.startsWith('6.3'));
const kernelBuild = Number((kernel.match(/(\d+)/) || [])[1] || 0);
const nativePicker = process.platform === 'win32' && kernel.startsWith('10.0') && kernelBuild >= 17134;
const base = serverBase();

let win = null;
let tray = null;
let quitting = false;
let settings = { bounds: null, zoom: 1, minimizedToTray: true };
let displayMedia = { ok: null, note: 'not probed (smoke test only)' };

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(statePath(), 'utf8'))); } catch { /* first run */ }
}
let saveTimer = null;
function saveSettings() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
      settings.bounds = win.getNormalBounds();
    }
    try { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(settings)); } catch { /* */ }
  }, 400);
}

// Chromium switches only take effect before the app is ready. Windows occlusion
// culling stops painting a hidden window, which breaks minimise-to-tray.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (isWin7 || isWin8) app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv2) => {
    const deep = argv2.find((a) => a.startsWith(`${SCHEME}://`));
    if (deep) handleDeepLink(deep);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

protocolReady();

function protocolReady() {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

app.on('ready', () => {
  app.setAppUserModelId(APP_ID);

  trace('ready');
  loadSettings();
  setupSession();
  buildTray();
  createWindow();
  buildMenu();
  if (SMOKE) probeDesktopCapture();
  nativeTheme.themeSource = 'dark';
  app.on('activate', () => { if (win) win.show(); });
});

function createWindow() {
  const b = settings.bounds || {};
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = {
    width: Math.min(b.width || 1280, area.width),
    height: Math.min(b.height || 840, area.height),
    x: Number.isFinite(b.x) ? Math.min(Math.max(b.x, area.x), area.x + area.width - 120) : undefined,
    y: Number.isFinite(b.y) ? Math.min(Math.max(b.y, area.y), area.y + area.height - 60) : undefined,
  };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 460,
    show: false,
    backgroundColor: '#0e1621',
    autoHideMenuBar: true,
    title: 'GuardNet',
    icon: asset('icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      backgroundThrottling: true,
    },
  });

  win.loadURL(base + '/');
  win.once('ready-to-show', () => {
    if (settings.bounds && (settings.bounds.width || settings.bounds.height)) {
      if (settings.bounds.maximized) win.maximize();
    }
    win.show();
    if (settings.zoom && settings.zoom !== 1) win.webContents.setZoomFactor(settings.zoom);
  });

  win.on('resize', saveSettings);
  win.on('move', saveSettings);
  win.on('maximize', saveSettings);
  win.on('close', (e) => {
    if (!quitting && settings.minimizedToTray && tray) {
      e.preventDefault();
      win.hide();
    } else saveSettings();
  });
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${SCHEME}://`)) handleDeepLink(url);
    else if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!sameOrigin(url)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (settings.zoom && settings.zoom !== 1) win.webContents.setZoomFactor(settings.zoom);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    if (SMOKE) { console.error('render-process-gone', JSON.stringify(details)); }
    else if (details.reason === 'crashed') dialog.showErrorBox('GuardNet', 'نمایشگر برنامه با خطا بسته شد. لطفاً دوباره اجرا کنید.');
  });
}

function sameOrigin(url) {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

function setupSession() {
  const ses = session.defaultSession;
  // Calls, screen sharing and notifications are the whole point of the client:
  // they must never be blocked by a permission prompt the user cannot answer.
  ses.setPermissionRequestHandler((_wc, perm, cb) => {
    if (['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(perm)) return cb(true);
    cb(false);
  });
  ses.setPermissionCheckHandler((_wc, perm) => ['media', 'display-capture', 'notifications', 'fullscreen'].includes(perm));
}

// Electron 21 has no setDisplayMediaRequestHandler (that landed in 22): granting
// the display-capture permission is enough, Electron shows its own screen picker.
// The probe is only used by the --smoke self-test to report capture availability.
async function probeDesktopCapture(timeoutMs = 6000) {
  displayMedia = await Promise.race([
    desktopCapturer.getSources({ types: ['screen'] })
      .then((s) => ({ ok: s.length > 0, count: s.length, first: s.slice(0, 3).map((x) => x.name) }))
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
    new Promise((r) => setTimeout(() => r({ ok: false, error: 'probe timeout' }), timeoutMs)),
  ]);
  trace(`displayMedia probe ${JSON.stringify(displayMedia)}`);
}

function handleDeepLink(url) {
  const tail = url.slice(url.indexOf('://') + 3).replace(/^\/+/, '');
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (tail) win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('guardnet:deeplink',{detail:${JSON.stringify(tail)}}))`).catch(() => {});
}

function buildTray() {
  const img = nativeImage.createFromPath(asset('tray.png')).resize({ width: 16, height: 16 });
  if (img.isEmpty()) { trace('tray image empty - running without tray'); return; }
  tray = new Tray(img);
  tray.setToolTip('GuardNet');
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) win.hide(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'باز کردن GuardNet', click: () => { if (win) { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: 'ورود به نسخهٔ وب', click: () => shell.openExternal(base) },
    { type: 'separator' },
    { label: 'خروج', click: () => { quitting = true; app.quit(); } },
  ]));
}

function buildMenu() {
  const t = {
    back: 'برگشت', fwd: 'جلو', reload: 'بارگذاری مجدد', home: 'خانه',
    zoomin: 'بزرگ‌نمایی', zoomout: 'کوچک‌نمایی', zoomreset: 'اندازهٔ اصلی',
    cut: 'برش', copy: 'کپی', paste: 'چسباندن', selectall: 'انتخاب همه',
    minimize: 'کمینه کردن', maximize: 'بزرگ کردن', close: 'بستن', quit: 'خروج',
  };
  const tpl = [
    {
      label: 'فایل',
      submenu: [
        { label: t.home, accelerator: 'CmdOrCtrl+Shift+H', click: () => win && win.loadURL(base + '/') },
        { label: t.reload, accelerator: 'F5', click: () => win && win.webContents.reload() },
        { type: 'separator' },
        { label: t.quit, accelerator: 'Alt+F4', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: 'ویرایش',
      submenu: [
        { role: 'cut', label: t.cut },
        { role: 'copy', label: t.copy },
        { role: 'paste', label: t.paste },
        { role: 'selectAll', label: t.selectall },
      ],
    },
    {
      label: 'نمایش',
      submenu: [
        { label: t.zoomin, accelerator: 'CmdOrCtrl+Plus', click: () => setZoom(0.1) },
        { label: t.zoomout, accelerator: 'CmdOrCtrl+-', click: () => setZoom(-0.1) },
        { label: t.zoomreset, accelerator: 'CmdOrCtrl+0', click: () => setZoom(0, true) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'تمام‌صفحه', accelerator: 'F11' },
        { type: 'separator' },
        { role: 'minimize', label: t.minimize },
        { role: 'close', label: t.close, accelerator: 'CmdOrCtrl+W' },
      ],
    },
    {
      label: 'راهنما',
      submenu: [
        { label: 'باز کردن نسخهٔ وب', click: () => shell.openExternal(base) },
        {
          label: 'دربارهٔ GuardNet',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'دربارهٔ GuardNet',
            message: `GuardNet نسخهٔ دسکتاپ ویندوز\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n${process.arch === 'ia32' ? '۳۲ بیتی' : '۶۴ بیتی'} · ویندوز ${os.release()}`,
          }),
        },
        {
          label: 'بازگشت به تنظیمات کارخانهٔ نمایش',
          click: () => { settings = { bounds: settings.bounds, zoom: 1, minimizedToTray: true }; setZoom(0, true); },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function setZoom(delta, reset) {
  if (!win) return;
  const next = reset ? 1 : Math.min(3, Math.max(0.5, win.webContents.getZoomFactor() + delta));
  settings.zoom = next;
  win.webContents.setZoomFactor(next);
  saveSettings();
}

ipcMain.handle('gn:info', () => ({
  platform: process.platform,
  arch: process.arch,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  os: { release: os.release(), name: isWin7 ? 'Windows 7' : isWin8 ? 'Windows 8/8.1' : 'Windows 10/11', nativePicker },
  base,
}));

if (SMOKE) {
  const writeResult = (obj) => {
    const line = 'SMOKE_JSON ' + JSON.stringify(obj);
    console.log(line);
    try { fs.writeFileSync(SMOKE_JSON, JSON.stringify(obj, null, 1)); } catch { /* */ }
  };
  app.on('ready', () => {
    win.webContents.on('console-message', (_e, _lvl, msg) => console.log('[page]', msg));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[fail-load]', code, desc, url));
    win.webContents.once('did-finish-load', async () => {
      trace('did-finish-load ' + base);
      await new Promise((r) => setTimeout(r, 6000));
      const probe = await win.webContents.executeJavaScript(`(async () => {
        const out = { url: location.href, title: document.title, gdm: typeof navigator.mediaDevices.getDisplayMedia };
        try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); out.gum = s.getVideoTracks().length + ' track(s)'; } catch (e) { out.gum = 'ERR ' + e.name; }
        try { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); pc.createDataChannel('t'); await pc.setLocalDescription(await pc.createOffer()); pc.addTransceiver('video'); await pc.setLocalDescription(await pc.createOffer()); out.rtc = pc.localDescription.sdp.includes('m=video'); pc.close(); } catch (e) { out.rtc = 'ERR ' + e.name; }
        return out;
      })()`).catch((e) => ({ probeError: String(e) }));
      const img = await win.webContents.capturePage().catch(() => null);
      if (img) { try { fs.writeFileSync(SMOKE_OUT, img.toPNG()); } catch { /* */ } }
      writeResult({
        electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
        arch: process.arch, platform: process.platform, os: kernel, isWin7, nativePicker,
        base, screenshot: img ? SMOKE_OUT : null, displayMedia, ...probe,
      });
      app.exit(0);
    });
    setTimeout(() => { trace('smoke timeout'); writeResult({ error: 'timeout', url: win && !win.isDestroyed() ? win.webContents.getURL() : null }); app.exit(2); }, 90000);
  });
}

app.on('window-all-closed', () => { app.quit(); });