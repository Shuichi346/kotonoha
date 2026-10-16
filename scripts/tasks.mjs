import { spawnSync } from 'node:child_process';
const jobs = {
  build: [['node_modules/typescript/bin/tsc', ['--noEmit'], 30000], ['node_modules/vite/bin/vite.js', ['build'], 30000]],
  test: [['node_modules/@playwright/test/cli.js', ['test'], 90000]],
  electron: [['node_modules/electron/install.js', [], 180000]],
};
const job = jobs[process.argv[2]];
if (!job) throw new Error('Unknown task');
for (const [entry, args, timeout] of job) {
  const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', timeout });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
