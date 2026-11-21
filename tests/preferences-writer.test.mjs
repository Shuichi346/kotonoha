import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSettingsWriter, defaultSettings } from '../desktop/preferences.mjs';

test('rapid preference changes persist only the latest value and await the write', async () => {
  const writes = [];
  const writer = createSettingsWriter('unused', { delay: 5, write: async (file, value) => writes.push(value) });
  const saves = [32, 34, 36].map((fontSize) => writer.save({ ...defaultSettings, fontSize }));
  assert.equal(writes.length, 0);
  await Promise.all(saves);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].fontSize, 36);
});

test('quit flush persists pending preferences immediately using an atomic replacement', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kotonoha-save-'));
  const file = path.join(directory, 'settings.json');
  writeFileSync(file, JSON.stringify(defaultSettings));
  const writer = createSettingsWriter(file, { delay: 60000 });
  const value = { ...defaultSettings, fontSize: 42 };
  const saving = writer.save(value);
  await writer.flush();
  await saving;
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), value);
  assert.deepEqual(readdirSync(directory), ['settings.json']);
});

test('preference replacements are serialized even when an earlier save is still pending', async () => {
  let finishFirst;
  const calls = [];
  const writer = createSettingsWriter('unused', {
    delay: 60000,
    write: async (file, value) => {
      calls.push(value.fontSize);
      if (calls.length === 1) await new Promise((resolve) => { finishFirst = resolve; });
    },
  });
  const first = writer.save({ ...defaultSettings, fontSize: 32 });
  const firstFlush = writer.flush();
  await new Promise((resolve) => setImmediate(resolve));
  const second = writer.save({ ...defaultSettings, fontSize: 34 });
  const secondFlush = writer.flush();
  assert.deepEqual(calls, [32]);
  finishFirst();
  await Promise.all([first, firstFlush, second, secondFlush]);
  assert.deepEqual(calls, [32, 34]);
});

test('failed preference writes reach every caller and do not block a later retry', async () => {
  let fail = true;
  const values = [];
  const writer = createSettingsWriter('unused', {
    delay: 60000,
    write: async (file, value) => {
      if (fail) throw new Error('disk unavailable');
      values.push(value.fontSize);
    },
  });
  const failed = assert.rejects(writer.save(defaultSettings), /disk unavailable/);
  const failedAgain = assert.rejects(writer.save({ ...defaultSettings, fontSize: 32 }), /disk unavailable/);
  await assert.rejects(writer.flush(), /disk unavailable/);
  await Promise.all([failed, failedAgain]);
  fail = false;
  const retry = writer.save({ ...defaultSettings, fontSize: 34 });
  await writer.flush();
  await retry;
  assert.deepEqual(values, [34]);
});
