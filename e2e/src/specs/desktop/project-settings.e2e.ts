import { expect, test } from '../../fixtures/electron-app';

/**
 * Flow 7 — Project Settings Modal
 *
 * Opens the ProjectSettingsModal via the store action, navigates to the
 * Pipeline tab, changes the Speed Profile select, saves, and asserts the
 * modal closes (which is the app's success signal) and the store reflects
 * the modal being closed.
 *
 * A second describe block covers tab navigation — confirms each nav button
 * switches the active heading.
 */

test.describe('project settings modal — open and close', () => {
  test('opens the modal for the seeded project', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);

    await harness.callStore('openProjectSettingsModal', harness.seed.projectId);

    // The modal content area mounts once project + settings queries resolve.
    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Cancel button closes the modal', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.callStore('openProjectSettingsModal', harness.seed.projectId);

    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });

    await harness.page.getByRole('button', { name: /cancel/i }).click();

    // After cancel the modal should no longer be visible.
    await expect(harness.page.getByTestId('project-settings-modal')).not.toBeVisible();

    const state = await harness.getState();
    expect(state.projectSettingsModalOpen).toBe(false);
  });
});

test.describe('project settings modal — tab navigation', () => {
  test('navigates to the Pipeline tab', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.callStore('openProjectSettingsModal', harness.seed.projectId);

    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });

    // Click the Pipeline nav item (rendered as a Button with label text).
    await harness.page.getByRole('button', { name: /^Pipeline$/i }).click();

    // The heading inside the content panel should update to "Pipeline".
    await expect(harness.page.getByRole('heading', { name: /^Pipeline$/i })).toBeVisible();

    // The speed profile select should be present on the Pipeline tab.
    await expect(harness.page.getByTestId('pipeline-speed-profile-select')).toBeVisible();
  });

  test('navigates to the Setup tab', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.callStore('openProjectSettingsModal', harness.seed.projectId);

    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });

    await harness.page.getByRole('button', { name: /^Setup$/i }).click();

    await expect(harness.page.getByRole('heading', { name: /^Setup$/i })).toBeVisible();
  });
});

test.describe('project settings modal — initialTab shortcut', () => {
  test('opens directly on the Pipeline tab via initialTab', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.callStore('openProjectSettingsModal', harness.seed.projectId, 'pipeline');

    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });

    // Should land directly on Pipeline — heading visible without clicking nav.
    await expect(harness.page.getByRole('heading', { name: /^Pipeline$/i })).toBeVisible();

    await expect(harness.page.getByTestId('pipeline-speed-profile-select')).toBeVisible();
  });
});

test.describe('project settings modal — pipeline tab save', () => {
  test('changing speed profile and saving closes the modal', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.callStore('openProjectSettingsModal', harness.seed.projectId, 'pipeline');

    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });

    // The pipeline tab should be active; speed profile select should be visible.
    const speedSelect = harness.page.getByTestId('pipeline-speed-profile-select');
    await expect(speedSelect).toBeVisible();

    // Open the select and pick "Thorough".
    await speedSelect.click();
    await harness.page.getByRole('option', { name: /thorough/i }).click();

    // Click the Save button.
    const saveBtn = harness.page.getByTestId('project-settings-save-btn');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // On success the modal closes: the content area disappears and store is cleared.
    await expect(harness.page.getByTestId('project-settings-modal')).not.toBeVisible({
      timeout: 10_000,
    });

    const state = await harness.getState();
    expect(state.projectSettingsModalOpen).toBe(false);
  });

  test('save button is visible and labelled correctly on the General tab', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.callStore('openProjectSettingsModal', harness.seed.projectId);

    await expect(harness.page.getByTestId('project-settings-modal')).toBeVisible({
      timeout: 10_000,
    });

    const saveBtn = harness.page.getByTestId('project-settings-save-btn');
    await expect(saveBtn).toBeVisible();
    // The button contains the word "Save".
    await expect(saveBtn).toContainText(/save/i);
  });
});
