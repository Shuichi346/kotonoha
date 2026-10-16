import { test, expect } from '@playwright/test';
import { formatTranscript } from '../desktop/transcript.mjs';
const subtitle = { type: 'subtitle', id: 'test-1', source: 'A bridge between languages.', text: '言葉と言葉をつなぐ架け橋。', start: 0, end: 3, latency_ms: 100 };
async function bridge(page, initialLatest = null) {
  await page.addInitScript(({ initialLatest }) => {
    const listeners = new Set();
    const settings = { source: 'en', target: 'ja', fontSize: 40, showOriginal: true, background: 0, expiry: 12 };
    window.testCalls = [];
    window.testEmit = (event) => listeners.forEach((fn) => fn(event));
    window.kotonoha = {
      snapshot: async () => ({ settings, state: 'stopped', latest: initialLatest, history: [], visible: true, locked: false }),
      status: async () => ({ capture: { ready: false, detail: 'macOS permission required' }, asr: { ready: true, detail: 'Ready' }, translation: { ready: true, detail: 'Ready' } }),
      settings: async (value) => { Object.assign(settings, value); window.testEmit({ type: 'settings', settings: value }); return value; },
      start: async () => { window.testCalls.push('start'); window.testEmit({ type: 'status', state: 'listening' }); },
      stop: async () => { window.testCalls.push('stop'); window.testEmit({ type: 'status', state: 'stopped' }); },
      overlay: async (value) => { window.testCalls.push(`overlay:${value}`); window.testEmit({ type: 'overlay', visible: value, locked: false }); },
      lock: async (value) => { window.testCalls.push(`lock:${value}`); window.testEmit({ type: 'overlay', visible: true, locked: value }); },
      showController: async () => { window.testCalls.push('show'); },
      hideController: async () => { window.testCalls.push('hide'); },
      export: async (format) => { window.testCalls.push(`export:${format}`); return true; },
      subscribe: (callback) => { listeners.add(callback); return () => listeners.delete(callback); }
    };
  }, { initialLatest });
}

test('start/stop, language settings, and independent subtitle controls', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await expect(page.getByText('準備完了', { exact: true })).toHaveCount(2);
  await page.getByLabel('字幕の言語', { exact: true }).selectOption('fr');
  await expect(page.getByLabel('字幕の言語', { exact: true })).toHaveValue('fr');
  await page.getByRole('button', { name: '翻訳を開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '翻訳を停止', exact: true })).toBeVisible();
  await expect(page.getByLabel('音声の言語', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '翻訳を停止', exact: true }).click();
  await expect(page.getByLabel('音声の言語', { exact: true })).toBeEnabled();
  await page.getByRole('switch', { name: '字幕ウィンドウを表示', exact: true }).uncheck();
  await page.getByRole('button', { name: /字幕だけにする/ }).click();
  expect(await page.evaluate(() => window.testCalls)).toEqual(['start', 'stop', 'overlay:false', 'hide']);
  await page.getByLabel('字幕の文字サイズ', { exact: true }).focus();
  await page.getByLabel('字幕の文字サイズ', { exact: true }).press('End');
  await expect(page.locator('output').first()).toContainText('72');
});

test('subtitle-only surface is transparent, receives actual events, hides stale captions', async ({ page }) => {
  await bridge(page);
  await page.clock.install();
  await page.goto('/?view=subtitles');
  await expect(page.getByRole('main')).toHaveAttribute('aria-label', '字幕ウィンドウ');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.getByText('音声を、あなたの言葉に。')).toHaveCount(0);
  await page.evaluate((value) => window.testEmit({ ...value, receivedAt: Date.now() }), subtitle);
  await expect(page.getByText(subtitle.text, { exact: true })).toBeVisible();
  await expect(page.getByText(subtitle.source, { exact: true })).toBeVisible();
  const style = await page.locator('.caption-text').evaluate((node) => ({ color: getComputedStyle(node).color, size: getComputedStyle(node).fontSize, textStroke: getComputedStyle(node).webkitTextStrokeWidth }));
  expect(style).toEqual({ color: 'rgb(255, 255, 255)', size: '40px', textStroke: '3px' });
  await page.clock.fastForward(13000);
  await expect(page.getByText(subtitle.text, { exact: true })).toHaveCount(0);
});

test('history, export, error handling and source language conflicts', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await page.getByLabel('音声の言語', { exact: true }).selectOption('ja');
  await expect(page.getByLabel('字幕の言語', { exact: true })).toHaveValue('en');
  await page.evaluate((value) => window.testEmit({ ...value, receivedAt: Date.now() }), subtitle);
  await page.getByRole('button', { name: /履歴/ }).click();
  await expect(page.getByText(subtitle.text, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SRT', exact: true }).click();
  expect(await page.evaluate(() => window.testCalls)).toContain('export:srt');
  await page.getByRole('button', { name: 'ライブ翻訳', exact: true }).click();
  await page.evaluate(() => window.testEmit({ type: 'error', message: '音声の取得に失敗しました。' }));
  await expect(page.getByRole('alert')).toContainText('音声の取得に失敗しました。');
});

test('transcript exports retain every translation and valid monotonic timings', () => {
  const values = [{ ...subtitle, receivedAt: 1000 }, { ...subtitle, id: '2', start: 0, end: 2, receivedAt: 2000 }];
  expect(formatTranscript(values, 'srt')).toBe('1\n00:00:00,000 --> 00:00:03,000\n言葉と言葉をつなぐ架け橋。\n\n2\n00:00:03,000 --> 00:00:05,000\n言葉と言葉をつなぐ架け橋。\n');
  expect(formatTranscript(values, 'txt')).toContain(subtitle.source);
});

test('interface language defaults to Japanese and switches independently from subtitle languages', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await expect(page.locator('.wordmark')).toHaveText('kotonoha');
  await expect(page.getByLabel('表示言語', { exact: true })).toHaveValue('ja');
  await page.getByLabel('表示言語', { exact: true }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Start translation', exact: true })).toBeVisible();
  await expect(page.getByLabel('Audio language', { exact: true })).toHaveValue('en');
  await expect(page.getByLabel('Subtitle language', { exact: true })).toHaveValue('ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('kotonoha — Live subtitle translation');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('History for this session')).toBeVisible();
  await page.getByLabel('Interface language', { exact: true }).selectOption('ja');
  await expect(page.getByText('この起動中の履歴', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});

test('subtitle toolbar follows interface language while retaining subtitle content', async ({ page }) => {
  await bridge(page);
  await page.goto('/?view=subtitles');
  await page.evaluate((value) => window.testEmit({ ...value, receivedAt: Date.now() }), subtitle);
  await page.evaluate(async () => {
    const { settings } = await window.kotonoha.snapshot();
    await window.kotonoha.settings({ ...settings, uiLanguage: 'en' });
  });
  await expect(page.getByRole('main')).toHaveAttribute('aria-label', 'Subtitle window');
  await expect(page.getByRole('button', { name: 'Show controls', exact: true })).toHaveAttribute('title', 'Show controls (⌘⇧K)');
  await expect(page.getByText(subtitle.text, { exact: true })).toBeVisible();
  await expect(page.locator('.overlay-controls button').first().locator('circle')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
