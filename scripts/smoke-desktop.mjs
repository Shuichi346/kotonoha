import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const timeout = setTimeout(() => { console.error('Desktop smoke exceeded 45 seconds.'); process.exit(1); }, 45000);
const profile = mkdtempSync(path.join(tmpdir(), 'kotonoha-smoke-'));
const env = { ...process.env, KOTONOHA_TEST_PROFILE: profile, KOTONOHA_TEST_PORT: '8767', KOTONOHA_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await electron.launch({ executablePath: path.resolve(process.env.KOTONOHA_SMOKE_APP || 'release/kotonoha-darwin-arm64/kotonoha.app/Contents/MacOS/kotonoha'), env, timeout: 15000 });
  const errors = [];
  desktop.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const controller = await desktop.firstWindow();
  await controller.waitForFunction(() => !!window.kotonoha);
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
    await window.kotonoha.settings({ ...before.settings, uiLanguage: 'en' });
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
  assert.equal(result.before.visible, false);
  assert.equal(result.before.locked, true);
  assert.equal(result.after.settings.uiLanguage, 'en');
  assert.equal(result.after.settings.target, result.before.settings.target);
  assert.equal(JSON.parse(readFileSync(path.join(profile, 'settings.json'), 'utf8')).uiLanguage, 'en');
  await controller.waitForFunction(() => document.documentElement.lang === 'en');
  const menus = await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((item) => ({ label: item.label, children: item.submenu?.items.map((child) => child.label) })));
  assert.equal(menus[0].label, 'kotonoha');
  assert(menus[0].children.includes('Show controls'));
  assert(menus[0].children.includes('Quit kotonoha'));
  assert.equal(menus[1].label, 'Edit');
  assert.equal(result.status.asr.ready, true);
  assert.equal(result.status.translation.ready, true);
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
  const safety = await desktop.evaluate(({ BrowserWindow, app }) => {
    const windows = BrowserWindow.getAllWindows();
    const controls = windows.find((win) => !win.isAlwaysOnTop());
    controls.destroy();
    app.emit('activate');
    app.emit('second-instance');
    return { overlayVisible: windows.find((win) => win.isAlwaysOnTop()).isVisible() };
  });
  assert.equal(safety.overlayVisible, false);
  console.log(JSON.stringify({ passed: true, windows: windows.length, asr: result.status.asr.ready, translation: result.status.translation.ready, capture: result.status.capture, ipc: 'authenticated backend and independent overlay', rendererErrors: errors.length }));
} finally {
  await desktop?.close();
  clearTimeout(timeout);
}
