/**
 * Flow 1: Onboarding wizard
 *
 * Boots the app with onboardingVersion = 0 (behind CURRENT_ONBOARDING_VERSION)
 * so the OnboardingWizard renders instead of the main workspace.
 * Verifies that the wizard shows its 3 steps, that Back/Next navigate through
 * them, and that Finish calls settings:set then auto-navigates to the workspace.
 */
import { expect, test } from '../../fixtures/electron-app';

test.use({ seedOptions: { onboarded: false } });

/**
 * Inject a fake successful auth response for the next `onboarding:check-auth`
 * invocation. This overrides `window.shipcode.invoke` in the renderer so that
 * when the wizard calls `invoke('onboarding:check-auth')` it gets a mock result
 * where both `claude` and `codex` report as authenticated. The override is
 * one-shot: after the first matching call, the original invoke is restored.
 *
 * This is necessary because in the E2E sandbox neither `claude auth status` nor
 * a real Codex OPENAI_API_KEY are present.
 */
async function injectFakeAuthSuccess(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
    const api = (window as unknown as { shipcode: { invoke: Invoke } }).shipcode;
    const original = api.invoke.bind(api);
    let patched = true;
    const override: Invoke = async (channel, ...args) => {
      if (patched && channel === 'onboarding:check-auth') {
        patched = false;
        try {
          Object.defineProperty(api, 'invoke', { value: original, configurable: true });
        } catch {
          /* contextBridge object may be frozen; best-effort restore */
        }
        return {
          claude: { available: true, authenticated: true, version: '1.0.0-e2e' },
          codex: { available: true, authenticated: true, version: '1.0.0-e2e' },
          gemini: null,
          cursor: null,
          openrouter: null,
          ghAuth: { installed: true, authenticated: true, username: 'e2e-bot', version: '2.0.0' },
        };
      }
      return original(channel, ...args);
    };
    // contextBridge-exposed objects are frozen; defineProperty can still
    // succeed where assignment throws. If both fail the spec falls back to
    // asserting only the auth-independent wizard behaviour.
    try {
      Object.defineProperty(api, 'invoke', { value: override, configurable: true });
    } catch {
      /* frozen bridge — override not applied */
    }
  });
}

test.describe('onboarding wizard', () => {
  test('renders with 3-step progress indicators', async ({ harness }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // Three step labels are present (AI Auth, Models, GitHub)
    await expect(page.getByText(/AI Auth/i)).toBeVisible();
    await expect(page.getByText(/Models/i)).toBeVisible();
    await expect(page.getByText(/GitHub/i)).toBeVisible();
  });

  test('step 0 shows auth check content and navigation buttons', async ({ harness }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // Step 0 renders the auth check step
    await expect(page.getByText(/Connect your AI agents/i)).toBeVisible();

    // Back button is not shown on first step
    await expect(page.getByTestId('onboarding-back-btn')).not.toBeVisible();

    // Next button is rendered (may be disabled until auth resolves)
    await expect(page.getByTestId('onboarding-next-btn')).toBeVisible();
  });

  test('navigates forward and back through all 3 steps', async ({ harness }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // Inject fake auth so the Re-check call returns authenticated CLIs
    await injectFakeAuthSuccess(page);

    // Click Re-check to trigger the auth mutation which will now get fake data
    const recheckBtn = page.getByRole('button', { name: /re-check/i });
    await expect(recheckBtn).toBeVisible({ timeout: 10_000 });
    await recheckBtn.click();

    // Wait for the Next button to become enabled after auth resolves
    const nextBtn = page.getByTestId('onboarding-next-btn');
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });

    // Advance to step 1
    await nextBtn.click();

    // Step 1: Models content visible
    await expect(page.getByText(/planner|model|reviewer/i).first()).toBeVisible();
    await expect(page.getByTestId('onboarding-back-btn')).toBeVisible();

    // Go back to step 0
    await page.getByTestId('onboarding-back-btn').click();
    await expect(page.getByTestId('onboarding-back-btn')).not.toBeVisible();

    // Advance again through step 0 (Next should still be enabled from cached auth)
    await expect(page.getByTestId('onboarding-next-btn')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('onboarding-next-btn').click();

    // Step 1 → step 2
    await page.getByTestId('onboarding-next-btn').click();

    // Step 2: GitHub readiness
    await expect(page.getByText(/GitHub readiness/i)).toBeVisible();

    // Finish button is present on last step; Next is not
    await expect(page.getByTestId('onboarding-finish-btn')).toBeVisible();
    await expect(page.getByTestId('onboarding-next-btn')).not.toBeVisible();
    await expect(page.getByTestId('onboarding-back-btn')).toBeVisible();
  });

  test('finishing onboarding dismisses the wizard and shows the main workspace', async ({
    harness,
  }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // Inject fake auth and trigger re-check to enable the Next button
    await injectFakeAuthSuccess(page);
    const recheckBtn = page.getByRole('button', { name: /re-check/i });
    await expect(recheckBtn).toBeVisible({ timeout: 10_000 });
    await recheckBtn.click();

    await expect(page.getByTestId('onboarding-next-btn')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('onboarding-next-btn').click(); // step 0 → 1
    await page.getByTestId('onboarding-next-btn').click(); // step 1 → 2

    // Finish
    await expect(page.getByTestId('onboarding-finish-btn')).toBeVisible();
    await page.getByTestId('onboarding-finish-btn').click();

    // Wizard should unmount after settings:set completes
    await expect(page.getByTestId('onboarding-wizard')).not.toBeVisible({ timeout: 15_000 });

    // The main workspace shell is now mounted
    await expect(page.locator('[data-project-sidebar]').first()).toBeVisible({ timeout: 15_000 });
  });
});
