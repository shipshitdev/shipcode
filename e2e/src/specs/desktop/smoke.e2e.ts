import { expect, test } from '../../fixtures/electron-app';

/**
 * Harness smoke: proves the real Electron app launches deterministically under
 * SHIPCODE_E2E_MODE, the preload bridge + exposed store are reachable, and the
 * onboarding gate is driven by seeded settings. Every other desktop spec builds
 * on the guarantees asserted here.
 */
test.describe('harness smoke', () => {
  test('boots an onboarded workspace with the store exposed', async ({ harness }) => {
    await expect(harness.page.locator('#root')).toBeVisible();

    const mainWindow = await harness.app.browserWindow(harness.page);
    const securityPreferences = await mainWindow.evaluate((browserWindow) => {
      const preferences = browserWindow.webContents.getLastWebPreferences();
      return {
        allowRunningInsecureContent: preferences.allowRunningInsecureContent,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        nodeIntegrationInSubFrames: preferences.nodeIntegrationInSubFrames,
        nodeIntegrationInWorker: preferences.nodeIntegrationInWorker === true,
        sandbox: preferences.sandbox,
        webSecurity: preferences.webSecurity,
        webviewTag: preferences.webviewTag,
      };
    });
    expect(securityPreferences).toEqual({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });

    const preloadBridge = await harness.page.evaluate(() => {
      const bridge = (
        window as unknown as {
          shipcode?: { invoke?: unknown; on?: unknown };
        }
      ).shipcode;
      return {
        frozen: bridge ? Object.isFrozen(bridge) : false,
        hasInvoke: typeof bridge?.invoke === 'function',
        hasOn: typeof bridge?.on === 'function',
      };
    });
    expect(preloadBridge).toEqual({ frozen: true, hasInvoke: true, hasOn: true });
    await expect(harness.invoke('settings:get')).resolves.toBeTruthy();

    const state = await harness.getState();
    expect(state).toBeTruthy();
    expect(typeof state.viewMode).toBe('string');

    // Store is writable from the test side (drives later flow specs).
    await harness.setState({ viewMode: 'inbox' });
    expect((await harness.getState()).viewMode).toBe('inbox');
  });
});

test.describe('harness smoke — onboarding gate', () => {
  test.use({ seedOptions: { onboarded: false } });

  test('renders the onboarding wizard when onboardingVersion is behind', async ({ harness }) => {
    await expect(harness.page.locator('#root')).toBeVisible();
    await expect(
      harness.page.getByText(/onboard|welcome|get started|auth|github/i).first(),
    ).toBeVisible();
  });
});
