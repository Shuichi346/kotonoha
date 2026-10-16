import { readFileSync } from 'node:fs';
export const defaultSettings = { source: 'en', target: 'ja', uiLanguage: 'ja', fontSize: 40, showOriginal: true, background: 0, expiry: 12 };
function invalid(code) { const error = new Error(code); error.code = code; throw error; }
export function validatedSettings(value) {
  const languages = ['en', 'ja', 'de', 'fr', 'es', 'it', 'pt', 'zh', 'ko'];
  if (!value || !languages.includes(value.source) || !languages.includes(value.target) || value.source === value.target) invalid('languagePair');
  const fontSize = Math.round(Number(value.fontSize));
  const background = Number(value.background);
  const expiry = Number(value.expiry);
  if (!Number.isFinite(fontSize) || fontSize < 24 || fontSize > 72 || !Number.isFinite(background) || background < 0 || background > 0.85 || !Number.isFinite(expiry) || expiry < 3 || expiry > 60) invalid('settingsRange');
  return { source: value.source, target: value.target, uiLanguage: value.uiLanguage === 'en' ? 'en' : 'ja', fontSize, background, showOriginal: !!value.showOriginal, expiry };
}
export function loadSettings(currentPath, legacyPaths = []) {
  for (const candidate of [currentPath, ...legacyPaths]) {
    try { return validatedSettings(JSON.parse(readFileSync(candidate, 'utf8'))); }
    catch { /* Skip absent, malformed, or incompatible preferences without overwriting them. */ }
  }
  return { ...defaultSettings };
}
