/**
 * Flow 4 — Pipeline lifecycle
 *
 * Seeds one issue, opens its detail, navigates to the Pipeline tab sidebar, and
 * fires pipeline:phase push events for each phase transition. Asserts the
 * issue-detail header's PhaseChip reflects each new phase.
 *
 * Determinism: no real gh / no network. Phase transitions are driven entirely
 * by harness.fire() which replicates what the main process sends over IPC.
 */
import { expect, test } from '../../fixtures/electron-app';

// A minimal issue with a threadId so the store can associate phase events.
const THREAD_ID = 'e2e-thread-pipeline-lifecycle';
const ISSUE_NUMBER = 42;

test.describe('Pipeline lifecycle — phase transitions', () => {
  test.use({
    seedOptions: {
      onboarded: true,
      issues: [
        {
          issueNumber: ISSUE_NUMBER,
          title: 'Add dark mode support',
          body: '# Add dark mode\n\nImplement system-level dark mode.',
        },
      ],
    },
  });

  test('phase-provider selects are visible in the Pipeline sidebar', async ({ harness }) => {
    const { page, seed } = harness;

    // Select the project and navigate to the issue.
    await harness.callStore('selectProject', seed.projectId);

    // The seeded issue does not have a threadId pre-set; inject one via the store
    // so the pipeline:phase handler can match it.
    const issues = seed.issues;
    const issue = issues.find((i) => i.issueNumber === ISSUE_NUMBER);
    expect(issue).toBeDefined();

    // Open the issue via setState (build a minimal GitHubIssueCacheRecord shape).
    await harness.setState({
      activeProjectId: seed.projectId,
      viewMode: 'project',
      activeIssue: {
        id: `${seed.projectId}-issue-${ISSUE_NUMBER}`,
        projectId: seed.projectId,
        issueNumber: ISSUE_NUMBER,
        title: issue?.title ?? 'Add dark mode support',
        body: issue?.body ?? '',
        labels: [],
        assignee: null,
        state: 'open',
        pipelineStatus: 'todo',
        threadId: THREAD_ID,
        claimedAt: null,
        claimedBy: null,
        lastPhaseUpdate: null,
        lastStatusLabel: null,
        plannerModelOverride: null,
        reviewerModelOverride: null,
        executorModelOverride: null,
        verifierModelOverride: null,
        plannerModelIdOverride: null,
        reviewerModelIdOverride: null,
        executorModelIdOverride: null,
        verifierModelIdOverride: null,
        plannerReasoningEffortOverride: null,
        reviewerReasoningEffortOverride: null,
        executorReasoningEffortOverride: null,
        verifierReasoningEffortOverride: null,
        revisionCountOverride: null,
        requireApprovalOverride: null,
        linkedPrNumber: null,
        linkedPrUrl: null,
        linkedPrIsDraft: false,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
        unresolvedReviewCommentCount: 0,
        prLastSyncAt: null,
        fetchedAt: new Date().toISOString(),
        priorityRank: null,
        priorityRaw: null,
        priorityFetchedAt: null,
        issueType: null,
        isQuickMode: false,
        syncState: undefined,
        triageFailureReason: null,
      },
      activeThreadId: THREAD_ID,
    });

    // Wait for IssueDetail to render — it shows the issue title in the header.
    await expect(page.getByRole('heading', { name: /add dark mode/i })).toBeVisible();

    // The PipelineTab sidebar always renders the provider selects for each phase.
    await expect(page.getByTestId('phase-provider-select-planner')).toBeVisible();
    await expect(page.getByTestId('phase-provider-select-reviewer')).toBeVisible();
    await expect(page.getByTestId('phase-provider-select-executor')).toBeVisible();
    await expect(page.getByTestId('phase-provider-select-verifier')).toBeVisible();
  });

  test('pipeline:phase events update the status indicator', async ({ harness }) => {
    const { page, seed } = harness;

    await harness.callStore('selectProject', seed.projectId);

    const issue = seed.issues.find((i) => i.issueNumber === ISSUE_NUMBER);

    // Set up the issue in the store with the thread id.
    await harness.setState({
      activeProjectId: seed.projectId,
      viewMode: 'project',
      activeIssue: {
        id: `${seed.projectId}-issue-${ISSUE_NUMBER}`,
        projectId: seed.projectId,
        issueNumber: ISSUE_NUMBER,
        title: issue?.title ?? 'Add dark mode support',
        body: issue?.body ?? '',
        labels: [],
        assignee: null,
        state: 'open',
        pipelineStatus: 'todo',
        threadId: THREAD_ID,
        claimedAt: null,
        claimedBy: null,
        lastPhaseUpdate: null,
        lastStatusLabel: null,
        plannerModelOverride: null,
        reviewerModelOverride: null,
        executorModelOverride: null,
        verifierModelOverride: null,
        plannerModelIdOverride: null,
        reviewerModelIdOverride: null,
        executorModelIdOverride: null,
        verifierModelIdOverride: null,
        plannerReasoningEffortOverride: null,
        reviewerReasoningEffortOverride: null,
        executorReasoningEffortOverride: null,
        verifierReasoningEffortOverride: null,
        revisionCountOverride: null,
        requireApprovalOverride: null,
        linkedPrNumber: null,
        linkedPrUrl: null,
        linkedPrIsDraft: false,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
        unresolvedReviewCommentCount: 0,
        prLastSyncAt: null,
        fetchedAt: new Date().toISOString(),
        priorityRank: null,
        priorityRaw: null,
        priorityFetchedAt: null,
        issueType: null,
        isQuickMode: false,
        syncState: undefined,
        triageFailureReason: null,
      },
      activeThreadId: THREAD_ID,
      githubIssues: [],
    });

    await expect(page.getByRole('heading', { name: /add dark mode/i })).toBeVisible();

    // ── planning ──────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'planning' });

    // The PhaseChip should reflect "planning". The chip text is set by pipelineStatus or
    // pipelinePhase — after the IPC event, the store's pipelinePhase becomes 'planning'
    // and the activeIssue.pipelineStatus gets mapped too.
    // We match the chip generically: it renders "planning" or similar label.
    await expect(page.getByText(/planning/i).first()).toBeVisible({ timeout: 5000 });

    // ── reviewing ─────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'reviewing' });
    await expect(page.getByText(/reviewing/i).first()).toBeVisible({ timeout: 5000 });

    // ── executing ─────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'executing' });
    await expect(page.getByText(/executing/i).first()).toBeVisible({ timeout: 5000 });

    // ── verifying ─────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'verifying' });
    await expect(page.getByText(/verifying/i).first()).toBeVisible({ timeout: 5000 });

    // Verify the store reflects the final phase.
    const state = await harness.getState();
    expect(state.pipelinePhase).toBe('verifying');
  });
});
