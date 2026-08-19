import type { Page } from '@playwright/test';
import { expect, type Harness, test } from '../../fixtures/electron-app';

const ISSUE_DETAIL = {
  issueNumber: 802,
  title: 'Issue detail behavior fixture',
  body: '# Issue detail behavior fixture\n\nUsed by issue-detail E2E behavior contracts.',
  labels: ['feature'],
  state: 'open' as const,
  linkedThread: true,
};

test.use({
  seedOptions: {
    onboarded: true,
    gitRepo: true,
    issues: [ISSUE_DETAIL],
  },
});

async function openIssueDetail(harness: Harness): Promise<void> {
  const { page } = harness;

  await harness.callStore('selectProject', harness.seed.projectId);
  await expect(page.getByTestId(`thread-row-${ISSUE_DETAIL.issueNumber}`)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId(`thread-row-${ISSUE_DETAIL.issueNumber}`).click();

  await expect(page.getByRole('heading', { name: ISSUE_DETAIL.title }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('tab', { name: /^Agent$/ })).toBeVisible({ timeout: 15_000 });

  expect((await harness.getState()).activeThreadId).toBe(
    harness.seed.issueThreads[ISSUE_DETAIL.issueNumber],
  );
}

async function openIssueTab(page: Page, name: RegExp): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(tab).toHaveAttribute('data-state', 'active');
}

test.describe('issue detail behavior contracts', () => {
  test('comments tab validates composer state without posting', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Comments$/);

    await expect(page.getByText('No comments yet.')).toBeVisible({ timeout: 15_000 });
    const composer = page.getByPlaceholder(/Write a comment/);
    const postButton = page.getByRole('button', { name: 'Post Comment' });

    await expect(postButton).toBeDisabled();
    await composer.fill('Comment draft should enable posting but stay local.');
    await expect(postButton).toBeEnabled();
  });

  test('findings tab updates an open finding to fixed', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Findings/);

    await expect(page.getByText('1 open / 1 total')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Missing issue-detail behavior assertion')).toBeVisible();
    await page.getByRole('button', { name: 'Fixed' }).click();

    await expect(page.getByText('0 open / 1 total')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Fixed')).toBeVisible();
  });

  test('diff tab opens and closes the full-screen diff viewer', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Diff/);

    await expect(page.getByText('Code Changes')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 file', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'src/issue-detail-behavior.ts' })).toBeVisible();

    await page.getByRole('button', { name: 'Full screen diff' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('Code Changes')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'src/issue-detail-behavior.ts' }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Close full screen diff' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  test('runs tab renders the seeded run timeline summary', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Runs$/);

    await expect(page.getByText('Github Start Issue · issue:802')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('succeeded')).toBeVisible();
    await expect(page.getByText('No phase rows.')).toBeVisible();
  });

  test('activity tab renders issue-scoped timeline rows', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Activity/);

    await expect(page.getByText('1 events')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Pipeline completed for issue-detail behavior fixture'),
    ).toBeVisible();
    await expect(page.getByText('Issue #802 behavior data seeded')).toBeVisible();
  });

  test('conversations tab filters recorded issue chat turns by phase', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Conversations$/);

    await expect(page.getByText('issue_chat (2)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Issue chat seeded answer for behavior coverage.')).toBeVisible();

    await page.getByRole('button', { name: 'issue_chat' }).click();
    await expect(
      page.getByText('Issue chat seeded answer for behavior coverage.'),
    ).not.toBeVisible();

    await page.getByRole('button', { name: 'issue_chat' }).click();
    await expect(page.getByText('Issue chat seeded answer for behavior coverage.')).toBeVisible();
  });

  test('chat tab renders persisted transcript and enables a draft turn', async ({ harness }) => {
    const { page } = harness;

    await openIssueDetail(harness);
    await openIssueTab(page, /^Agent$/);

    await expect(page.getByTestId('conversation-surface')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Issue chat seeded answer for behavior coverage.')).toBeVisible();

    const sendButton = page.getByTitle('Send');
    await expect(sendButton).toBeDisabled();

    await page.getByLabel('Issue chat provider').click();
    await page.getByRole('option', { name: 'Codex' }).click();
    await page
      .getByPlaceholder('Message Claude, Codex, or Grok…')
      .fill('Summarize regression risk.');

    await expect(sendButton).toBeEnabled();
  });
});
