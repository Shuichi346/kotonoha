import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const timeout = setTimeout(() => { console.error('Desktop smoke exceeded 45 seconds.'); process.exit(1); }, 45000);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await electron.launch({ executablePath: path.resolve('release/kotoba-darwin-arm64/kotoba.app/Contents/MacOS/kotoba'), env, timeout: 15000 });
  const errors = [];
  desktop.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const controller = await desktop.firstWindow();
  await controller.waitForFunction(() => !!window.kotoba);
  const result = await controller.evaluate(async () => {
    const before = await window.kotoba.snapshot();
    const status = await window.kotoba.status();
    await window.kotoba.lock(true);
    await window.kotoba.overlay(false);
    const after = await window.kotoba.snapshot();
    return { before, status, after };
  });
  assert.equal(result.before.state, 'stopped');
  assert.equal(result.status.asr.ready, true);
  assert.equal(result.status.translation.ready, true);
  assert.equal(result.after.visible, false);
  assert.equal(result.after.locked, true);
  const windows = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ title: window.getTitle(), alwaysOnTop: window.isAlwaysOnTop(), background: window.getBackgroundColor() })));
  assert.equal(windows.length, 2);
  // Electron getBackgroundColor intentionally omits alpha (returns #RRGGBB).
  assert(windows.some((window) => window.alwaysOnTop && window.background === '#000000'));
  const captions = desktop.windows().find((page) => page.url().includes('view=subtitles'));
  assert(captions);
  assert.equal(await captions.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, windows: windows.length, asr: result.status.asr.ready, translation: result.status.translation.ready, capture: result.status.capture, ipc: 'authenticated backend and independent overlay', rendererErrors: errors.length }));
} finally {
  await desktop?.close();
  clearTimeout(timeout);
}
