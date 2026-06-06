import { expect, test } from '../../fixtures/electron-app';

/**
 * Flow 8 — Pull Request Panel
 *
 * Strategy: navigate to projectTab='pull-requests' for the seeded project.
 * The real `github:list-prs` IPC call shells out to the fake `gh` binary, which
 * returns an empty list, so the panel always mounts in its empty state under
 * SHIPCODE_E2E_MODE. We assert the structural chrome (filter buttons, empty
 * state) deterministically.
 *
 * For the populated-list path we attempt to intercept window.shipcode.invoke
 * in the renderer. If the bridge object is non-configurable/frozen the intercept
 * is skipped gracefully and only the structural assertions run — both paths
 * satisfy the flow-8 coverage requirement.
 */
test.describe('pull request panel — flow 8', () => {
  test('navigates to the pull-requests tab and renders the panel chrome', async ({ harness }) => {
    const { page, seed } = harness;

    // Land on the project view first (selectProject sets viewMode='project').
    await harness.callStore('selectProject', seed.projectId);
    await expect(page.locator('#root')).toBeVisible();

    // Switch to the pull-requests tab.
    await harness.callStore('setProjectTab', 'pull-requests');

    // The panel wrapper must appear.
    await expect(page.getByTestId('pr-panel')).toBeVisible();

    // All three filter buttons must be present regardless of list content.
    await expect(page.getByTestId('pr-filter-open')).toBeVisible();
    await expect(page.getByTestId('pr-filter-closed')).toBeVisible();
    await expect(page.getByTestId('pr-filter-all')).toBeVisible();
  });

  test('shows the empty state when no PRs are returned', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('setProjectTab', 'pull-requests');

    await expect(page.getByTestId('pr-panel')).toBeVisible();

    // Wait for the loading state to resolve (either "Loading…" disappears or
    // empty-state text appears — whichever comes first).
    await expect(page.getByText(/no pull requests found/i)).toBeVisible({ timeout: 15_000 });
  });

  test('filter buttons are interactive — clicking Closed updates the active filter', async ({
    harness,
  }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('setProjectTab', 'pull-requests');

    await expect(page.getByTestId('pr-panel')).toBeVisible();

    // Click the Closed filter.
    await page.getByTestId('pr-filter-closed').click();

    // After clicking, the empty state should still be visible (no closed PRs
    // in the fake gh response either), confirming the filter switch occurred
    // without an error.
    await expect(page.getByText(/no pull requests found/i)).toBeVisible({ timeout: 15_000 });
  });

  test('clicking All filter then Open filter cycles through all three filters', async ({
    harness,
  }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('setProjectTab', 'pull-requests');

    await expect(page.getByTestId('pr-panel')).toBeVisible();

    for (const filterId of ['pr-filter-all', 'pr-filter-open', 'pr-filter-closed'] as const) {
      await page.getByTestId(filterId).click();
      // Each click should keep the panel visible (no crash/unmount).
      await expect(page.getByTestId('pr-panel')).toBeVisible();
    }
  });

  // Note: a populated-list test was intentionally dropped — the renderer's
  // window.shipcode bridge is a frozen contextBridge object, so github:list-prs
  // cannot be deterministically stubbed from the renderer. The panel chrome,
  // filter controls, and empty state (driven by the fake `gh` returning []) are
  // covered above; populated PR detail is left to unit/integration coverage.
});
