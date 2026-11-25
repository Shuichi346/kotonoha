import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkArchitecture(appPath, { run = execFileSync, report = console.log } = {}) {
  const app = path.resolve(appPath);
  const { root } = JSON.parse(readFileSync(path.join(app, 'Contents/Resources/runtime.json'), 'utf8'));
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Invalid packaged runtime root');
  const runtime = realpathSync(root);
  let checked = 0;
  const directories = new Set();
  function verify(file) {
    const arches = run('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).trim();
    if (!arches.split(/\s+/).includes('arm64')) throw new Error(`arm64 unavailable: ${file}: ${arches}`);
    return arches;
  }
  function walk(directory) {
    const canonical = realpathSync(directory);
    if (directories.has(canonical)) return;
    directories.add(canonical);
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.mode & 0o111 || /\.(dylib|so)$/.test(name)) {
        const info = run('/usr/bin/file', ['-b', file], { encoding: 'utf8' });
        if (info.includes('Mach-O')) { verify(file); checked++; }
      }
    }
  }
  // The selected app runs this snapshot, which may differ from the current checkout.
  for (const directory of [app, path.join(runtime, 'native/bin'), path.join(runtime, '.venv')]) walk(directory);
  const python = path.join(runtime, '.venv/bin/python');
  const engines = JSON.parse(run(python, ['-c', 'import json; from backend.config import nemo_binary, llama_binary; print(json.dumps([nemo_binary(), llama_binary()]))'], {
    cwd: runtime, encoding: 'utf8',
    env: { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
  }));
  if (!engines[0]) throw new Error('Installed nemo-speech executable not found');
  if (!engines[1]) throw new Error('Installed llama-server executable not found');
  for (const file of [python, ...engines]) report(`${file}: ${verify(file)}`);
  report(`Verified arm64 support in ${checked} app/runtime executables/libraries and Python/NeMo/llama.cpp.`);
  return { checked, runtime };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkArchitecture(process.env.KOTONOHA_CHECK_APP || 'release/kotonoha-darwin-arm64/kotonoha.app');
}
