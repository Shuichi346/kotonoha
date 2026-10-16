import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, globalShortcut, screen, dialog, powerSaveBlocker } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? JSON.parse(readFileSync(path.join(process.resourcesPath, 'runtime.json'), 'utf8')).root : path.resolve(here, '..');
const token = randomBytes(32).toString('hex');
const base = 'http://127.0.0.1:8765';
let controller, overlay, tray, backend, socket, quitting = false, backendError = '', blocker;
let latest = null;
let state = 'stopped';
let locked = false;
let history = [];
const defaultSettings = { source: 'en', target: 'ja', fontSize: 40, showOriginal: true, background: 0, expiry: 12 };
let settings = { ...defaultSettings };
let preferencesPath;

function broadcast(event) {
  for (const win of [controller, overlay]) if (win && !win.isDestroyed()) win.webContents.send('live:event', event);
}
function statusEvent(event) {
  if (event.type === 'status') {
    state = event.state;
    if (state === 'listening' && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if (state === 'stopped' && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
  }
  if (event.type === 'error' && controller && !controller.isDestroyed()) openController();
  if (event.type === 'subtitle') {
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
function openController() {
  controller.show();
  controller.focus();
}
function setLocked(value) {
  locked = !!value;
  overlay.setIgnoreMouseEvents(locked, { forward: true });
  broadcast({ type: 'overlay', visible: overlay.isVisible(), locked });
  refreshTray();
}
function setOverlay(value) {
  if (value) overlay.showInactive(); else overlay.hide();
  broadcast({ type: 'overlay', visible: overlay.isVisible(), locked });
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '操作画面を表示', click: openController },
    { label: '字幕を表示', type: 'checkbox', checked: overlay?.isVisible() ?? true, click: (item) => setOverlay(item.checked) },
    { label: '字幕へのクリックを透過', type: 'checkbox', checked: locked, click: (item) => setLocked(item.checked) },
    { type: 'separator' },
    { label: '翻訳を停止', click: () => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'stop' })) },
    { label: 'kotobaを終了', role: 'quit' }
  ]));
}
async function waitForBackend() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) throw new Error(backendError || 'Pythonバックエンドが終了しました。');
    try {
      const result = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
      if (result.ok) return;
      if (result.status === 401 || result.status === 403) throw new Error('ポート8765が使用中です。起動中のkotobaを終了してください。');
    } catch (error) { if (error.message.includes('ポート8765')) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(backendError || 'Pythonの起動を確認できません。uv syncを実行してください。');
}
const ready = { promise: null };
async function connect() {
  await ready.promise;
  if (socket?.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    socket = new WebSocket(`ws://127.0.0.1:8765/api/live?token=${token}`);
    const timer = setTimeout(() => { socket.close(); reject(new Error('音声サービスへの接続がタイムアウトしました。')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('音声サービスに接続できません。')); }, { once: true });
    socket.addEventListener('message', ({ data }) => {
      try { statusEvent(JSON.parse(data)); } catch { statusEvent({ type: 'error', message: '音声サービスから不正な応答が届きました。' }); }
    });
    socket.addEventListener('close', () => {
      if (!quitting && state !== 'stopped') statusEvent({ type: 'error', message: '音声サービスとの接続が切れました。翻訳を再開してください。' });
      statusEvent({ type: 'status', state: 'stopped' });
    });
  });
}
function validatedSettings(value) {
  const languages = ['en', 'ja', 'de', 'fr', 'es', 'it', 'pt', 'zh', 'ko'];
  if (!value || !languages.includes(value.source) || !languages.includes(value.target) || value.source === value.target) throw new Error('翻訳元と翻訳先に異なる言語を選んでください。');
  const fontSize = Math.round(Number(value.fontSize));
  const background = Number(value.background);
  const expiry = Number(value.expiry);
  if (!Number.isFinite(fontSize) || fontSize < 24 || fontSize > 72 || !Number.isFinite(background) || background < 0 || background > 0.85 || !Number.isFinite(expiry) || expiry < 3 || expiry > 60) throw new Error('字幕設定が範囲外です。');
  return { source: value.source, target: value.target, fontSize, background, showOriginal: !!value.showOriginal, expiry };
}

app.on('window-all-closed', () => {});
app.on('activate', () => controller && openController());
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => controller && openController());
  void app.whenReady().then(async () => {
  if (process.arch !== 'arm64') { dialog.showErrorBox('Apple Siliconが必要です', 'kotobaはarm64専用です。'); app.quit(); }
  else {
    preferencesPath = path.join(app.getPath('userData'), 'settings.json');
    try { settings = validatedSettings(JSON.parse(readFileSync(preferencesPath, 'utf8'))); } catch { /* Use defaults for absent or incompatible settings. */ }
    controller = new BrowserWindow({ width: 510, height: 850, minWidth: 450, minHeight: 680, title: 'kotoba', titleBarStyle: 'hiddenInset', backgroundColor: '#ffffff', webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1100, area.width - 48);
    overlay = new BrowserWindow({ width, height: 240, minWidth: 420, minHeight: 140, x: area.x + Math.round((area.width - width) / 2), y: area.y + area.height - 280, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: true, alwaysOnTop: true, skipTaskbar: true, title: 'kotoba 字幕', webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    secureWindow(controller); secureWindow(overlay);
    controller.on('close', (event) => { if (!quitting) { event.preventDefault(); controller.hide(); } });
    overlay.on('close', (event) => { if (!quitting) { event.preventDefault(); setOverlay(false); } });
    tray = new Tray(nativeImage.createEmpty()); tray.setTitle('字'); tray.setToolTip('kotoba — ライブ字幕翻訳'); refreshTray();
    tray.on('click', openController);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'kotoba', submenu: [{ role: 'about' }, { type: 'separator' }, { label: '操作画面を表示', accelerator: 'Command+Shift+K', click: openController }, { label: '字幕へのクリック透過を切り替え', accelerator: 'Command+Shift+L', click: () => setLocked(!locked) }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'windowMenu' }
    ]));
    globalShortcut.register('Command+Shift+K', openController);
    globalShortcut.register('Command+Shift+L', () => setLocked(!locked));
    handle('app:snapshot', () => ({ settings, state, latest, history, visible: overlay.isVisible(), locked }));
    handle('app:status', async () => {
      await ready.promise;
      const response = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`準備状況を取得できません (${response.status})`);
      return response.json();
    });
    handle('app:settings', (value) => {
      settings = validatedSettings(value);
      writeFileSync(preferencesPath, JSON.stringify(settings));
      broadcast({ type: 'settings', settings });
      return settings;
    });
    handle('app:start', async () => { await connect(); setOverlay(true); latest = null; broadcast({ type: 'clear' }); socket.send(JSON.stringify({ type: 'start', source: settings.source, target: settings.target })); });
    handle('app:stop', () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' })); });
    handle('app:overlay', (value) => setOverlay(!!value));
    handle('app:lock', (value) => setLocked(value));
    handle('app:controller', () => openController());
    handle('app:hide', () => controller.hide());
    handle('app:export', async (format) => {
      if (!['srt', 'txt'].includes(format)) throw new Error('Unsupported format');
      const { formatTranscript } = await import('./transcript.mjs');
      const result = await dialog.showSaveDialog(controller, { defaultPath: `kotoba-${new Date().toISOString().slice(0, 10)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
      if (!result.canceled && result.filePath) writeFileSync(result.filePath, formatTranscript(history, format));
      return !result.canceled;
    });
    const python = path.join(root, '.venv/bin/python');
    if (existsSync(python)) {
      backend = spawn(python, ['-m', 'backend.app'], { cwd: root, env: { ...process.env, RT_TOKEN: token, PYTHONUNBUFFERED: '1', RT_ROOT: root }, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
      backend.stderr.on('data', (data) => { backendError = (backendError + data.toString()).slice(-3000); });
      backend.on('error', (error) => { backendError = error.message; });
      backend.on('exit', () => { if (!quitting) { statusEvent({ type: 'error', message: 'Pythonサービスが終了しました。アプリを再起動してください。' }); statusEvent({ type: 'status', state: 'stopped' }); } });
      ready.promise = waitForBackend();
    } else ready.promise = Promise.reject(new Error('Python環境がありません。プロジェクトで uv sync を実行してください。'));
    ready.promise.catch((error) => { backendError = error.message; broadcast({ type: 'error', message: error.message }); });
    await controller.loadFile(path.join(here, '../dist/index.html'));
    await overlay.loadFile(path.join(here, '../dist/index.html'), { query: { view: 'subtitles' } });
  }
  }).catch((error) => { dialog.showErrorBox('kotobaを起動できません', error.message); app.quit(); });
}
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
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
