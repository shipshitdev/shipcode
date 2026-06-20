import { defineConfig } from '@playwright/test';

/**
 * Repo-level E2E config for ShipCode.
 *
 * Three projects:
 *  - `desktop`   — launches the built Electron app (apps/desktop/dist) via
 *                  Playwright's _electron API and drives real user journeys
 *                  against the real main-process IPC surface. Deterministic:
 *                  a fresh temp userData + pre-seeded SQLite + a fake `gh`
 *                  binary + SHIPCODE_E2E_MODE disable all live network / LLM /
 *                  reconciliation behaviour (see src/fixtures/electron-app.ts).
 *  - `web-smoke` — builds the static web + docs exports and asserts the
 *                  landing page and key docs routes serve without broken
 *                  critical content. Each spec owns its static server
 *                  lifecycle (see src/fixtures/static-server.ts), so this
 *                  project is fully independent of the desktop one.
 *  - `cli`       — builds and executes the packaged Node CLI in a temp HOME.
 *
 * Run everything: `bun run e2e`. Single project: `--project=desktop` /
 * `--project=web-smoke` / `--project=cli`.
 */
export default defineConfig({
  testDir: './src/specs',
  // Electron allows a single app instance per launch; desktop specs each spin
  // up their own app, so we keep workers serial to avoid userData/port races.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: './src/global-setup.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  projects: [
    {
      name: 'desktop',
      testMatch: /desktop\/.*\.e2e\.ts$/,
    },
    {
      name: 'web-smoke',
      testMatch: /web\/.*\.e2e\.ts$/,
    },
    {
      name: 'cli',
      testMatch: /cli\/.*\.e2e\.ts$/,
    },
  ],
});
