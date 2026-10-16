import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultSettings, validatedSettings, loadSettings } from '../desktop/preferences.mjs';
import { desktopLabels } from '../desktop/locale.mjs';
import { createCaptureActions } from '../desktop/capture-actions.mjs';

test('legacy settings migrate with Japanese UI and preserve subtitle preferences', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-settings-'));
  const old = path.join(dir, 'legacy.json');
  const current = path.join(dir, 'current.json');
  const value = { ...defaultSettings, fontSize: 56, source: 'fr', showOriginal: false };
  delete value.uiLanguage;
  const original = JSON.stringify(value);
  writeFileSync(old, original);
  const loaded = loadSettings(current, [old]);
  assert.equal(loaded.uiLanguage, 'ja'); assert.equal(loaded.fontSize, 56);
  assert.equal(loaded.source, 'fr'); assert.equal(loaded.showOriginal, false);
  assert.equal(readFileSync(old, 'utf8'), original);
  writeFileSync(current, JSON.stringify({ ...loaded, uiLanguage: 'en' }));
  assert.equal(loadSettings(current, [old]).uiLanguage, 'en');
});
test('changing UI language preserves translation languages and rejects invalid caption values', () => {
  const settings = validatedSettings({ ...defaultSettings, uiLanguage: 'en' });
  assert.equal(settings.source, 'en'); assert.equal(settings.target, 'ja');
  assert.equal(settings.uiLanguage, 'en');
  assert.equal(validatedSettings({ ...settings, uiLanguage: 'unsupported' }).uiLanguage, 'ja');
  assert.throws(() => validatedSettings({ ...settings, fontSize: 999 }), { code: 'settingsRange' });
});
test('desktop localization covers the same keys in both languages', () => {
  const ja = desktopLabels('ja'), en = desktopLabels('en');
  assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
  assert.equal(ja.showControls, '操作画面を表示'); assert.equal(en.showControls, 'Show controls');
  assert.equal(en.quit, 'Quit kotonoha');
});

test('destroyed or quitting windows cannot reopen or steal focus', async () => {
  const { showController, releaseOverlay, setOverlayInput } = await import('../desktop/window-actions.mjs');
  const dead = { isDestroyed: () => true };
  assert.equal(showController(dead), false);
  assert.equal(showController(null), false);
  assert.equal(showController({}, { quitting: true }), false);
  assert.doesNotThrow(() => releaseOverlay(dead));
  const calls = [];
  const live = { isDestroyed: () => false, isFocused: () => true, blur: () => calls.push('blur'),
    setFocusable: (value) => calls.push(`focusable:${value}`), showInactive: () => calls.push('inactive'),
    setIgnoreMouseEvents: (value) => calls.push(`ignore:${value}`), hide: () => calls.push('hide') };
  assert.equal(showController(live, { focus: false }), true);
  setOverlayInput(live, false);
  releaseOverlay(live);
  assert.deepEqual(calls, ['inactive', 'focusable:true', 'ignore:false', 'blur', 'focusable:false', 'ignore:true', 'hide']);
});

test('runtime staging is independent of the checkout and reuses only complete snapshots', async () => {
  const { stageRuntime } = await import('../scripts/stage-runtime.mjs');
  const { mkdirSync, symlinkSync, existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-runtime-'));
  const source = path.join(dir, 'Documents/source');
  for (const name of ['backend', '.venv/bin', 'models', 'native/bin']) mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['backend/app.py', '.venv/pyvenv.cfg', 'native/bin/audio-capture', 'models/fixture']) writeFileSync(path.join(source, name), name);
  symlinkSync(process.execPath, path.join(source, '.venv/bin/python'));
  const installed = stageRuntime(source, path.join(dir, 'Application Support/runtime'));
  assert(!installed.root.startsWith(source));
  assert.equal(readFileSync(path.join(installed.root, 'backend/app.py'), 'utf8'), 'backend/app.py');
  assert(existsSync(path.join(installed.root, '.complete.json')));
  assert.deepEqual(stageRuntime(source, path.join(dir, 'Application Support/runtime')), installed);
  assert.throws(() => stageRuntime(source, path.join(source, 'runtime')), /outside the checkout/);
  symlinkSync(path.join(source, 'models/fixture'), path.join(source, 'models/unsafe'));
  assert.throws(() => stageRuntime(source, path.join(dir, 'other')), /depends on the checkout/);
});

test('permission requests are single flight and start waits until the permission dialog settles', async () => {
  let allowPermission;
  const events = [];
  const actions = createCaptureActions({
    requestPermission: () => { events.push('permission'); return new Promise((resolve) => { allowPermission = resolve; }); },
    start: async () => { events.push('start'); },
  });
  const first = actions.requestPermission();
  assert.equal(actions.requestPermission(), first);
  const start = actions.start();
  assert.equal(actions.start(), start);
  await Promise.resolve();
  assert.deepEqual(events, ['permission']);
  const result = { ready: true, permission: 'granted', detail: 'Ready' };
  allowPermission(result);
  assert.equal(await first, result);
  await start;
  assert.deepEqual(events, ['permission', 'start']);
});

test('failed permission requests release the action queue for retry', async () => {
  let attempts = 0;
  const actions = createCaptureActions({
    requestPermission: async () => {
      if (++attempts === 1) throw new Error('Service unavailable');
      return { ready: false, permission: 'required' };
    },
    start: async () => 'started',
  });
  await assert.rejects(actions.requestPermission(), /Service unavailable/);
  assert.deepEqual(await actions.requestPermission(), { ready: false, permission: 'required' });
  assert.equal(await actions.start(), 'started');
  assert.equal(attempts, 2);
});

test('permission requests wait for a pending start without executing it again', async () => {
  let finishStart;
  const events = [];
  const actions = createCaptureActions({
    start: () => { events.push('start'); return new Promise((resolve) => { finishStart = resolve; }); },
    requestPermission: async () => { events.push('permission'); },
  });
  const start = actions.start();
  const permission = actions.requestPermission();
  await Promise.resolve();
  assert.deepEqual(events, ['start']);
  finishStart();
  await start;
  await permission;
  assert.deepEqual(events, ['start', 'permission']);
});
