import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backendFailure, runtimeFailure } from '../desktop/runtime-health.mjs';

const labels = {
  runtimeMissing: 'The local runtime is missing. Rebuild and reinstall the app.',
  backendUnavailable: 'The audio service could not start. Restart the app.',
};
const components = [
  '.venv/bin/python',
  '.venv/pyvenv.cfg',
  'backend/app.py',
  'native/bin/audio-capture',
  'native/bin/LiveCaptionAudio.app/Contents/MacOS/audio-capture',
];

function fixture({ missing, pythonTarget, directory } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kotonoha-runtime-health-'));
  for (const relative of components) {
    if (relative === missing) continue;
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    if (relative === directory) mkdirSync(file);
    else if (relative === '.venv/bin/python' && pythonTarget) symlinkSync(pythonTarget, file);
    else writeFileSync(file, relative);
  }
  return root;
}

test('complete runtime has no service failure', () => {
  assert.equal(runtimeFailure(fixture(), labels), null);
});

for (const component of components) {
  test(`missing ${component} returns a serialized runtime failure`, () => {
    const failure = runtimeFailure(fixture({ missing: component }), labels);
    assert.deepEqual(failure, { error: { code: 'runtime_missing', message: labels.runtimeMissing } });
    assert.deepEqual(JSON.parse(JSON.stringify(failure)), failure);
  });
}

test('missing runtime root returns a runtime failure', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'kotonoha-missing-runtime-'));
  assert.equal(runtimeFailure(path.join(parent, 'absent'), labels).error.code, 'runtime_missing');
});

test('broken Python symlink reports the missing base interpreter', () => {
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'kotonoha-missing-python-')), 'absent');
  assert.equal(runtimeFailure(fixture({ pythonTarget: target }), labels).error.code, 'runtime_missing');
});

test('valid Python symlink is accepted without executing it', () => {
  assert.equal(runtimeFailure(fixture({ pythonTarget: process.execPath }), labels), null);
});

test('directory in place of a required executable is rejected', () => {
  assert.equal(runtimeFailure(fixture({ directory: 'native/bin/audio-capture' }), labels).error.code, 'runtime_missing');
});

test('backend failure is distinct from runtime or capture authorization', () => {
  const failure = backendFailure(labels);
  assert.deepEqual(failure, { error: { code: 'backend_unavailable', message: labels.backendUnavailable } });
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), failure);
});
