import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', fullyParallel: false, workers: 1, retries: 0, timeout: 45000,
  expect: { timeout: 8000 },
  use: { baseURL: 'http://127.0.0.1:3101', channel: process.platform === 'win32' ? 'msedge' : undefined, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:3101/api/v1/ready', reuseExistingServer: false, timeout: 30000 },
});
