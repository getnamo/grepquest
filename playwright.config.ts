import { defineConfig } from '@playwright/test';
const port = process.env.PLAYWRIGHT_TEST_PORT ?? '3100';
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  use: { baseURL, viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'npm run build && npm start', url: `${baseURL}/api/health`, env: { HOST: '127.0.0.1', PORT: port }, reuseExistingServer: false, timeout: 30000 },
});
