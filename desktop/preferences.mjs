import { readFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const defaultSettings = { source: 'en', target: 'ja', uiLanguage: 'ja', commitIntervalSeconds: 15, fontSize: 30, showOriginal: false, background: 0, expiry: 12 };
function invalid(code) { const error = new Error(code); error.code = code; throw error; }
export function validatedSettings(value) {
  const languages = ['en', 'ja', 'de', 'fr', 'es', 'it', 'zh', 'ko'];
  if (!value || !languages.includes(value.source) || !languages.includes(value.target) || value.source === value.target) invalid('languagePair');
  const fontSize = Math.round(Number(value.fontSize));
  const background = Number(value.background);
  const expiry = Number(value.expiry);
  const commitIntervalSeconds = value.commitIntervalSeconds === undefined ? defaultSettings.commitIntervalSeconds : value.commitIntervalSeconds;
  if (![5, 10, 15, 20, 30].includes(commitIntervalSeconds)) invalid('commitIntervalRange');
  if (!Number.isFinite(fontSize) || fontSize < 24 || fontSize > 72 || !Number.isFinite(background) || background < 0 || background > 0.85 || !Number.isFinite(expiry) || expiry < 3 || expiry > 60) invalid('settingsRange');
  return { source: value.source, target: value.target, uiLanguage: value.uiLanguage === 'en' ? 'en' : 'ja', commitIntervalSeconds, fontSize, background, showOriginal: !!value.showOriginal, expiry };
}
export function loadSettings(currentPath, legacyPaths = []) {
  for (const candidate of [currentPath, ...legacyPaths]) {
    try {
      const value = JSON.parse(readFileSync(candidate, 'utf8'));
      // Retain appearance preferences when the former model's Portuguese pair is loaded.
      if (value?.source === 'pt') value.source = value.target === 'en' ? 'ja' : 'en';
      if (value?.target === 'pt') value.target = value.source === 'ja' ? 'en' : 'ja';
      return validatedSettings(value);
    }
    catch { /* Skip absent, malformed, or incompatible preferences without overwriting them. */ }
  }
  return { ...defaultSettings };
}

async function writeSettings(file, value) {
  const temporary = `${file}.${randomUUID()}.pending`;
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function createSettingsWriter(file, { delay = 150, write = writeSettings } = {}) {
  let pending = null;
  let timer;
  let lastWrite = Promise.resolve();

  function commit() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return lastWrite;
    const batch = pending;
    pending = null;
    // Serialize atomic replacements, including recovery after an earlier write failed.
    lastWrite = lastWrite.catch(() => {}).then(() => write(file, batch.value));
    lastWrite.then(batch.resolve, batch.reject);
    return lastWrite;
  }

  return {
    save(value) {
      if (!pending) {
        let resolve, reject;
        const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
        pending = { value, promise, resolve, reject };
      } else pending.value = value;
      clearTimeout(timer);
      timer = setTimeout(commit, delay);
      return pending.promise;
    },
    flush: commit,
  };
}
