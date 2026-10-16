import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
const roots = ['release/kotonoha-darwin-arm64/kotonoha.app', 'native/bin', '.venv/lib/python3.13/site-packages/mlx'];
let checked = 0;
function walk(path) {
  for (const name of readdirSync(path)) {
    const file = `${path}/${name}`;
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (stat.mode & 0o111 || /\.(dylib|so)$/.test(name)) {
      const info = execFileSync('/usr/bin/file', ['-b', file], { encoding: 'utf8' });
      if (info.includes('Mach-O')) {
        const arches = execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).trim();
        if (!arches.split(/\s+/).includes('arm64')) throw new Error(`arm64 unavailable: ${file}: ${arches}`);
        checked++;
      }
    }
  }
}
roots.forEach(walk);
for (const path of ['.venv/bin/python', `${process.env.HOME}/.local/bin/nemo-speech`]) {
  const arches = execFileSync('/usr/bin/lipo', ['-archs', path], { encoding: 'utf8' }).trim();
  if (!arches.split(/\s+/).includes('arm64')) throw new Error(`arm64 unavailable: ${path}`);
  console.log(`${path}: ${arches}`);
}
console.log(`Verified arm64 support in ${checked} bundled executables/libraries and Python/NeMo.`);
