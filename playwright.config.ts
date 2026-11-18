import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

const fallbackHeadlessShell =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (fs.existsSync(fallbackHeadlessShell) ? fallbackHeadlessShell : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    screenshot: 'only-on-failure',
    trace: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});
