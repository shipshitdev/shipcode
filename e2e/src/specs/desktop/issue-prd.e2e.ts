/**
 * Flow 3 — Issue / PRD Create-Edit
 *
 * Covers: CreateIssueModal open/close, empty-body validation, submit-enabled
 * transition, and the success path (modal closes on fire of github:create-issue).
 */
import { expect, test } from '../../fixtures/electron-app';

test.describe('CreateIssueModal — create flow', () => {
  test.use({
    seedOptions: {
      onboarded: true,
    },
  });

  test('modal opens via openCreateIssueModal store action', async ({ harness }) => {
    const { page, seed } = harness;

    // Navigate to the seeded project first so activeProjectId is set.
    await harness.callStore('selectProject', seed.projectId);
    await expect(page.locator('#root')).toBeVisible();

    // Open the modal via the store action.
    await harness.callStore('openCreateIssueModal');

    // The scroll-region div carries data-testid="create-issue-modal".
    await expect(page.getByTestId('create-issue-modal')).toBeVisible();
  });

  test('submit button is disabled when body is empty', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('openCreateIssueModal');

    await expect(page.getByTestId('create-issue-modal')).toBeVisible();

    // The submit button (Create) should be disabled when the textarea is empty.
    const submitBtn = page.getByTestId('create-issue-submit');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test('submit button enables after typing a body', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('openCreateIssueModal');

    await expect(page.getByTestId('create-issue-modal')).toBeVisible();

    // Type a body into the textarea (id="issue-body").
    const bodyTextarea = page.locator('#issue-body');
    await expect(bodyTextarea).toBeVisible();
    await bodyTextarea.fill('# Add dark mode\n\nDescribe the feature here.');

    // Submit button should now be enabled (body is non-empty and title can be derived).
    const submitBtn = page.getByTestId('create-issue-submit');
    await expect(submitBtn).toBeEnabled();
  });

  test('submit closes the modal (optimistic close before GitHub responds)', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('openCreateIssueModal');

    await expect(page.getByTestId('create-issue-modal')).toBeVisible();

    // Type a valid body so the title can be derived.
    const bodyTextarea = page.locator('#issue-body');
    await bodyTextarea.fill('# Add dark mode\n\nSupport system dark mode preference.');

    const submitBtn = page.getByTestId('create-issue-submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // The modal closes optimistically in the create path — it does not wait for
    // the GitHub API round-trip. Wait for the scroll region to disappear.
    await expect(page.getByTestId('create-issue-modal')).not.toBeVisible({ timeout: 5000 });

    // Verify the store flag is cleared.
    const state = await harness.getState();
    expect(state.createIssueModalOpen).toBe(false);
  });

  test('quick-mode toggle switches input type', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('openCreateIssueModal');

    await expect(page.getByTestId('create-issue-modal')).toBeVisible();

    // The quick-mode checkbox uses id="quick-mode-toggle" per spec.
    const quickModeCheckbox = page.locator('#quick-mode-toggle');
    await expect(quickModeCheckbox).toBeVisible();

    // Before toggling: standard textarea is visible.
    await expect(page.locator('#issue-body')).toBeVisible();

    // Toggle quick mode.
    await quickModeCheckbox.click();

    // After toggling: the body textarea should be hidden; a single-line input appears.
    await expect(page.locator('#issue-body')).not.toBeVisible();
    await expect(page.getByPlaceholder(/describe the fix in one line/i)).toBeVisible();
  });

  test('Cancel button closes the modal', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);
    await harness.callStore('openCreateIssueModal');

    await expect(page.getByTestId('create-issue-modal')).toBeVisible();

    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(page.getByTestId('create-issue-modal')).not.toBeVisible({ timeout: 3000 });
    const state = await harness.getState();
    expect(state.createIssueModalOpen).toBe(false);
  });
});
