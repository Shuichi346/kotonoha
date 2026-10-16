import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/interface.spec.mjs', timeout: 20000, retries: 0, workers: 1,
  use: { browserName: 'chromium', headless: true, baseURL: 'http://127.0.0.1:5173' },
  webServer: { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', timeout: 20000, reuseExistingServer: false },
  reporter: [['list']],
});
