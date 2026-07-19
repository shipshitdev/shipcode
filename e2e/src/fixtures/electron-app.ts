import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _electron,
  test as base,
  type ElectronApplication,
  expect,
  type Page,
} from '@playwright/test';
import { type SeedOptions, type SeedResult, seedDatabase } from './seed';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');
const DESKTOP_MAIN = path.join(DESKTOP_DIR, 'dist', 'main', 'index.js');
const FAKE_BIN = path.join(REPO_ROOT, 'e2e', 'fixtures', 'bin');

// Resolve Electron's binary from the desktop package so we launch the exact
// version the app is built against, regardless of workspace hoisting.
const requireFromDesktop = createRequire(path.join(DESKTOP_DIR, 'package.json'));
const ELECTRON_PATH = requireFromDesktop('electron') as string;

export interface Harness {
  app: ElectronApplication;
  page: Page;
  seed: SeedResult;
  /** Invoke a renderer-to-main IPC channel through the preload bridge. */
  invoke<T>(channel: string, args?: unknown): Promise<T>;
  /** Push a main→renderer IPC event (e.g. pipeline:phase, terminal:event). */
  fire(channel: string, ...args: unknown[]): Promise<void>;
  /** Read the renderer Zustand store snapshot (exposed in E2E mode). */
  getState(): Promise<Record<string, unknown>>;
  /** Patch the renderer Zustand store directly to drive view state. */
  setState(patch: Record<string, unknown>): Promise<void>;
  /** Invoke a Zustand store action by name (e.g. selectProject, openIssue). */
  callStore(action: string, ...args: unknown[]): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Launch the built Electron app against a fresh, fully-mocked environment:
 * temp userData (isolated SQLite seeded by `seedDatabase`), fake `gh`/`claude`/
 * `codex` CLIs on PATH (so health checks resolve installed + authenticated
 * without real logins), and SHIPCODE_E2E_MODE to suppress reconciliation/
 * watchdog/telemetry/splash. Returns a harness with the main window and IPC/
 * store helpers.
 */
export async function launchApp(seedOptions: SeedOptions = {}): Promise<Harness> {
  if (!fs.existsSync(DESKTOP_MAIN)) {
    throw new Error(
      `[e2e] missing desktop bundle at ${DESKTOP_MAIN}. Run \`bun --filter @shipcode/desktop build:code\` first.`,
    );
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-e2e-ud-'));
  const seed = seedDatabase(path.join(userData, 'data'), seedOptions);

  const app = await _electron.launch({
    executablePath: ELECTRON_PATH,
    args: [DESKTOP_DIR, `--user-data-dir=${userData}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SHIPCODE_E2E_MODE: '1',
      SHIPCODE_TELEMETRY_ENABLED: 'false',
      SHIPCODE_SENTRY_DSN: '',
      OPENROUTER_API_KEY: 'test-key',
      // Satisfies checkCodexAuth() (reads the env var, no codex shell-out) so the
      // onboarding wizard sees Codex authenticated. Paired with the fake `codex`
      // on PATH (availability) it marks Codex authenticated end-to-end.
      OPENAI_API_KEY: 'test-key',
      VITE_DEV_SERVER_URL: '',
      PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });

  const page = await app.firstWindow();
  // Wait for the preload bridge + the E2E store hook to be installed before
  // any spec drives the UI.
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { shipcode?: { invoke?: unknown } }).shipcode?.invoke &&
          (window as unknown as { __APP_STORE__?: unknown }).__APP_STORE__,
      ),
    undefined,
    { timeout: 30_000 },
  );

  const invoke = <T>(channel: string, args?: unknown): Promise<T> =>
    page.evaluate(
      ({ channel, args }) =>
        (
          window as unknown as {
            shipcode: { invoke(channel: string, args?: unknown): Promise<unknown> };
          }
        ).shipcode.invoke(channel, args),
      { channel, args },
    ) as Promise<T>;

  const fire: Harness['fire'] = async (channel, ...args) => {
    await app.evaluate(
      ({ BrowserWindow }, payload) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error(`[e2e] fire('${payload.channel}'): no BrowserWindow found`);
        }
        win.webContents.send(payload.channel, ...payload.args);
      },
      { channel, args },
    );
  };

  const getState: Harness['getState'] = () =>
    page.evaluate(() => {
      const store = (
        window as unknown as { __APP_STORE__?: { getState(): Record<string, unknown> } }
      ).__APP_STORE__;
      return store ? store.getState() : {};
    });

  const setState: Harness['setState'] = (patch) =>
    page.evaluate((next) => {
      (
        window as unknown as { __APP_STORE__?: { setState(p: Record<string, unknown>): void } }
      ).__APP_STORE__?.setState(next);
    }, patch);

  const callStore: Harness['callStore'] = (action, ...args) =>
    page.evaluate(
      (input) => {
        const store = (
          window as unknown as {
            __APP_STORE__?: { getState(): Record<string, (...a: unknown[]) => unknown> };
          }
        ).__APP_STORE__;
        const state = store?.getState();
        const fn = state?.[input.action];
        if (typeof fn !== 'function') {
          throw new Error(`store action not found: ${input.action}`);
        }
        fn(...input.args);
      },
      { action, args },
    );

  const cleanup: Harness['cleanup'] = async () => {
    // app.close() can occasionally hang on macOS teardown; race it with a
    // timeout and then force-kill the Electron process so a slow shutdown
    // never blows the test timeout.
    try {
      await Promise.race([app.close(), new Promise<void>((resolve) => setTimeout(resolve, 8_000))]);
    } catch {
      /* ignore close errors — force-kill below */
    }
    try {
      app.process()?.kill('SIGKILL');
    } catch {
      /* process already exited */
    }
    fs.rmSync(userData, { recursive: true, force: true });
    if (seed.projectPath) fs.rmSync(seed.projectPath, { recursive: true, force: true });
    for (const cleanupPath of seed.cleanupPaths) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  };

  return { app, page, seed, invoke, fire, getState, setState, callStore, cleanup };
}

interface HarnessFixtures {
  seedOptions: SeedOptions;
  harness: Harness;
}

/**
 * Playwright `test` extended with an auto-managed Electron harness. Specs set
 * their seed via `test.use({ seedOptions: { … } })` and consume `harness`.
 */
export const test = base.extend<HarnessFixtures>({
  seedOptions: [{}, { option: true }],
  harness: async ({ seedOptions }, use) => {
    const harness = await launchApp(seedOptions);
    await use(harness);
    await harness.cleanup();
  },
});

export { expect };
