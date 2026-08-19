import { expect, test } from '../../fixtures/electron-app';
import { selectSeedProject } from '../../fixtures/flows';

const BEHAVIOR_ISSUE = {
  issueNumber: 701,
  title: 'Behavior coverage fixture',
  body: '# Behavior coverage fixture\n\nUsed by page-level E2E behavior contracts.',
  labels: ['feature'],
  state: 'open' as const,
};

test.use({
  seedOptions: {
    onboarded: true,
    gitRepo: true,
    issues: [BEHAVIOR_ISSUE],
  },
});

test.describe('page behavior contracts', () => {
  test('overview stat cards navigate to inbox and activity', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('openView', 'overview');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByText('Tasks In Progress', { exact: true }).click();
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });
    expect((await harness.getState()).viewMode).toBe('inbox');

    await harness.callStore('openView', 'overview');
    await page.getByText('Shipped (7d)', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect((await harness.getState()).viewMode).toBe('activity');
  });

  test('costs view toggles between tokens and USD display modes', async ({ harness }) => {
    const { page } = harness;

    await harness.setState({ settingsVisible: true, settingsSection: 'costs' });
    await expect(page.getByRole('heading', { name: 'Costs', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const usdButton = page.getByRole('button', { name: 'Show costs in US dollars' });
    const tokensButton = page.getByRole('button', { name: 'Show costs in tokens' });

    await usdButton.click();
    await expect(usdButton).toHaveClass(/bg-tertiary/);

    await tokensButton.click();
    await expect(tokensButton).toHaveClass(/bg-tertiary/);
  });

  test('skills view switches phase and exposes unsaved draft state', async ({ harness }) => {
    const { page } = harness;

    await harness.setState({ settingsVisible: true, settingsSection: 'skills' });
    await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /Reviewer/ }).click();
    await expect(page.getByRole('heading', { name: /Reviewer skill/i })).toBeVisible({
      timeout: 15_000,
    });

    const editor = page.getByLabel('Skill content');
    const existing = await editor.inputValue();
    await editor.fill(`${existing}\n\n<!-- e2e draft marker -->`);

    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('automations create modal validates required fields before enabling create', async ({
    harness,
  }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await harness.callStore('openView', 'automations');
    await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByRole('button', { name: /new automation/i })
      .first()
      .click();
    await expect(page.locator('#auto-name')).toBeVisible({ timeout: 15_000 });

    const createButton = page.getByRole('button', { name: /^Create/ });
    await expect(createButton).toBeDisabled();

    await page.locator('#auto-name').fill('Daily behavior smoke');
    await page
      .locator('#auto-prompt')
      .fill('Run the behavior E2E smoke suite and report failures.');
    await expect(createButton).toBeEnabled({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#auto-name')).not.toBeVisible({ timeout: 5_000 });
  });

  test('git tab renders seeded worktree state and cleanup controls', async ({ harness }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await harness.callStore('setProjectTab', 'git');
    await expect(page.getByText('Git Visualizer', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText(/1 worktree · \d+ branch(?:es)?/)).toBeVisible();
    await expect(page.getByText('Main working tree', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('clean', { exact: true }).first()).toBeVisible();

    const autoCommitButton = page.getByRole('button', { name: 'Auto-commit' });
    await expect(autoCommitButton).toBeDisabled();
    await expect(autoCommitButton).toHaveAttribute('title', 'Worktree clean');

    await page.getByLabel('Refresh git visualizer').click();
    await expect(page.getByText('Git Visualizer', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Cleanup' }).click();
    const cleanupDialog = page.getByRole('dialog', { name: 'Cleanup branches & worktrees' });
    await expect(cleanupDialog).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nothing to clean up.')).toBeVisible({ timeout: 15_000 });
    await cleanupDialog.getByText('Close', { exact: true }).click();
    await expect(cleanupDialog).not.toBeVisible({ timeout: 5_000 });
  });

  test('code browser selects README and switches source to diff mode', async ({ harness }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await harness.callStore('setProjectTab', 'code');
    await expect(page.getByText('Worktree', { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByText('README.md', { exact: true }).click();
    await expect(page.getByText('ShipCode E2E Fixture')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Diff' }).click();
    await expect(page.getByText('No uncommitted changes for this file.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('terminal tab renders and closes a replay pane', async ({ harness }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await harness.callStore('setProjectTab', 'terminal');
    await expect(page.getByText('No terminal sessions open')).toBeVisible({ timeout: 15_000 });

    await harness.callStore('addTerminalPane', 'e2e-terminal-pane', {
      mode: 'replay',
      title: 'E2E replay pane',
      cli: 'shell',
      state: 'exited',
    });

    await expect(page.getByText('E2E replay pane')).toBeVisible({ timeout: 15_000 });
    await page.getByTitle('Close pane').click();
    await expect(page.getByText('No terminal sessions open')).toBeVisible({ timeout: 15_000 });
  });

  test('project insights updates heatmap range and metric controls', async ({ harness }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await harness.callStore('setProjectTab', 'insights');
    await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('tab', { name: '30 days' }).click();
    await expect(page.getByText(/Last 30 days/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Runs' }).click();
    await expect(
      page.locator('section[aria-label*="Activity heatmap, Runs, last 30 days"]'),
    ).toBeVisible({ timeout: 15_000 });
  });
});
