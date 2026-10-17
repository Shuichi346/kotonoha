import { test, expect } from '@playwright/test';
import { formatTranscript } from '../desktop/transcript.mjs';
import { defaultSettings } from '../desktop/preferences.mjs';
const subtitle = { type: 'subtitle', id: 'test-1', source: 'A bridge between languages.', text: '言葉と言葉をつなぐ架け橋。', start: 0, end: 3, latency_ms: 100 };
async function bridge(page, initialLatest = null, options = {}) {
  await page.addInitScript(({ initialLatest, options, defaultSettings }) => {
    const listeners = new Set();
    const settings = { ...defaultSettings };
    window.testCalls = [];
    window.testPermission = options.permission || 'granted';
    window.testStatusFailure = false;
    window.testRequestFailure = false;
    window.testResolvePermission = null;
    window.testEmit = (event) => listeners.forEach((fn) => fn(event));
    window.kotonoha = {
      snapshot: async () => ({ settings, state: 'stopped', latest: initialLatest, history: [], visible: true, locked: false }),
      status: async () => {
        if (window.testStatusFailure) throw new Error('backend unavailable');
        return { capture: { ready: window.testPermission === 'granted', permission: window.testPermission, detail: 'Permission status' }, asr: { ready: true, detail: 'Ready' }, translation: { ready: true, detail: 'Ready' } };
      },
      requestCapturePermission: async () => {
        window.testCalls.push('permission');
        if (options.deferPermission) await new Promise((resolve) => { window.testResolvePermission = resolve; });
        if (window.testRequestFailure) throw new Error('native helper error');
        window.testPermission = options.requestResult || 'required';
        return { ready: window.testPermission === 'granted', permission: window.testPermission, detail: 'Permission status' };
      },
      openCaptureSettings: async () => { window.testCalls.push('settings'); },
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
  }, { initialLatest, options, defaultSettings });
}

test('start/stop, language settings, and independent subtitle controls', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await expect(page.getByText('準備完了', { exact: true })).toHaveCount(2);
  await expect(page.getByLabel('字幕の文字サイズ', { exact: true })).toHaveValue('30');
  await expect(page.getByRole('switch', { name: '字幕ウィンドウを表示', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: '原文も表示', exact: true })).not.toBeChecked();
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
  await expect(page.locator('.overlay-hint')).toBeVisible();
  expect(await page.locator('.overlay').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(220, 224, 230, 0.78)');
  await page.evaluate((value) => window.testEmit({ ...value, receivedAt: Date.now() }), subtitle);
  await expect(page.getByText(subtitle.text, { exact: true })).toBeVisible();
  await expect(page.getByText(subtitle.source, { exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const { settings } = await window.kotonoha.snapshot();
    await window.kotonoha.settings({ ...settings, showOriginal: true });
  });
  await expect(page.getByText(subtitle.source, { exact: true })).toBeVisible();
  const style = await page.locator('.caption-text').evaluate((node) => ({ color: getComputedStyle(node).color, size: getComputedStyle(node).fontSize, textStroke: getComputedStyle(node).webkitTextStrokeWidth }));
  expect(style).toEqual({ color: 'rgb(255, 255, 255)', size: '30px', textStroke: '3px' });
  await page.evaluate(() => window.kotonoha.lock(true));
  await expect(page.locator('.overlay')).toHaveClass(/is-locked/);
  await expect(page.locator('.overlay-controls')).toBeHidden();
  expect(await page.locator('.overlay').evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, drag: getComputedStyle(node).getPropertyValue('-webkit-app-region') }))).toEqual({ background: 'rgba(0, 0, 0, 0)', drag: 'no-drag' });
  await page.clock.fastForward(13000);
  await expect(page.getByText(subtitle.text, { exact: true })).toHaveCount(0);
  await expect(page.locator('.overlay-hint')).toContainText('クリックは下のアプリに届きます');
  expect(await page.locator('.overlay').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(220, 224, 230, 0.78)');
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
  await expect(page.getByLabel('Language', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('ja');
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Live translation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start translation', exact: true })).toBeVisible();
  await expect(page.getByLabel('Audio language', { exact: true })).toHaveValue('en');
  await expect(page.getByLabel('Subtitle language', { exact: true })).toHaveValue('ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('kotonoha — Live subtitle translation');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('History for this session')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('ja');
  await page.getByRole('button', { name: '履歴', exact: true }).click();
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

async function verifyTabTargets(page, names) {
  const nav = page.getByRole('navigation');
  for (const name of names) {
    const button = nav.getByRole('button', { name, exact: true });
    const geometry = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const label = document.createRange();
      label.selectNodeContents(element);
      const text = label.getBoundingClientRect();
      return {
        height: bounds.height,
        centerOffset: Math.abs((bounds.left + bounds.right - text.left - text.right) / 2),
        edgesHit: [bounds.left + 2, bounds.right - 2].every((x) => document.elementFromPoint(x, bounds.top + bounds.height / 2)?.closest('button') === element),
      };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.centerOffset).toBeLessThan(1);
    expect(geometry.edgesHit).toBe(true);
    const bounds = await button.boundingBox();
    for (const x of [2, bounds.width - 2]) {
      await nav.getByRole('button').first().click();
      await button.click({ position: { x, y: bounds.height / 2 } });
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
  await nav.getByRole('button').first().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(nav.getByRole('button').last()).toHaveAttribute('aria-pressed', 'true');
}

for (const viewport of [{ width: 480, height: 640 }, { width: 420, height: 500 }]) {
  test(`settings tab saves interval and keeps natural-boundary guidance at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await bridge(page);
    await page.goto('/');
    await expect(page).toHaveURL('http://127.0.0.1:5173/');
    await expect(page).toHaveTitle('kotonoha — ライブ字幕翻訳');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByLabel('Language', { exact: true })).toHaveCount(0);
    await verifyTabTargets(page, ['ライブ翻訳', '履歴', '設定']);
    const interval = page.getByLabel('確定要求の間隔', { exact: true });
    await expect(interval).toHaveValue('15');
    await expect(interval.locator('option')).toHaveText(['5秒', '10秒', '15秒', '20秒', '30秒']);
    await expect(page.getByText(/自然な区切りはそのまま/)).toBeVisible();
    await interval.selectOption('10');
    await page.screenshot({ path: `/private/tmp/kotonoha-settings-ja-${viewport.width}.png`, animations: 'disabled' });
    await page.getByLabel('Language', { exact: true }).selectOption('en');
    await verifyTabTargets(page, ['Live translation', 'History', 'Settings']);
    await expect(page.getByLabel('Finalization request interval', { exact: true })).toHaveValue('10');
    await expect(page).toHaveTitle('kotonoha — Live subtitle translation');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/private/tmp/kotonoha-settings-${viewport.width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Live translation', exact: true }).click();
    await expect(page.getByLabel('Audio language', { exact: true })).toHaveValue('en');
    await expect(page.getByLabel('Subtitle language', { exact: true })).toHaveValue('ja');
    await page.getByRole('button', { name: 'Start translation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Finalization request interval', { exact: true })).toBeDisabled();
    await expect(page.getByText('Stop translation on the Live translation tab to change the interval.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Language', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Live translation', exact: true }).click();
    await page.getByRole('button', { name: 'Stop translation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Finalization request interval', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Finalization request interval', { exact: true })).toHaveValue('10');
    expect((await page.evaluate(() => window.kotonoha.snapshot())).settings.commitIntervalSeconds).toBe(10);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [{ width: 480, height: 640 }, { width: 420, height: 500 }]) {
  test(`permission requests stay prominent before and after retry at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await bridge(page, null, { permission: 'required' });
    await page.goto('/');
    await expect(page).toHaveURL('http://127.0.0.1:5173/');
    await expect(page).toHaveTitle('kotonoha — ライブ字幕翻訳');
    const guide = page.getByRole('dialog');
    const request = guide.getByRole('button', { name: '許可画面へ進む', exact: true });
    for (const stage of ['initial', 'retry']) {
      await request.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await expect(request).toHaveCSS('background-color', 'rgb(201, 54, 54)');
      await expect(request).toHaveCSS('color', 'rgb(255, 255, 255)');
      const bounds = await request.boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(48);
      expect(bounds.width).toBeGreaterThan(viewport.width - 110);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: `/private/tmp/kotonoha-permission-${stage}-${viewport.width}.png`, animations: 'disabled' });
      await request.click({ position: { x: bounds.width - 3, y: bounds.height / 2 } });
      await expect(guide).toContainText('許可を確認できていません');
      expect(await page.evaluate(() => window.testCalls)).toEqual(stage === 'initial' ? ['permission'] : ['permission', 'permission']);
    }
    await expect(guide.getByRole('button', { name: '許可状況を確認', exact: true })).toBeEnabled();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}


test('first permission guide separates explanation, OS approval, verification, and explicit start', async ({ page }) => {
  await page.setViewportSize({ width: 510, height: 850 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await bridge(page, null, { permission: 'required' });
  await page.goto('/');
  await expect(page).toHaveTitle('kotonoha — ライブ字幕翻訳');
  const guide = page.getByRole('dialog', { name: '翻訳を始める前に' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('listitem')).toHaveCount(3);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);
  await expect(guide).toContainText('この操作では翻訳は始まりません');
  expect(await page.evaluate(() => window.testCalls)).toEqual([]);
  await page.screenshot({ path: '/private/tmp/kotonoha-permission-guide.png' });
  await guide.getByRole('button', { name: '許可画面へ進む', exact: true }).click();
  await expect(guide).toContainText('許可を確認できていません');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.testCalls)).toEqual(['permission']);
  await guide.getByRole('button', { name: 'システム設定を開く', exact: true }).click();
  await page.evaluate(() => { window.testPermission = 'granted'; });
  await guide.getByRole('button', { name: '許可状況を確認', exact: true }).click();
  await expect(guide).toContainText('システム音声へのアクセスを確認できました');
  expect(await page.evaluate(() => window.testCalls)).toEqual(['permission', 'settings']);
  await guide.getByRole('button', { name: '閉じて翻訳へ', exact: true }).click();
  await expect(guide).not.toBeVisible();
  await page.getByRole('button', { name: '翻訳を開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '翻訳を停止', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testCalls)).toEqual(['permission', 'settings', 'start']);
  expect(errors).toEqual([]);
});

test('deferred or declined permission cannot trigger startup or duplicate prompts; guide remains accessible', async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 680 });
  await bridge(page, null, { permission: 'required', deferPermission: true });
  await page.goto('/');
  const guide = page.getByRole('dialog');
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: '許可画面へ進む', exact: true }).click();
  await expect(guide.getByRole('button', { name: 'macOSの許可画面で操作してください…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(guide).toBeVisible();
  expect(await page.evaluate(() => window.testCalls)).toEqual(['permission']);
  await page.evaluate(() => window.testResolvePermission());
  await expect(guide.getByRole('button', { name: '許可状況を確認', exact: true })).toBeEnabled();
  await expect(guide).toContainText('終了して開き直してください');
  await page.screenshot({ path: '/private/tmp/kotonoha-permission-pending.png' });
  const bounds = await guide.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(450);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(680);
  await page.keyboard.press('Escape');
  await expect(guide).not.toBeVisible();
  await expect(page.locator('.permission-notice')).toContainText('システム音声へのアクセスがまだ許可されていません');
  await page.getByRole('button', { name: '音声の許可を設定', exact: true }).click();
  await expect(guide).toBeVisible();
  expect(await page.evaluate(() => window.testCalls)).toEqual(['permission']);
  await guide.getByRole('button', { name: 'あとで設定する', exact: true }).click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expect(guide).toHaveAccessibleName('Before you start translating');
  await expect(guide).toContainText('Choose “Allow” in macOS');
});

test('permission revocation and failures show localized actionable guidance without raw helper errors', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '翻訳を開始', exact: true })).toBeEnabled();
  await page.evaluate(() => window.testEmit({ type: 'error', code: 'capture_permission_required', message: 'audio-capture: Screen & System Audio Recording permission is required' }));
  const guide = page.getByRole('dialog');
  await expect(guide).toBeVisible();
  await expect(page.getByText(/audio-capture:/)).toHaveCount(0);
  await page.evaluate(() => { window.testRequestFailure = true; });
  await guide.getByRole('button', { name: '許可画面へ進む', exact: true }).click();
  await expect(guide).toContainText('許可画面を開けませんでした。システム設定から許可して');
  await page.evaluate(() => { window.testStatusFailure = true; });
  await guide.getByRole('button', { name: '許可状況を確認', exact: true }).click();
  await expect(guide).toContainText('音声へのアクセスを確認できませんでした。少し待って');
  await expect(guide.getByRole('button', { name: 'システム設定を開く', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.testCalls)).toEqual(['permission']);
});

test('settings-first setup and failed permission requests retain an explicit prompt retry', async ({ page }) => {
  await bridge(page, null, { permission: 'required', requestResult: 'granted' });
  await page.goto('/');
  const guide = page.getByRole('dialog');
  await guide.getByRole('button', { name: 'システム設定を開く', exact: true }).click();
  await expect(guide.getByRole('button', { name: '許可状況を確認', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.testRequestFailure = true; });
  await guide.getByRole('button', { name: '許可画面へ進む', exact: true }).click();
  await expect(guide).toContainText('許可画面を開けませんでした');
  await page.evaluate(() => { window.testRequestFailure = false; });
  await guide.getByRole('button', { name: '許可画面へ進む', exact: true }).click();
  await expect(guide).toContainText('システム音声へのアクセスを確認できました');
  expect(await page.evaluate(() => window.testCalls)).toEqual(['settings', 'permission', 'permission']);
  await guide.getByRole('button', { name: '閉じて翻訳へ', exact: true }).click();
  await page.getByRole('button', { name: '翻訳を開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '翻訳を停止', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testCalls)).toEqual(['settings', 'permission', 'permission', 'start']);
});


test('switch text and row whitespace do not toggle; switch clicks and keyboard still work', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await page.getByText('表示を調整', { exact: true }).click();
  for (const name of ['字幕ウィンドウを表示', '原文も表示', 'クリックを動画に通す']) {
    const control = page.getByRole('switch', { name, exact: true });
    const row = control.locator('..');
    const initiallyChecked = await control.isChecked();
    const calls = await page.evaluate(() => [...window.testCalls]);
    await row.getByText(name, { exact: true }).click();
    await expect(control).toBeChecked({ checked: initiallyChecked });
    const bounds = await row.boundingBox();
    await row.click({ position: { x: bounds.width - 60, y: bounds.height / 2 } });
    await expect(control).toBeChecked({ checked: initiallyChecked });
    expect(await page.evaluate(() => window.testCalls)).toEqual(calls);
    await control.click();
    await expect(control).toBeChecked({ checked: !initiallyChecked });
    await control.press('Space');
    await expect(control).toBeChecked({ checked: initiallyChecked });
  }
});

test('compact controller keeps primary controls usable and lower settings reachable by scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 600 });
  await bridge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '翻訳を開始', exact: true })).toBeVisible();
  await expect(page.getByLabel('Language', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('switch', { name: '原文も表示', exact: true }).check();
  await expect(page.getByRole('switch', { name: '原文も表示', exact: true })).toBeChecked();
  await page.getByText('ローカルモデル', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('Hy-MT2 1.8B', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Live translation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start translation', exact: true })).toBeVisible();
});
