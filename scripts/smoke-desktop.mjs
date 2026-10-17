import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
const timeout = setTimeout(() => { console.error('Desktop smoke exceeded 45 seconds.'); process.exit(1); }, 45000);
const profile = mkdtempSync(path.join(tmpdir(), 'kotonoha-smoke-'));
const fallback = process.env.KOTONOHA_SMOKE_FALLBACK === '1';
const env = { ...process.env, KOTONOHA_TEST_PROFILE: profile, KOTONOHA_TEST_PORT: fallback ? '8765' : '8767', KOTONOHA_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const occupied = [];
let desktop;
try {
  if (fallback) {
    for (const port of [8765, 8770, 8771, 8772, 8773]) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve() : reject(error));
        server.listen(port, '127.0.0.1', () => { occupied.push(server); resolve(); });
      });
    }
  }
  desktop = await electron.launch({ executablePath: path.resolve(process.env.KOTONOHA_SMOKE_APP || 'release/kotonoha-darwin-arm64/kotonoha.app/Contents/MacOS/kotonoha'), env, timeout: 15000 });
  const errors = [];
  desktop.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await desktop.firstWindow();
  let controller;
  for (const page of desktop.windows()) {
    const window = await desktop.browserWindow(page);
    if (!await window.evaluate((value) => value.isAlwaysOnTop())) { controller = page; break; }
  }
  assert(controller, 'Controller renderer must be available');
  await controller.waitForFunction(() => !!window.kotonoha);
  if (fallback) await desktop.evaluate(() => {
    globalThis.smokeHTTPPorts = [];
    globalThis.smokeWSPorts = [];
    const original = globalThis.fetch;
    globalThis.fetch = (url, ...args) => {
      globalThis.smokeHTTPPorts.push(new URL(url).port);
      return original(url, ...args);
    };
    globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
      construct(target, args) {
        globalThis.smokeWSPorts.push(new URL(args[0]).port);
        return new target(...args);
      }
    });
  });
  const presentation = await desktop.evaluate(({ BrowserWindow, app, screen }) => {
    const windows = BrowserWindow.getAllWindows();
    const controls = windows.find((win) => !win.isAlwaysOnTop());
    const captions = windows.find((win) => win.isAlwaysOnTop());
    return { controller: controls.getBounds(), overlay: captions.getBounds(), area: screen.getPrimaryDisplay().workArea, focusable: controls.isFocusable(), dock: app.dock.isVisible() };
  });
  assert.equal(presentation.dock, true);
  assert.equal(presentation.focusable, true);
  assert(presentation.controller.width <= 480 && presentation.controller.height <= 640);
  assert(presentation.controller.y + presentation.controller.height + 16 <= presentation.overlay.y);
  assert(presentation.controller.y >= presentation.area.y);
  assert(presentation.controller.x >= presentation.area.x);
  const inputBefore = await desktop.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((win) => win.isAlwaysOnTop());
    globalThis.overlayMouseCalls = [];
    const original = overlay.setIgnoreMouseEvents.bind(overlay);
    overlay.setIgnoreMouseEvents = (ignore, options) => { globalThis.overlayMouseCalls.push(ignore); original(ignore, options); };
    return { focusable: overlay.isFocusable(), visible: overlay.isVisible() };
  });
  assert.deepEqual(inputBefore, { focusable: false, visible: false });
  const result = await controller.evaluate(async () => {
    const before = await window.kotonoha.snapshot();
    const status = await window.kotonoha.status();
    const permissionBridge = [typeof window.kotonoha.requestCapturePermission, typeof window.kotonoha.openCaptureSettings];
    await window.kotonoha.settings({ ...before.settings, uiLanguage: 'en', commitIntervalSeconds: 10 });
    await window.kotonoha.lock(false);
    await window.kotonoha.lock(true);
    await window.kotonoha.overlay(false);
    const after = await window.kotonoha.snapshot();
    return { before, status, after, permissionBridge };
  });
  assert.equal(result.before.state, 'stopped');
  assert.deepEqual(result.permissionBridge, ['function', 'function']);
  assert.equal(result.after.state, 'stopped');
  assert.equal(result.before.settings.uiLanguage, 'ja');
  assert.equal(result.before.settings.fontSize, 30);
  assert.equal(result.before.settings.showOriginal, false);
  assert.equal(result.before.settings.commitIntervalSeconds, 15);
  assert.equal(result.before.visible, false);
  assert.equal(result.before.locked, true);
  assert.equal(result.after.settings.uiLanguage, 'en');
  assert.equal(result.after.settings.commitIntervalSeconds, 10);
  assert.equal(result.after.settings.target, result.before.settings.target);
  assert.equal(JSON.parse(readFileSync(path.join(profile, 'settings.json'), 'utf8')).uiLanguage, 'en');
  assert.equal(JSON.parse(readFileSync(path.join(profile, 'settings.json'), 'utf8')).commitIntervalSeconds, 10);
  await controller.waitForFunction(() => document.documentElement.lang === 'en');
  const menus = await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((item) => ({ label: item.label, children: item.submenu?.items.map((child) => child.label) })));
  assert.equal(menus[0].label, 'kotonoha');
  assert(menus[0].children.includes('Show controls'));
  assert(menus[0].children.includes('Quit kotonoha'));
  assert.equal(menus[1].label, 'Edit');
  assert.equal(result.status.asr.ready, true);
  assert.equal(result.status.translation.ready, true);
  assert.equal(result.status.translation.detail, 'Hy-MT2 1.8B · MLX 4-bit');
  // Hidden smoke windows need a rendered model label, not on-screen visibility.
  await controller.getByText('Hy-MT2 1.8B', { exact: true }).waitFor({ state: 'attached', timeout: 5000 });
  assert.equal(result.after.visible, false);
  assert.equal(result.after.locked, true);
  assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => ({
    calls: globalThis.overlayMouseCalls,
    focusable: BrowserWindow.getAllWindows().find((win) => win.isAlwaysOnTop()).isFocusable()
  })), { calls: [false, true, true], focusable: false });
  const windows = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ title: window.getTitle(), alwaysOnTop: window.isAlwaysOnTop(), background: window.getBackgroundColor() })));
  assert.equal(windows.length, 2);
  // Electron getBackgroundColor intentionally omits alpha (returns #RRGGBB).
  assert(windows.some((window) => window.alwaysOnTop && window.background === '#000000'));
  const captions = desktop.windows().find((page) => page.url().includes('view=subtitles'));
  assert(captions);
  assert.equal(await captions.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.deepEqual(errors, []);
  // Block Start at the transport boundary: verify its real IPC payload without capture.
  await desktop.evaluate(() => {
    const original = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const message = JSON.parse(data);
      if (message.type === 'start') { globalThis.smokeStartPayload = message; return; }
      return original.call(this, data);
    };
  });
  await controller.evaluate(() => window.kotonoha.start());
  assert.deepEqual(await desktop.evaluate(() => globalThis.smokeStartPayload), {
    type: 'start', source: result.after.settings.source, target: result.after.settings.target,
    ui_language: 'en', commit_interval_seconds: 10,
  });
  if (fallback) {
    const ports = await desktop.evaluate(() => ({ http: globalThis.smokeHTTPPorts, ws: globalThis.smokeWSPorts }));
    assert(ports.http.length > 0 && ports.http.every((port) => port === '8774'));
    assert.deepEqual(ports.ws, ['8774']);
    assert(occupied.every((server) => server.listening));
  }
  const safety = await desktop.evaluate(({ BrowserWindow, app }) => {
    const windows = BrowserWindow.getAllWindows();
    const controls = windows.find((win) => !win.isAlwaysOnTop());
    controls.destroy();
    app.emit('activate');
    app.emit('second-instance');
    return { overlayVisible: windows.find((win) => win.isAlwaysOnTop()).isVisible() };
  });
  assert.equal(safety.overlayVisible, false);
  console.log(JSON.stringify({ passed: true, fallbackPort: fallback ? 8774 : undefined, windows: windows.length, presentation, asr: result.status.asr.ready, translation: result.status.translation.ready, capture: result.status.capture, ipc: 'authenticated backend and independent overlay', rendererErrors: errors.length }));
} finally {
  await desktop?.close();
  await Promise.all(occupied.map((server) => new Promise((resolve) => server.close(resolve))));
  clearTimeout(timeout);
}
