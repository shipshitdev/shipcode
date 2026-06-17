import type { Page } from '@playwright/test';
import { expect, type Harness, test } from '../../fixtures/electron-app';

type SettingsSnapshot = {
  githubPollingEnabled: boolean;
  githubPollingIntervalMs: number;
  autoRunMaxTasks: number;
  autoRunPriorities: string[];
  notificationsEnabled: boolean;
  notificationOsEnabled: boolean;
  notificationEvents: {
    approval: boolean;
    failed: boolean;
    ciBlocked: boolean;
    completed: boolean;
    verificationExhausted: boolean;
  };
  chatNotificationEvents: {
    approval: boolean;
    failed: boolean;
    ciBlocked: boolean;
    completed: boolean;
    verificationExhausted: boolean;
  };
  discordEnabled: boolean;
  discordWebhookUrl: string | null;
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramDefaultChatId: string | null;
  autoCommitEnabled: boolean;
  autoCommitProvider: string;
  autoCommitModel: string;
  autoCommitMode: string;
  cleanupCriteria: {
    worktreeMergedPr: boolean;
    worktreeClosedPr: boolean;
    localBranchMerged: boolean;
    localBranchNoRemote: boolean;
    remoteBranchMerged: boolean;
    worktreeNoPrCleanTree: boolean;
  };
  devLogLevel: string;
  updateTrack: string;
};

const ARCHIVED_SETTINGS_ISSUE = {
  issueNumber: 903,
  title: 'Archived settings restore fixture',
  body: 'Fixture issue archived before Settings behavior tests start.',
  labels: ['chore'],
  state: 'closed' as const,
};

test.use({
  seedOptions: {
    onboarded: true,
    archivedProject: true,
    archivedIssues: [ARCHIVED_SETTINGS_ISSUE],
  },
});

async function invokeInRenderer<T>(page: Page, channel: string, args?: unknown): Promise<T> {
  return page.evaluate(
    ({ channel, args }) =>
      (
        window as unknown as {
          shipcode: { invoke(channel: string, args?: unknown): Promise<unknown> };
        }
      ).shipcode.invoke(channel, args),
    { channel, args },
  ) as Promise<T>;
}

async function settings(page: Page): Promise<SettingsSnapshot> {
  return invokeInRenderer<SettingsSnapshot>(page, 'settings:get');
}

async function openSettingsSection(
  harness: Harness,
  section:
    | 'integrations'
    | 'github'
    | 'notifications'
    | 'auto-commit'
    | 'shortcuts'
    | 'archived'
    | 'developer'
    | 'about',
  heading: RegExp,
): Promise<void> {
  await harness.setState({ settingsVisible: true });
  await harness.callStore('setSettingsSection', section);
  await expect(harness.page.getByRole('heading', { name: heading })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('settings behavior contracts', () => {
  test('GitHub settings persist polling and auto-run priority controls', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'github', /^GitHub$/);

    const before = await settings(page);
    await page.locator('#polling-enabled').click();
    await expect
      .poll(async () => (await settings(page)).githubPollingEnabled, { timeout: 15_000 })
      .toBe(!before.githubPollingEnabled);

    await page.locator('#poll-interval').fill('45000');
    await expect
      .poll(async () => (await settings(page)).githubPollingIntervalMs, { timeout: 15_000 })
      .toBe(45_000);

    await page.locator('#auto-run-max').fill('3');
    await page.locator('#auto-run-p1').click();

    await expect
      .poll(async () => {
        const next = await settings(page);
        return {
          max: next.autoRunMaxTasks,
          priorities: next.autoRunPriorities,
        };
      })
      .toEqual({ max: 3, priorities: ['p1'] });
    await expect(page.getByText('Only P1 issues will be included.')).toBeVisible();
  });

  test('notification settings disable dependent desktop alert toggles', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'notifications', /^Notifications$/);

    await page.locator('#notifications-enabled').click();
    await expect
      .poll(async () => (await settings(page)).notificationsEnabled, { timeout: 15_000 })
      .toBe(false);

    await expect(page.locator('#notification-os')).toBeDisabled();
    await expect(page.locator('#notification-badge')).toBeDisabled();
    await expect(page.locator('#notification-sound')).toBeDisabled();

    await page.locator('#chat-failed').click();
    await expect
      .poll(async () => (await settings(page)).chatNotificationEvents.failed, {
        timeout: 15_000,
      })
      .toBe(false);
  });

  test('integrations settings persist chat provider configuration fields', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'integrations', /^Integrations$/);
    await page.getByRole('tab', { name: 'API Keys' }).click();

    await page.locator('#settings-discord-enabled').click();
    await page
      .getByPlaceholder('https://discord.com/api/webhooks/...')
      .fill('https://discord.com/api/webhooks/e2e/token');

    await page.locator('#settings-telegram-enabled').click();
    await page.getByPlaceholder('Bot token').fill('123456:e2e-token');
    await page.getByPlaceholder('Default chat ID').fill('-1001234567890');

    await expect
      .poll(
        async () => {
          const next = await settings(page);
          return {
            discordEnabled: next.discordEnabled,
            discordWebhookUrl: next.discordWebhookUrl,
            telegramEnabled: next.telegramEnabled,
            telegramBotToken: next.telegramBotToken,
            telegramDefaultChatId: next.telegramDefaultChatId,
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({
        discordEnabled: true,
        discordWebhookUrl: 'https://discord.com/api/webhooks/e2e/token',
        telegramEnabled: true,
        telegramBotToken: '123456:e2e-token',
        telegramDefaultChatId: '-1001234567890',
      });
  });

  test('auto-commit settings persist provider, mode, and cleanup criteria', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'auto-commit', /^Auto-commit & Cleanup$/);

    await page.locator('#auto-commit-enabled').click();
    await expect
      .poll(async () => (await settings(page)).autoCommitEnabled, { timeout: 15_000 })
      .toBe(false);

    await page.locator('#auto-commit-provider').click();
    await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
    await expect
      .poll(
        async () => {
          const next = await settings(page);
          return {
            provider: next.autoCommitProvider,
            model: next.autoCommitModel,
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({ provider: 'codex', model: 'gpt-5.5' });

    await page.locator('#auto-commit-mode').click();
    await page.getByRole('option', { name: 'Single commit', exact: true }).click();
    await page.locator('#cleanup-no-pr').click();

    await expect
      .poll(
        async () => {
          const next = await settings(page);
          return {
            mode: next.autoCommitMode,
            noPr: next.cleanupCriteria.worktreeNoPrCleanTree,
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({ mode: 'single', noPr: true });
  });

  test('shortcuts settings render the canonical shortcut reference by category', async ({
    harness,
  }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'shortcuts', /^Keyboard Shortcuts$/);

    await expect(page.getByText('Navigation', { exact: true })).toBeVisible();
    await expect(page.getByText('Workspace', { exact: true })).toBeVisible();
    await expect(page.getByText('Board', { exact: true })).toBeVisible();
    await expect(page.getByText('Command Palette', { exact: true })).toBeVisible();
    await expect(page.getByText('⌘K', { exact: true })).toBeVisible();
    await expect(page.getByText('Open Focused Card', { exact: true })).toBeVisible();
    await expect(page.getByText('Enter', { exact: true })).toBeVisible();
  });

  test('archived settings restore archived projects and issues', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'archived', /^Archived$/);
    if (!harness.seed.archivedProject) throw new Error('Missing archived project fixture');

    await expect(page.getByText(harness.seed.archivedProject.name, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('No archived projects.')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Issues' }).click();
    await expect(
      page.getByText(`#${ARCHIVED_SETTINGS_ISSUE.issueNumber} ${ARCHIVED_SETTINGS_ISSUE.title}`),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('No archived issues.')).toBeVisible({ timeout: 15_000 });
  });

  test('developer settings persist file log level changes', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'developer', /^Developer$/);
    await expect(page.getByText('ShipCode version')).toBeVisible({ timeout: 15_000 });

    await page.locator('#dev-log-level').click();
    await page.getByRole('option', { name: 'Warn', exact: true }).click();

    await expect
      .poll(async () => (await settings(page)).devLogLevel, { timeout: 15_000 })
      .toBe('warn');
  });

  test('about settings expose only the published update track', async ({ harness }) => {
    const { page } = harness;

    await openSettingsSection(harness, 'about', /^About$/);
    await expect(page.getByText('Version', { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.locator('#update-track').click();
    await expect(page.getByRole('option', { name: 'Master', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('option', { name: 'Stable (reserved)', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');
    await expect(
      page.getByRole('option', { name: 'Nightly (reserved)', exact: true }),
    ).toHaveAttribute('aria-disabled', 'true');

    expect((await settings(page)).updateTrack).toBe('master');
  });
});
