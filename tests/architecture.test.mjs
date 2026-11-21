import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkArchitecture } from '../scripts/check-architecture.mjs';

function fixture() {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kotonoha-architecture-')));
  const app = path.join(directory, 'selected.app');
  const runtime = path.join(directory, 'selected-runtime');
  for (const name of ['Contents/Resources', 'Contents/MacOS']) mkdirSync(path.join(app, name), { recursive: true });
  for (const name of ['native/bin', '.venv/bin', '.venv/lib/site-packages']) mkdirSync(path.join(runtime, name), { recursive: true });
  writeFileSync(path.join(app, 'Contents/Resources/runtime.json'), JSON.stringify({ root: runtime }));
  for (const file of [path.join(app, 'Contents/MacOS/kotonoha'), path.join(runtime, 'native/bin/audio-capture'), path.join(runtime, '.venv/bin/python')]) writeFileSync(file, 'fixture', { mode: 0o755 });
  const extension = path.join(runtime, '.venv/lib/site-packages/native.so');
  writeFileSync(extension, 'fixture');
  const inspected = [];
  function run(binary, args, options) {
    if (binary === '/usr/bin/file') return 'Mach-O executable';
    if (binary === '/usr/bin/lipo') { inspected.push(args[1]); return 'arm64'; }
    assert.equal(binary, path.join(runtime, '.venv/bin/python'));
    assert.equal(options.cwd, runtime);
    assert.equal(options.env.PYTHONPATH, undefined);
    return JSON.stringify(['/installed/nemo-speech', '/installed/llama-server']);
  }
  return { app, runtime, extension, inspected, run };
}

test('architecture verification checks the selected staged runtime and resolves its engines', () => {
  const value = fixture();
  const result = checkArchitecture(value.app, { run: value.run, report: () => {} });
  assert.equal(result.runtime, value.runtime);
  assert(value.inspected.includes(value.extension));
  assert(value.inspected.includes(path.join(value.runtime, 'native/bin/audio-capture')));
  assert(value.inspected.includes(path.join(value.runtime, '.venv/bin/python')));
  assert(value.inspected.includes('/installed/nemo-speech'));
  assert(value.inspected.includes('/installed/llama-server'));
});

test('an incompatible staged native extension fails even when the app supports arm64', () => {
  const value = fixture();
  const run = (binary, args, options) => binary === '/usr/bin/lipo' && args[1] === value.extension
    ? 'unsupported' : value.run(binary, args, options);
  assert.throws(() => checkArchitecture(value.app, { run, report: () => {} }), /arm64 unavailable: .*native\.so/);
});
