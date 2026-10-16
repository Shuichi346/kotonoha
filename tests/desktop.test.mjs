import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultSettings, validatedSettings, loadSettings } from '../desktop/preferences.mjs';
import { desktopLabels } from '../desktop/locale.mjs';

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
