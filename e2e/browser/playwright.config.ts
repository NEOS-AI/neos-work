/**
 * Playwright config for Web Design Project browser E2E (v0.15 M2).
 *
 * Boots:
 *   1) built engine (`apps/server/dist`)
 *   2) Vite web dev server (proxies /api → engine)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const token =
  (process.env.NEOS_AUTH_TOKEN || '').trim().length >= 16
    ? process.env.NEOS_AUTH_TOKEN!.trim()
    : `browser-e2e-${crypto.randomBytes(16).toString('hex')}`;

const serverPort = Number(process.env.NEOS_BROWSER_SERVER_PORT || 14110);
const webPort = Number(process.env.NEOS_BROWSER_WEB_PORT || 5174);
const dataDir =
  process.env.NEOS_DATA_DIR?.trim()
  || fs.mkdtempSync(path.join(os.tmpdir(), 'neos-browser-e2e-'));

// Export for specs via process.env (Playwright workers inherit)
process.env.NEOS_AUTH_TOKEN = token;
process.env.NEOS_BROWSER_TOKEN = token;
process.env.NEOS_BROWSER_SERVER_PORT = String(serverPort);
process.env.NEOS_BROWSER_WEB_PORT = String(webPort);
process.env.NEOS_DATA_DIR = dataDir;
process.env.NEOS_SERVER_URL = `http://127.0.0.1:${serverPort}`;

const serverEntry = path.join(ROOT, 'apps/server/dist/index.js');
if (!fs.existsSync(serverEntry)) {
  // webServer will fail; surface a clear message when tests load config
  console.warn(
    '[e2e:browser] server dist missing — run: pnpm --filter @neos-work/server... build',
  );
}

export default defineConfig({
  testDir: path.join(__dirname, 'specs'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${process.execPath} "${serverEntry}"`,
      cwd: path.join(ROOT, 'apps/server'),
      url: `http://127.0.0.1:${serverPort}/api/health`,
      reuseExistingServer: !process.env.CI && process.env.NEOS_BROWSER_REUSE === '1',
      timeout: 120_000,
      env: {
        ...process.env,
        NEOS_HOST: '127.0.0.1',
        NEOS_PORT: String(serverPort),
        NEOS_AUTH_TOKEN: token,
        NEOS_DATA_DIR: dataDir,
        NEOS_ALLOW_ANY_HOST: '1',
        NODE_ENV: process.env.NODE_ENV || 'test',
      },
    },
    {
      command: `pnpm --filter @neos-work/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: ROOT,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI && process.env.NEOS_BROWSER_REUSE === '1',
      timeout: 120_000,
      env: {
        ...process.env,
        NEOS_SERVER_URL: `http://127.0.0.1:${serverPort}`,
      },
    },
  ],
});
