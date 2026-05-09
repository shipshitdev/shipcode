import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test as base, _electron as electron, expect } from '@playwright/test';

type Fixtures = {
  electronApp: ElectronApplication;
  page: Page;
  rendererErrors: string[];
  userDataDir: string;
};

const ignoredConsoleErrors = [/ResizeObserver loop/i];

const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture callbacks require object destructuring.
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'shipcode-e2e-'));
    try {
      await use(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },

  electronApp: async ({ userDataDir }, use) => {
    const desktopRoot = process.cwd();
    const {
      ELECTRON_RUN_AS_NODE: _electronRunAsNode,
      VITE_DEV_SERVER_URL: _viteDevServerUrl,
      ...baseEnv
    } = process.env;

    const app = await electron.launch({
      args: [desktopRoot],
      cwd: desktopRoot,
      env: {
        ...baseEnv,
        NODE_ENV: 'test',
        SHIPCODE_E2E: '1',
        SHIPCODE_USER_DATA_DIR: userDataDir,
      },
    });

    try {
      await use(app);
    } finally {
      await app.close();
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow({ timeout: 20_000 });
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },

  rendererErrors: async ({ page }, use) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (ignoredConsoleErrors.some((pattern) => pattern.test(text))) return;
      errors.push(text);
    });

    await use(errors);
  },
});

test.afterEach(async ({ rendererErrors }) => {
  expect(rendererErrors).toEqual([]);
});

test('boots hidden with isolated app data', async ({ electronApp, page, userDataDir }) => {
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('[data-project-sidebar]')).toBeVisible();

  const actualUserDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  expect(actualUserDataDir).toBe(userDataDir);
});

test('navigates primary app surfaces without renderer errors', async ({ page }) => {
  for (const label of ['Inbox', 'Activity', 'Skills', 'Automations', 'Costs', 'Overview']) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  }
});

test('opens settings sections without external auth checks', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle Settings' }).click();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

  const sections = [
    ['Integrations', 'Integrations'],
    ['GitHub', 'GitHub'],
    ['Notifications', 'Notifications'],
    ['Pipeline', 'Pipeline'],
    ['Auto-commit', 'Auto-commit & Cleanup'],
    ['Shortcuts', 'Keyboard Shortcuts'],
    ['Developer', 'Developer'],
    ['About', 'About'],
  ] as const;

  for (const [buttonLabel, heading] of sections) {
    await page.getByRole('button', { name: buttonLabel }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Back to app' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});
