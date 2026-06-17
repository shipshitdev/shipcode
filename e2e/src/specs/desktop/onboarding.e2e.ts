/**
 * Flow 1: Onboarding wizard
 *
 * Boots the app with onboardingVersion = 0 (behind CURRENT_ONBOARDING_VERSION)
 * so the OnboardingWizard renders instead of the main workspace.
 * Verifies that the wizard shows its 3 steps, that Back/Next navigate through
 * them, and that Finish calls settings:set then auto-navigates to the workspace.
 *
 * Auth is deterministic: the harness puts fake `claude`/`codex` CLIs on PATH and
 * sets OPENAI_API_KEY, so the wizard's on-mount `onboarding:check-auth` resolves
 * both agents as authenticated at the main-process boundary. The Next button
 * therefore enables on its own — no renderer-side invoke patching (which can't
 * work anyway: the contextBridge `window.shipcode` object is frozen).
 */
import { expect, test } from '../../fixtures/electron-app';

test.use({ seedOptions: { onboarded: false } });

test.describe('onboarding wizard', () => {
  test('renders with 3-step progress indicators', async ({ harness }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // The three step labels are present. Use exact text: /GitHub/i would also
    // match step-0 body copy like "Check GitHub CLI login" (strict-mode clash).
    await expect(page.getByText('AI Auth', { exact: true })).toBeVisible();
    await expect(page.getByText('Models', { exact: true })).toBeVisible();
    await expect(page.getByText('GitHub', { exact: true })).toBeVisible();
  });

  test('step 0 shows auth check content and navigation buttons', async ({ harness }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // Step 0 renders the auth check step
    await expect(page.getByText(/Connect your AI agents/i)).toBeVisible();

    // Back button is not shown on first step
    await expect(page.getByTestId('onboarding-back-btn')).not.toBeVisible();

    // Next button is rendered (enables once the on-mount auth check resolves)
    await expect(page.getByTestId('onboarding-next-btn')).toBeVisible();
  });

  test('navigates forward and back through all 3 steps', async ({ harness }) => {
    const { page } = harness;

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible();

    // The on-mount auth check resolves both fake CLIs as authenticated, so Next
    // enables without a Re-check click.
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

    // Advance again through step 0 (Next stays enabled from cached auth)
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

    // Auth resolves on mount → Next enabled. Walk to the last step.
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
