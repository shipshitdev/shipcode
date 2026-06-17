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
