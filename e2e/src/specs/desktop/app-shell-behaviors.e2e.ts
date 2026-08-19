import { expect, type Harness, test } from '../../fixtures/electron-app';
import { selectSeedProject } from '../../fixtures/flows';

type SettingsSnapshot = {
  theme: string;
  fontSize: number;
  worktreeRoot: string | null;
  requireApproval: boolean;
  maxConcurrentPipelines: number;
};

const SHELL_ISSUE = {
  issueNumber: 801,
  title: 'Global shell behavior fixture',
  body: '# Global shell behavior fixture\n\nUsed by command palette E2E behavior contracts.',
  labels: ['feature'],
  state: 'open' as const,
};

test.use({
  seedOptions: {
    onboarded: true,
    gitRepo: true,
    issues: [SHELL_ISSUE],
  },
});

async function openSettingsSection(
  harness: Harness,
  section: 'general' | 'pipeline',
): Promise<void> {
  await harness.setState({ settingsVisible: true });
  await harness.callStore('setSettingsSection', section);
}

test.describe('app shell behavior contracts', () => {
  test('general settings persist theme and font-size choices', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'general');
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.locator('#theme').click();
    await page.getByRole('option', { name: 'Dark' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme), {
        timeout: 15_000,
      })
      .toBe('dark');

    await page.locator('#font-size').click();
    await page.getByRole('option', { name: 'Large', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.fontSize), {
        timeout: 15_000,
      })
      .toBe('14');

    const settings = await harness.invoke<SettingsSnapshot>('settings:get');
    expect(settings.theme).toBe('dark');
    expect(settings.fontSize).toBe(14);
  });

  test('general settings reject a relative worktree root before persistence', async ({
    harness,
  }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'general');
    await expect(page.locator('#worktree-root')).toBeVisible({ timeout: 15_000 });

    await page.locator('#worktree-root').fill('relative/path');
    await page.keyboard.press('Tab');

    await expect(page.getByText(/worktreeRoot must be absolute or ~-prefixed/)).toBeVisible({
      timeout: 15_000,
    });

    const settings = await harness.invoke<SettingsSnapshot>('settings:get');
    expect(settings.worktreeRoot).toBeNull();
  });

  test('pipeline settings persist approval and concurrency controls', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'pipeline');
    await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const before = await harness.invoke<SettingsSnapshot>('settings:get');
    await page.locator('#require-approval').click();

    await expect
      .poll(async () => (await harness.invoke<SettingsSnapshot>('settings:get')).requireApproval, {
        timeout: 15_000,
      })
      .toBe(!before.requireApproval);

    await page.locator('#max-concurrent-pipelines').fill('4');
    await expect
      .poll(
        async () => (await harness.invoke<SettingsSnapshot>('settings:get')).maxConcurrentPipelines,
        { timeout: 15_000 },
      )
      .toBe(4);
  });

  test('command palette navigates to a top-level view', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('openView', 'overview');
    await harness.callStore('openCommandPalette');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByPlaceholder('Search issues, commands...')).toBeVisible({
      timeout: 15_000,
    });

    await dialog.getByPlaceholder('Search issues, commands...').fill('Costs');
    await dialog.getByText('Costs', { exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Costs', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect((await harness.getState()).settingsVisible).toBe(true);
    expect((await harness.getState()).settingsSection).toBe('costs');
    await expect(dialog).not.toBeVisible();
  });

  test('command palette searches cached issues and opens detail', async ({ harness }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await expect(page.getByTestId(`thread-row-${SHELL_ISSUE.issueNumber}`)).toBeVisible({
      timeout: 15_000,
    });
    await harness.callStore('openCommandPalette');

    const dialog = page.getByRole('dialog');
    const input = dialog.getByPlaceholder('Search issues, commands...');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill(SHELL_ISSUE.title);

    const issueOption = dialog.getByRole('option', { name: new RegExp(SHELL_ISSUE.title) });
    await expect(issueOption).toBeVisible({
      timeout: 15_000,
    });
    await issueOption.click();

    await expect(page.getByRole('heading', { name: SHELL_ISSUE.title }).first()).toBeVisible({
      timeout: 15_000,
    });
    expect((await harness.getState()).activeIssue).toMatchObject({
      issueNumber: SHELL_ISSUE.issueNumber,
    });
  });

  test('assistant panel fills suggested prompts and persists CLI choice', async ({ harness }) => {
    const { page } = harness;

    await selectSeedProject(harness);
    await harness.callStore('openAssistant');

    await expect(page.getByText('ShipCode Assistant', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const prompt = 'Review this project setup and tell me what is missing.';
    const draft = page.getByPlaceholder('Ask about setup, issues, or the board...');
    await page.getByRole('button', { name: prompt }).click();
    await expect(draft).toHaveValue(prompt);
    await expect(page.getByTitle('Send')).toBeEnabled();

    await page.getByLabel('Assistant CLI').click();
    await page.getByRole('option', { name: 'Codex' }).click();

    expect((await harness.getState()).assistantCli).toBe('codex');
  });

  test('automation modal validates custom cron and creates a persisted card', async ({
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
    await page.locator('#auto-name').fill('Custom cron coverage');
    await page
      .locator('#auto-prompt')
      .fill('Run the app shell coverage suite and summarize regressions.');
    await expect(createButton).toBeEnabled({ timeout: 15_000 });

    await page.locator('#auto-preset').click();
    await page.getByRole('option', { name: /Custom/ }).click();

    await page.getByPlaceholder('*/15 * * * *').fill('not a cron');
    await expect(createButton).toBeDisabled();
    await expect(page.locator('div.text-danger', { hasText: /invalid/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByPlaceholder('*/15 * * * *').fill('*/15 * * * *');
    await expect(createButton).toBeEnabled({ timeout: 15_000 });
    await createButton.click();

    await expect(page.locator('#auto-name')).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Custom cron coverage', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/shipcode-e2e.*\*\/15 \* \* \* \*/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
