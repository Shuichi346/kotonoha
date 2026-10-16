import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const dir = '.scratch/kotonoha.iconset';
mkdirSync(dir, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0 || result.error) throw new Error(result.stderr || result.error?.message || `${command} failed`);
}
run('xcrun', ['swift', '-module-cache-path', '.scratch/icon-module-cache', 'scripts/build-icons.swift']);
for (const size of [16, 32, 128, 256, 512]) {
  for (const factor of [1, 2]) {
    run('/usr/bin/sips', ['-z', String(size * factor), String(size * factor), 'assets/kotonoha.png', '--out', `${dir}/icon_${size}x${size}${factor === 2 ? '@2x' : ''}.png`]);
  }
}
run('/usr/bin/iconutil', ['-c', 'icns', dir, '-o', 'assets/kotonoha.icns']);
console.log('App ICNS and Retina menu template assets prepared.');
