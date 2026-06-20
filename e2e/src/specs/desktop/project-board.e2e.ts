/**
 * Flow 2: Project board (KanbanBoard)
 *
 * Seeds 3 issues with distinct titles, labels, and states, then navigates to
 * the project Issues board. Verifies:
 *  - All 3 seeded issue titles appear on the kanban board
 *  - Filtering via the React Query cache narrows visible cards
 *  - Clicking an issue card opens the IssueDetail view with the correct title
 */
import { expect, test } from '../../fixtures/electron-app';

const ISSUE_ALPHA = {
  issueNumber: 101,
  title: 'Alpha feature: dark mode toggle',
  labels: ['feature'],
  state: 'open' as const,
};

const ISSUE_BETA = {
  issueNumber: 102,
  title: 'Beta bug: login crash on refresh',
  labels: ['bug'],
  state: 'open' as const,
};

const ISSUE_GAMMA = {
  issueNumber: 103,
  title: 'Gamma task: update dependencies',
  labels: ['chore'],
  state: 'open' as const,
};

test.use({
  seedOptions: {
    onboarded: true,
    issues: [ISSUE_ALPHA, ISSUE_BETA, ISSUE_GAMMA],
  },
});

test.describe('project board', () => {
  test('renders all 3 seeded issue titles on the kanban board', async ({ harness }) => {
    const { page } = harness;

    // Navigate to the project
    await harness.callStore('selectProject', harness.seed.projectId);

    // Ensure the issues tab is shown (selectProject already sets viewMode=project and projectTab=issues)
    const state = await harness.getState();
    expect(state.viewMode).toBe('project');
    expect(state.projectTab).toBe('issues');

    // All 3 issue titles must be visible on the board.
    // The IssuesPanel queries github:list-issues from the DB (seeded data).
    await expect(page.getByText(ISSUE_ALPHA.title, { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(ISSUE_BETA.title, { exact: false })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(ISSUE_GAMMA.title, { exact: false })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('kanban columns render with correct data-testid attributes', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('selectProject', harness.seed.projectId);

    // The Todo column should be present (all seeded issues have todo status by default)
    await expect(page.getByTestId('kanban-column-todo')).toBeVisible({ timeout: 15_000 });
  });

  test('issue cards have data-testid=issue-card-{number}', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('selectProject', harness.seed.projectId);

    // Wait for the board to load
    await expect(page.getByTestId('kanban-column-todo')).toBeVisible({ timeout: 15_000 });

    // Issue cards for seeded issues are rendered
    await expect(page.getByTestId(`issue-card-${ISSUE_ALPHA.issueNumber}`)).toBeVisible();
    await expect(page.getByTestId(`issue-card-${ISSUE_BETA.issueNumber}`)).toBeVisible();
    await expect(page.getByTestId(`issue-card-${ISSUE_GAMMA.issueNumber}`)).toBeVisible();
  });

  test('filtering issues via query cache narrows visible cards', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('selectProject', harness.seed.projectId);
    // Wait for the full board to render
    await expect(page.getByTestId(`issue-card-${ISSUE_ALPHA.issueNumber}`)).toBeVisible({
      timeout: 15_000,
    });

    // Narrow the board to only ISSUE_ALPHA by patching the React Query cache.
    // IssuesPanel reads from useQuery(['github-issues', projectId]) — so we must
    // update the query cache (not the store's githubIssues field) to make the
    // board actually re-render with fewer cards.
    const projectId = harness.seed.projectId;
    await page.evaluate((pid) => {
      const qc = (
        window as unknown as {
          __QUERY_CLIENT__?: {
            getQueryData(key: unknown[]): unknown;
            setQueryData(key: unknown[], data: unknown): void;
          };
        }
      ).__QUERY_CLIENT__;
      if (!qc) throw new Error('__QUERY_CLIENT__ not exposed');
      const issues = qc.getQueryData(['github-issues', pid]) as
        | Array<{ issueNumber: number }>
        | undefined;
      if (!issues) throw new Error(`[e2e] github-issues cache not populated for ${pid}`);
      const alpha = issues.find((i) => i.issueNumber === 101);
      if (!alpha) throw new Error('[e2e] issue 101 (alpha) not found in github-issues cache');
      qc.setQueryData(['github-issues', pid], [alpha]);
    }, projectId);

    // Alpha is still visible
    await expect(page.getByTestId(`issue-card-${ISSUE_ALPHA.issueNumber}`)).toBeVisible({
      timeout: 5_000,
    });

    // Beta and Gamma are no longer in the filtered set
    await expect(page.getByTestId(`issue-card-${ISSUE_BETA.issueNumber}`)).not.toBeVisible();
    await expect(page.getByTestId(`issue-card-${ISSUE_GAMMA.issueNumber}`)).not.toBeVisible();
  });

  test('clicking an issue card opens the IssueDetail view with the correct title', async ({
    harness,
  }) => {
    const { page } = harness;

    await harness.callStore('selectProject', harness.seed.projectId);

    // Wait for the board to render
    await expect(page.getByTestId(`issue-card-${ISSUE_BETA.issueNumber}`)).toBeVisible({
      timeout: 15_000,
    });

    // Click the Beta issue card
    await page.getByTestId(`issue-card-${ISSUE_BETA.issueNumber}`).click();

    // The IssueDetail view should open — app renders IssueDetail when activeIssue is set
    // The title is rendered in an <h1> in IssueDetail
    await expect(page.getByRole('heading', { name: ISSUE_BETA.title })).toBeVisible({
      timeout: 10_000,
    });

    // The wizard and board columns are no longer the main view
    await expect(page.getByTestId('kanban-column-todo')).not.toBeVisible();
  });

  test('back navigation from IssueDetail returns to the board', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('selectProject', harness.seed.projectId);

    await expect(page.getByTestId(`issue-card-${ISSUE_GAMMA.issueNumber}`)).toBeVisible({
      timeout: 15_000,
    });

    // Open Gamma issue
    await page.getByTestId(`issue-card-${ISSUE_GAMMA.issueNumber}`).click();
    await expect(page.getByRole('heading', { name: ISSUE_GAMMA.title })).toBeVisible({
      timeout: 10_000,
    });

    // Click the "Back to board" button rendered by IssueDetail.
    // This calls selectIssue(null) which clears activeIssue and returns to the board.
    await page.getByRole('button', { name: 'Back to board' }).click();

    // Board returns: kanban-column-todo is visible again
    await expect(page.getByTestId('kanban-column-todo')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`issue-card-${ISSUE_GAMMA.issueNumber}`)).toBeVisible();
  });
});
