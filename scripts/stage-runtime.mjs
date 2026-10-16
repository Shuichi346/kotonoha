import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function stageRuntime(sourceRoot, runtimeBase = path.join(homedir(), 'Library/Application Support/kotonoha/runtime')) {
  const source = realpathSync(sourceRoot);
  let ancestor = path.resolve(runtimeBase);
  const suffix = [];
  while (!existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const base = path.join(realpathSync(ancestor), ...suffix);
  if (base === source || base.startsWith(source + path.sep)) throw new Error('Runtime must be outside the checkout');
  const hash = createHash('sha256');
  const entries = ['backend', '.venv', 'native/bin'];
  hash.update(`runtime-v3-shared-cache:${entries.join(',')}\n`);
  function fingerprint(relative) {
    const full = path.join(source, relative);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) {
      const target = realpathSync(full);
      if (target === source || target.startsWith(source + path.sep)) throw new Error(`Runtime symlink depends on the checkout: ${relative}`);
      hash.update(`${relative}:${target}\n`);
    } else if (info.isDirectory()) {
      for (const name of readdirSync(full).sort()) if (!['__pycache__', '.cache', '.huggingface'].includes(name)) fingerprint(path.join(relative, name));
    } else {
      hash.update(`${relative}:${info.size}:${info.mtimeMs}\n`);
      if (relative.startsWith('backend' + path.sep) || relative.endsWith('pyvenv.cfg')) hash.update(readFileSync(full));
    }
  }
  for (const entry of entries) fingerprint(entry);
  for (const required of ['backend/app.py', '.venv/pyvenv.cfg', '.venv/bin/python', 'native/bin/audio-capture']) {
    if (!existsSync(path.join(source, required))) throw new Error(`Missing runtime component: ${required}`);
  }
  const revision = hash.digest('hex').slice(0, 16);
  const destination = path.join(base, revision);
  const marker = path.join(destination, '.complete.json');
  if (existsSync(marker)) return { root: destination, revision };
  mkdirSync(base, { recursive: true });
  const pending = path.join(base, `.pending-${revision}-${randomUUID()}`);
  mkdirSync(pending);
  for (const entry of entries) {
    cpSync(path.join(source, entry), path.join(pending, entry), {
      recursive: true, dereference: false, mode: constants.COPYFILE_FICLONE,
      filter: (file) => !['__pycache__', '.cache', '.huggingface'].includes(path.basename(file)),
    });
  }
  writeFileSync(path.join(pending, '.complete.json'), JSON.stringify({ revision, createdAt: new Date().toISOString() }));
  renameSync(pending, destination);
  return { root: destination, revision };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(stageRuntime(process.cwd(), process.env.KOTONOHA_RUNTIME_BASE)));
}
