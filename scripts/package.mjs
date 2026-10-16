import { packager } from '@electron/packager';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stageRuntime } from './stage-runtime.mjs';
await mkdir('.scratch', { recursive: true });
const runtime = stageRuntime(resolve('.'), process.env.KOTONOHA_RUNTIME_BASE);
await writeFile('.scratch/runtime.json', JSON.stringify(runtime));
console.log(`Local runtime: ${runtime.root}`);
const paths = await packager({
  dir: '.', out: process.env.KOTONOHA_PACKAGE_OUT || 'release', name: 'kotonoha', platform: 'darwin', arch: 'arm64',
  appBundleId: 'jp.kotonoha.live-subtitles', appCategoryType: 'public.app-category.productivity',
  appVersion: '0.1.0', icon: 'assets/kotonoha.icns', overwrite: true, asar: true,
  ignore: [/^\/(backend|native|models|\.venv|\.git|\.scratch|tests|scripts|frontend|release)(\/|$)/, /uv.lock/, /pyproject.toml/],
  extraResource: ['.scratch/runtime.json'],
  extendInfo: { LSMinimumSystemVersion: '26.0', LSUIElement: false, LSBackgroundOnly: false, NSAudioCaptureUsageDescription: '再生中の音声をこのMacで文字起こしし、翻訳字幕を表示します。', NSScreenCaptureUsageDescription: 'システム音声を取得して翻訳字幕を表示します。' }
});
console.log(paths.join('\n'));
