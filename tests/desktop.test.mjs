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
  assert.equal(loadSettings(current).fontSize, 30);
  assert.equal(loadSettings(current).showOriginal, false);
  const value = { ...defaultSettings, fontSize: 56, source: 'fr', showOriginal: false };
  delete value.uiLanguage;
  delete value.commitIntervalSeconds;
  const original = JSON.stringify(value);
  writeFileSync(old, original);
  const loaded = loadSettings(current, [old]);
  assert.equal(loaded.uiLanguage, 'ja'); assert.equal(loaded.fontSize, 56);
  assert.equal(loaded.source, 'fr'); assert.equal(loaded.showOriginal, false);
  assert.equal(loaded.commitIntervalSeconds, 15);
  assert.equal(readFileSync(old, 'utf8'), original);
  writeFileSync(current, JSON.stringify({ ...loaded, uiLanguage: 'en' }));
  assert.equal(loadSettings(current, [old]).uiLanguage, 'en');
});
test('commit intervals persist and invalid values are rejected without replacing saved preferences', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-interval-'));
  const file = path.join(dir, 'settings.json');
  for (const seconds of [5, 10, 15, 20, 30]) {
    const saved = validatedSettings({ ...defaultSettings, commitIntervalSeconds: seconds, fontSize: 42 });
    writeFileSync(file, JSON.stringify(saved));
    assert.equal(loadSettings(file).commitIntervalSeconds, seconds);
    assert.equal(loadSettings(file).fontSize, 42);
  }
  const original = readFileSync(file, 'utf8');
  for (const value of [0, 7, 60, 10.5, '10', null, true, NaN, Infinity]) {
    assert.throws(() => validatedSettings({ ...defaultSettings, commitIntervalSeconds: value }), { code: 'commitIntervalRange' });
  }
  assert.equal(readFileSync(file, 'utf8'), original);
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
  for (const name of ['backend', '.venv/bin', 'models/asr', 'models/hy-mt2-1.8b-4bit', 'models/translation', 'native/bin']) mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['backend/app.py', '.venv/pyvenv.cfg', 'native/bin/audio-capture', 'models/asr/model.gguf', 'models/hy-mt2-1.8b-4bit/model.safetensors', 'models/translation/old.safetensors']) writeFileSync(path.join(source, name), name);
  symlinkSync(process.execPath, path.join(source, '.venv/bin/python'));
  const installed = stageRuntime(source, path.join(dir, 'Application Support/runtime'));
  assert(!installed.root.startsWith(source));
  assert.equal(readFileSync(path.join(installed.root, 'backend/app.py'), 'utf8'), 'backend/app.py');
  assert(existsSync(path.join(installed.root, '.complete.json')));
  assert(!existsSync(path.join(installed.root, 'models')));
  assert.deepEqual(stageRuntime(source, path.join(dir, 'Application Support/runtime')), installed);
  writeFileSync(path.join(source, 'models/translation/old.safetensors'), 'unselected model changed');
  assert.deepEqual(stageRuntime(source, path.join(dir, 'Application Support/runtime')), installed);
  writeFileSync(path.join(source, 'models/hy-mt2-1.8b-4bit/model.safetensors'), 'selected model changed');
  assert.deepEqual(stageRuntime(source, path.join(dir, 'Application Support/runtime')), installed);
  writeFileSync(path.join(source, 'backend/app.py'), 'updated backend');
  assert.notEqual(stageRuntime(source, path.join(dir, 'Application Support/runtime')).revision, installed.revision);
  assert.throws(() => stageRuntime(source, path.join(source, 'runtime')), /outside the checkout/);
  symlinkSync(path.join(source, 'backend/app.py'), path.join(source, 'backend/unsafe'));
  assert.throws(() => stageRuntime(source, path.join(dir, 'other')), /depends on the checkout/);
});

test('runtime staging does not require a checkout model directory', async () => {
  const { stageRuntime } = await import('../scripts/stage-runtime.mjs');
  const { mkdirSync, symlinkSync, existsSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-no-models-'));
  const source = path.join(dir, 'source');
  for (const name of ['backend', '.venv/bin', 'native/bin']) mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['backend/app.py', '.venv/pyvenv.cfg', 'native/bin/audio-capture']) writeFileSync(path.join(source, name), name);
  symlinkSync(process.execPath, path.join(source, '.venv/bin/python'));
  const runtime = stageRuntime(source, path.join(dir, 'runtime'));
  assert(existsSync(path.join(runtime.root, 'backend/app.py')));
  assert(!existsSync(path.join(runtime.root, 'models')));
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

test('startup subtitles are visible without taking focus and remain locked; hidden checks never show them', async () => {
  const { showStartupOverlay } = await import('../desktop/window-actions.mjs');
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isFocused: () => false,
    setFocusable: (value) => calls.push(['focusable', value]),
    setIgnoreMouseEvents: (value) => calls.push(['ignore', value]),
    showInactive: () => calls.push(['showInactive']),
  };
  assert.equal(showStartupOverlay(window, { hidden: true }), false);
  assert.equal(showStartupOverlay(window, { quitting: true }), false);
  assert.equal(showStartupOverlay({ isDestroyed: () => true }), false);
  assert.deepEqual(calls, []);
  assert.equal(showStartupOverlay(window), true);
  assert.deepEqual(calls, [['focusable', false], ['ignore', true], ['showInactive']]);
});

test('startup windows fit the work area and keep a separate band for subtitles', async () => {
  const { startupWindowLayout } = await import('../desktop/window-layout.mjs');
  for (const area of [
    { x: 0, y: 25, width: 1440, height: 850 },
    { x: 0, y: 25, width: 1920, height: 1010 },
    { x: 0, y: 24, width: 1024, height: 704 },
    { x: 0, y: 0, width: 800, height: 600 },
    { x: -1080, y: -120, width: 1080, height: 1800 },
  ]) {
    const { controller, overlay } = startupWindowLayout(area);
    assert(controller.width <= 480 && controller.height <= 640);
    assert(controller.minHeight <= controller.height && controller.minWidth <= controller.width);
    assert(controller.y + controller.height + 16 <= overlay.y);
    for (const bounds of [controller, overlay]) {
      assert(bounds.x >= area.x && bounds.y >= area.y);
      assert(bounds.x + bounds.width <= area.x + area.width);
      assert(bounds.y + bounds.height <= area.y + area.height);
    }
  }
});

test('explicit controller restoration activates the app, while background errors never do', async () => {
  const { showController } = await import('../desktop/window-actions.mjs');
  const calls = [];
  const application = { focus: () => calls.push('app.focus') };
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('window.focus'),
    showInactive: () => calls.push('inactive'),
  };
  showController(window, { application, focus: false });
  assert.deepEqual(calls, ['inactive']);
  calls.length = 0;
  showController(window, { application });
  assert.deepEqual(calls, ['restore', 'show', 'app.focus', 'window.focus']);
  calls.length = 0;
  showController(window, { application, quitting: true });
  assert.deepEqual(calls, []);
});

test('owned backend reports its fallback port across pipe chunks', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { backendPort } = await import('../desktop/backend-startup.mjs');
  const child = new EventEmitter(); child.stdout = new PassThrough();
  const selected = backendPort(child, 8765, () => desktopLabels('ja'), () => '');
  child.stdout.write('diagnostic\n{"type":"service_');
  child.stdout.write('port","port":8774}\n');
  assert.equal(await selected, 8774);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
});

test('backend handshake rejects exhaustion, unexpected ports, exit, spawn error and timeout', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { backendPort } = await import('../desktop/backend-startup.mjs');
  for (const language of ['ja', 'en']) {
    for (const scenario of ['exhausted', 'invalid', 'smoke', 'exit', 'spawn', 'timeout']) {
      const child = new EventEmitter(); child.stdout = new PassThrough();
      const labels = desktopLabels(language);
      const port = scenario === 'smoke' ? 8767 : 8765;
      const selected = backendPort(child, port, () => labels, () => '', 20);
      const expected = scenario === 'exhausted' ? /8765, 8770, 8771, 8772, 8773, 8774/
        : scenario === 'exit' ? labels.backendExited : scenario === 'spawn' ? labels.missingPython
        : scenario === 'timeout' ? labels.pythonStartup : labels.invalidResponse;
      const rejected = assert.rejects(selected, typeof expected === 'string' ? { message: expected } : expected);
      if (scenario === 'exhausted') child.stdout.write('{"type":"ports_unavailable"}\n');
      if (scenario === 'invalid') child.stdout.write('{"type":"service_port","port":9999}\n');
      if (scenario === 'smoke') child.stdout.write('{"type":"service_port","port":8765}\n');
      if (scenario === 'exit') child.emit('exit', 1);
      if (scenario === 'spawn') child.emit('error', new Error('spawn failure'));
      await rejected;
      assert.equal(child.listenerCount('exit'), 0);
      assert.equal(child.stdout.listenerCount('data'), 0);
    }
  }
});
