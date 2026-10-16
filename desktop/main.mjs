import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, globalShortcut, screen, dialog, powerSaveBlocker, shell } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings, validatedSettings, loadSettings } from './preferences.mjs';
import { desktopLabels } from './locale.mjs';
import { windowAvailable, showController, releaseOverlay, setOverlayInput } from './window-actions.mjs';
import { createCaptureActions } from './capture-actions.mjs';

app.setName('kotonoha');
if (process.env.KOTONOHA_TEST_PROFILE) app.setPath('userData', process.env.KOTONOHA_TEST_PROFILE);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? JSON.parse(readFileSync(path.join(process.resourcesPath, 'runtime.json'), 'utf8')).root : path.resolve(here, '..');
const token = randomBytes(32).toString('hex');
const port = Number(process.env.KOTONOHA_TEST_PORT || 8765);
if (![8765, 8767].includes(port)) throw new Error('Unsupported local service port');
const base = `http://127.0.0.1:${port}`;
let controller, overlay, tray, backend, socket, quitting = false, backendError = '', blocker;
let latest = null;
let state = 'stopped';
let locked = true;
let history = [];
let settings = { ...defaultSettings };
let preferencesPath;
const text = () => desktopLabels(settings.uiLanguage);

function broadcast(event) {
  for (const win of [controller, overlay]) if (win && !win.isDestroyed()) win.webContents.send('live:event', event);
}
function statusEvent(event) {
  if (event.type === 'status') {
    state = event.state;
    if (state === 'starting' || state === 'stopped') setOverlay(false);
    if (state === 'listening' && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if (state === 'stopped' && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
  }
  if (event.type === 'error') {
    releaseOverlay(overlay);
    showController(controller, { quitting, focus: false });
    broadcast({ type: 'overlay', visible: false, locked: true });
    locked = true;
  }
  if (event.type === 'subtitle') {
    if (state === 'listening') setOverlay(true);
    latest = { ...event, receivedAt: Date.now() };
    history = [...history.slice(-999), latest];
    event = latest;
  }
  broadcast(event);
}
function assertSender(event) {
  if (![controller?.webContents, overlay?.webContents].includes(event.sender)) throw new Error('Unknown sender');
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'file:' || path.resolve(fileURLToPath(url)) !== path.resolve(here, '../dist/index.html')) throw new Error('Unexpected frame');
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => { assertSender(event); return fn(...args); });
}
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}
function openController() { return showController(controller, { quitting }); }
function setLocked(value) {
  if (!windowAvailable(overlay, quitting)) return;
  locked = !!value;
  setOverlayInput(overlay, locked);
  broadcast({ type: 'overlay', visible: overlay.isVisible(), locked });
  refreshTray();
}
function setOverlay(value) {
  if (!windowAvailable(overlay, quitting)) return;
  if (value) overlay.showInactive();
  else { locked = true; releaseOverlay(overlay); }
  broadcast({ type: 'overlay', visible: overlay.isVisible(), locked });
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text().showControls, click: openController },
    { label: text().showSubtitles, type: 'checkbox', checked: windowAvailable(overlay, quitting) && overlay.isVisible(), click: (item) => setOverlay(item.checked) },
    { label: text().clickThrough, type: 'checkbox', checked: locked, click: (item) => setLocked(item.checked) },
    { type: 'separator' },
    { label: text().stop, click: () => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'stop' })) },
    { label: text().quit, role: 'quit' }
  ]));
}
function refreshNativeUI() {
  const t = text();
  refreshTray();
  tray?.setToolTip(t.tagline);
  if (windowAvailable(overlay, quitting)) overlay.setTitle(t.subtitleTitle);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'kotonoha', submenu: [{ role: 'about', label: t.about }, { type: 'separator' }, { label: t.showControls, accelerator: 'Command+Shift+K', click: openController }, { label: t.toggleClickThrough, accelerator: 'Command+Shift+L', click: () => setLocked(!locked) }, { type: 'separator' }, { role: 'quit', label: t.quit }] },
    { label: t.edit, submenu: ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map((role) => ({ role, label: t[role] })) },
    { label: t.window, submenu: [{ role: 'minimize', label: t.minimize }, { role: 'zoom', label: t.zoom }, { role: 'front', label: t.bringAllToFront }] }
  ]));
}
async function waitForBackend() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) throw new Error(backendError || text().backendExited);
    try {
      const result = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
      if (result.ok) return;
      if (result.status === 401 || result.status === 403) throw Object.assign(new Error(text().portBusy), { code: 'PORT_IN_USE' });
    } catch (error) { if (error.code === 'PORT_IN_USE') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(backendError || text().pythonStartup);
}
const ready = { promise: null };
const captureActions = createCaptureActions({
  requestPermission: async () => {
    await ready.promise;
    // Active capture already has access; a second permission request must not interrupt it.
    const active = state !== 'stopped';
    const response = await fetch(`${base}${active ? '/api/status' : '/api/capture/permission'}`, {
      method: active ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': settings.uiLanguage },
      signal: AbortSignal.timeout(70000),
    });
    if (!response.ok) throw new Error(`${text().readiness} (${response.status})`);
    const result = await response.json();
    return active ? result.capture : result;
  },
  start: async () => {
    if (quitting || state !== 'stopped') return;
    await connect();
    if (quitting || state !== 'stopped') return;
    setLocked(true); setOverlay(false); latest = null; broadcast({ type: 'clear' });
    statusEvent({ type: 'status', state: 'starting' });
    try {
      socket.send(JSON.stringify({ type: 'start', source: settings.source, target: settings.target, ui_language: settings.uiLanguage }));
    } catch (error) {
      statusEvent({ type: 'status', state: 'stopped' });
      throw error;
    }
  },
});
async function connect() {
  await ready.promise;
  if (socket?.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    socket = new WebSocket(`ws://127.0.0.1:${port}/api/live?token=${token}`);
    const timer = setTimeout(() => { socket.close(); reject(new Error(text().socketTimeout)); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(text().socketError)); }, { once: true });
    socket.addEventListener('message', ({ data }) => {
      try { statusEvent(JSON.parse(data)); } catch { statusEvent({ type: 'error', message: text().invalidResponse }); }
    });
    socket.addEventListener('close', () => {
      if (!quitting && state !== 'stopped') statusEvent({ type: 'error', message: text().disconnected });
      statusEvent({ type: 'status', state: 'stopped' });
    });
  });
}

app.on('window-all-closed', () => {});
app.on('activate', openController);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', openController);
  void app.whenReady().then(async () => {
  if (process.arch !== 'arm64') { dialog.showErrorBox(text().appleTitle, text().appleMessage); app.quit(); }
  else {
    app.dock?.setIcon(path.join(here, '../assets/kotonoha.png'));
    app.setAboutPanelOptions({ applicationName: 'kotonoha', iconPath: path.join(here, '../assets/kotonoha.png') });
    preferencesPath = path.join(app.getPath('userData'), 'settings.json');
    const legacy = process.env.KOTONOHA_TEST_PROFILE ? [] : ['kotoba', 'kotoba-live-subtitles'].map((name) => path.join(app.getPath('appData'), name, 'settings.json'));
    settings = loadSettings(preferencesPath, legacy);
    controller = new BrowserWindow({ show: process.env.KOTONOHA_TEST_HIDDEN !== '1', width: 510, height: 850, minWidth: 450, minHeight: 680, title: 'kotonoha', titleBarStyle: 'hiddenInset', backgroundColor: '#ffffff', webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1100, area.width - 48);
    overlay = new BrowserWindow({ width, height: 240, minWidth: 420, minHeight: 140, x: area.x + Math.round((area.width - width) / 2), y: area.y + area.height - 280, show: false, focusable: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: true, alwaysOnTop: true, skipTaskbar: true, title: text().subtitleTitle, webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    overlay.setAlwaysOnTop(true, 'floating');
    setOverlayInput(overlay, true);
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    secureWindow(controller); secureWindow(overlay);
    controller.on('closed', () => { controller = null; });
    overlay.on('closed', () => { overlay = null; });
    controller.on('close', (event) => { if (!quitting && windowAvailable(controller)) { event.preventDefault(); controller.hide(); } });
    overlay.on('close', (event) => { if (!quitting) { event.preventDefault(); setOverlay(false); } });
    const trayImage = nativeImage.createFromPath(path.join(here, '../assets/menuTemplate.png'));
    if (trayImage.isEmpty()) throw new Error('Menu bar icon is missing');
    trayImage.setTemplateImage(true);
    tray = new Tray(trayImage); refreshNativeUI();
    tray.on('click', openController);
    globalShortcut.register('Command+Shift+K', openController);
    globalShortcut.register('Command+Shift+L', () => setLocked(!locked));
    handle('app:snapshot', () => ({ settings, state, latest, history, visible: windowAvailable(overlay, quitting) && overlay.isVisible(), locked }));
    handle('app:status', async () => {
      await ready.promise;
      const response = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}`, 'Accept-Language': settings.uiLanguage }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`${text().readiness} (${response.status})`);
      return response.json();
    });
    handle('app:settings', (value) => {
      try { settings = validatedSettings(value); } catch (error) { throw new Error(text()[error.code] || error.message); }
      writeFileSync(preferencesPath, JSON.stringify(settings));
      broadcast({ type: 'settings', settings });
      refreshNativeUI();
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ui_language', ui_language: settings.uiLanguage }));
      return settings;
    });
    handle('app:capture-permission', captureActions.requestPermission);
    handle('app:capture-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));
    handle('app:start', captureActions.start);
    handle('app:stop', () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' })); });
    handle('app:overlay', (value) => setOverlay(!!value));
    handle('app:lock', (value) => setLocked(value));
    handle('app:controller', () => openController());
    handle('app:hide', () => { if (windowAvailable(controller, quitting)) controller.hide(); });
    handle('app:export', async (format) => {
      if (!['srt', 'txt'].includes(format)) throw new Error('Unsupported format');
      const { formatTranscript } = await import('./transcript.mjs');
      const result = await dialog.showSaveDialog(controller, { defaultPath: `kotonoha-${new Date().toISOString().slice(0, 10)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
      if (!result.canceled && result.filePath) writeFileSync(result.filePath, formatTranscript(history, format));
      return !result.canceled;
    });
    const python = path.join(root, '.venv/bin/python');
    if (existsSync(python)) {
      backend = spawn(python, ['-m', 'backend.app'], { cwd: root, env: { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined, PYTHONNOUSERSITE: '1', RT_TOKEN: token, PYTHONUNBUFFERED: '1', RT_ROOT: root, RT_PORT: String(port) }, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
      backend.stderr.on('data', (data) => { backendError = (backendError + data.toString()).slice(-3000); });
      backend.on('error', (error) => { backendError = error.message; statusEvent({ type: 'error', message: text().missingPython }); });
      backend.on('exit', () => { if (!quitting) { statusEvent({ type: 'error', message: text().pythonStopped }); statusEvent({ type: 'status', state: 'stopped' }); } });
      ready.promise = waitForBackend();
    } else ready.promise = Promise.reject(new Error(text().missingPython));
    ready.promise.catch((error) => { backendError = error.message; statusEvent({ type: 'error', message: error.message }); });
    await controller.loadFile(path.join(here, '../dist/index.html'));
    await overlay.loadFile(path.join(here, '../dist/index.html'), { query: { view: 'subtitles' } });
  }
  }).catch((error) => {
    releaseOverlay(overlay);
    if (windowAvailable(controller, quitting)) statusEvent({ type: 'error', message: error.message });
    else { console.error(text().startup, error.message); app.quit(); }
  });
}
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  releaseOverlay(overlay);
  globalShortcut.unregisterAll();
  socket?.close();
  if (blocker !== undefined) powerSaveBlocker.stop(blocker);
  const child = backend;
  void (async () => {
    if (child?.pid) {
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 8000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
          child.kill('SIGTERM');
        });
      }
      // NeMo and the capture helper belong to this detached process group.
      // Kill the group after graceful Python shutdown so a stalled MLX worker cannot orphan them.
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error('Could not stop audio service:', error.message); }
    }
    app.quit();
  })();
});
