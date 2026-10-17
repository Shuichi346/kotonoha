import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercise the real shell entry point in an isolated checkout, with no downloads or capture.
function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'kotonoha-builder-'));
  const bin = path.join(root, 'tools');
  mkdirSync(bin);
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(new URL('../scripts/build-app.sh', import.meta.url), path.join(root, 'scripts/build-app.sh'));
  const stub = `#!/bin/bash
set -eu
tool="\${0##*/}"
printf '%s|%s\\n' "$tool" "$*" >> "$BUILD_TEST_LOG"
case "$tool" in
  uname) if [[ "$1" == -s ]]; then echo "\${TEST_OS:-Darwin}"; else echo "\${TEST_ARCH:-arm64}"; fi ;;
  sw_vers) echo "\${TEST_MACOS:-26.6}" ;;
  git) echo 'git version 2.56.0' ;;
  xcrun)
    case "$1" in
      swift) printf 'Apple Swift version 6.4\\nTarget: %s-apple-macosx26.0\\n' "\${TEST_SWIFT_ARCH:-arm64}" ;;
      --sdk) echo 'SDK diagnostic on stderr' >&2; echo "\${TEST_SDK:-27.0}" ;;
      lipo) exit "\${TEST_LIPO_STATUS:-0}" ;;
    esac ;;
  node) echo "\${TEST_NODE:-v26.10.0}" ;;
  npm)
    if [[ "$1" == --version ]]; then echo "\${TEST_NPM:-12.2.0}"; exit 0; fi
    if [[ "$*" == "\${TEST_FAIL_STEP:-never}" ]]; then exit 42; fi
    if [[ "$*" == 'run package' && "\${TEST_INCOMPLETE:-0}" != 1 ]]; then
      app="$KOTONOHA_PACKAGE_OUT/kotonoha-darwin-arm64/kotonoha.app"
      mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
      touch "$app/Contents/MacOS/kotonoha" "$app/Contents/Resources/runtime.json"
      chmod +x "$app/Contents/MacOS/kotonoha"
    fi
    if [[ "$*" == 'run check:architecture' ]]; then
      [[ "$KOTONOHA_CHECK_APP" == "$KOTONOHA_PACKAGE_OUT/kotonoha-darwin-arm64/kotonoha.app" ]]
    fi ;;
  uv) if [[ "$1" == --version ]]; then echo 'uv 0.13.1'; exit "\${TEST_UV_STATUS:-0}"; fi ;;
  nemo-speech)
    if [[ "$1" == --version ]]; then echo 'nemo-speech 0.2.0'; else
      echo "Features: asr \${TEST_METAL:-backend_metal} realtime_websocket"
      exit "\${TEST_DOCTOR_STATUS:-0}"
    fi ;;
esac
`;
  for (const name of ['uname', 'sw_vers', 'git', 'xcrun', 'node', 'npm', 'uv', 'nemo-speech']) {
    writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
  }
  const log = path.join(root, 'commands.log');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BUILD_TEST_LOG: log, ...overrides };
  delete env.NEMO_SPEECH_BIN;
  delete env.KOTONOHA_PACKAGE_OUT;
  if (overrides.KOTONOHA_PACKAGE_OUT) env.KOTONOHA_PACKAGE_OUT = overrides.KOTONOHA_PACKAGE_OUT;
  return {
    root, bin,
    run(args = [], extra = {}) {
      const result = spawnSync('/bin/bash', [path.join(root, 'scripts/build-app.sh'), ...args], {
        cwd: tmpdir(), env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000,
      });
      assert.ifError(result.error);
      return { ...result, log: readFileSync(log, 'utf8') };
    },
  };
}

test('diagnostics check every requested tool without installing or downloading', () => {
  const result = fixture().run(['--check']);
  assert.equal(result.status, 0, result.stderr);
  for (const command of ['git|--version', 'xcrun|swift --version', 'node|--version', 'npm|--version',
    'uv|--version', 'nemo-speech|--version', 'nemo-speech|doctor']) assert(result.log.includes(command));
  assert(!result.log.includes('npm|ci'));
  assert(!result.log.includes('uv|sync'));
});

test('unsupported environments stop before setup while completing other diagnostics', () => {
  const cases = [
    { TEST_OS: 'Linux' }, { TEST_ARCH: 'x86_64' }, { TEST_MACOS: '15.6' },
    { TEST_SWIFT_ARCH: 'x86_64' }, { TEST_SDK: '15.5' }, { TEST_NODE: 'v26.4.9' },
    { TEST_NPM: '12.0.0' }, { TEST_NODE: 'v26.5.0-rc.1' }, { TEST_UV_STATUS: '127' },
    { TEST_METAL: 'no_backend_metal' }, { TEST_DOCTOR_STATUS: '1' }, { TEST_LIPO_STATUS: '1' },
  ];
  for (const values of cases) {
    const result = fixture(values).run();
    assert.equal(result.status, 1, JSON.stringify(values));
    assert(result.log.includes('nemo-speech|doctor'));
    assert(!result.log.includes('npm|ci'));
  }
});

test('minimum supported Node/npm versions pass', () => {
  const result = fixture({ TEST_NODE: 'v26.5.0', TEST_NPM: '12.0.1' }).run(['--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('configured NeMo path with spaces is used for both version and doctor', () => {
  const f = fixture();
  const custom = path.join(f.root, 'custom speech', 'nemo-speech');
  mkdirSync(path.dirname(custom));
  copyFileSync(path.join(f.bin, 'nemo-speech'), custom);
  const result = f.run(['--check'], { NEMO_SPEECH_BIN: custom });
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes('custom\\ speech/nemo-speech'));
  const missing = fixture().run(['--check'], { NEMO_SPEECH_BIN: '/missing/nemo-speech' });
  assert.equal(missing.status, 1);
  assert(!missing.log.includes('nemo-speech|doctor'));
});

test('builder runs locked setup, explicit model preparation, packaging and selected app verification in order', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const steps = result.log.split('\n').filter((line) => /^(npm\|ci|npm\|run|uv\|sync|uv\|run)/.test(line));
  assert.equal(steps.length, 7);
  assert.deepEqual(steps.slice(0, 3), ['npm|ci', 'npm|run setup:electron', 'uv|sync --locked --python 3.13']);
  assert(steps[3].startsWith('uv|run --locked python -c '));
  assert.deepEqual(steps.slice(4), ['npm|run prepare:models', 'npm|run package', 'npm|run check:architecture']);
  assert(result.stdout.includes(`${f.root}/release/build-`));
  assert(!result.log.includes('npm|start'));
});

test('setup and preparation failures stop later steps and identify the failed command', () => {
  for (const step of ['ci', 'run prepare:models', 'run package', 'run check:architecture']) {
    const result = fixture({ TEST_FAIL_STEP: step }).run();
    assert.equal(result.status, 42, result.stderr);
    assert(result.stderr.includes(`Build failed at: npm ${step}`));
    const after = result.log.split(`npm|${step}\n`)[1];
    assert.equal(after, '');
    assert(!result.stdout.includes('App created'));
  }
});

test('existing output app is preserved and incomplete bundles do not report success', () => {
  const f = fixture();
  const output = path.join(f.root, 'chosen output');
  const app = path.join(output, 'kotonoha-darwin-arm64/kotonoha.app');
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, 'keep'), 'previous app');
  const result = f.run([], { KOTONOHA_PACKAGE_OUT: output });
  assert.equal(result.status, 1);
  assert(!result.log.includes('npm|ci'));
  assert.equal(readFileSync(path.join(app, 'keep'), 'utf8'), 'previous app');
  const incomplete = fixture({ TEST_INCOMPLETE: '1' }).run();
  assert.equal(incomplete.status, 1);
  assert(incomplete.stderr.includes('Incomplete app bundle'));
  assert(!incomplete.stdout.includes('App created'));
});
