import { expect, test } from '../../fixtures/electron-app';

/**
 * Flow 6 — Terminal drawer + transcript
 *
 * Drives the terminal drawer open via the Zustand store (terminalVisible +
 * terminalThreadId), fires several terminal:event IPC pushes with different
 * canonical event kinds, and asserts the TerminalTranscript renders each event
 * row visible in the DOM.
 *
 * No real pipeline runs; all output is injected through the same IPC channel
 * that useIpc.ts listens on in the live app.
 *
 * Setup contract:
 *   - TerminalDrawer only mounts when terminalVisible=true AND activeIssue=null
 *     AND projectTab!='terminal'. See App.tsx line ~387.
 *   - useTerminalDrawer resolves displayTarget by searching githubIssues for an
 *     issue whose threadId matches terminalThreadId. When displayTarget is null,
 *     showEmptyState=true and ThreadConsoleTranscript never mounts.
 *   - Fix: inject a synthetic GitHubIssueCacheRecord into githubIssues with the
 *     matching threadId so displayTarget resolves without setting activeIssue
 *     (which would prevent TerminalDrawer mounting).
 *   - tool_start / lifecycle(info) / raw(info) events are grouped into
 *     WorkLogCard by groupTranscriptEvents. TerminalTranscript.tsx wraps each
 *     WorkLogCard item in data-testid="terminal-event-{kind}" so assertions work.
 */

const THREAD_ID = 'e2e-terminal-thread-1';

/** Minimal GitHubIssueCacheRecord shape sufficient to satisfy issueTarget(). */
function fakeIssue(projectId: string) {
  return {
    id: 'e2e-fake-issue-id',
    projectId,
    issueNumber: 42,
    title: 'E2E terminal test issue',
    body: null,
    labels: [],
    assignee: null,
    author: 'e2e-bot',
    state: 'open',
    // pipelineStatus must NOT be in AGENT_ACTIVE_STATUSES or the drawer would
    // auto-open when selectIssue is called — but we never call selectIssue here,
    // so any value is fine. Use 'todo' (idle equivalent).
    pipelineStatus: 'todo',
    threadId: THREAD_ID,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
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
    executionRunId: null,
    executionLockedAt: null,
    executionLockOwner: null,
  };
}

/**
 * Open the terminal drawer with a resolved displayTarget.
 *
 * Steps:
 *  1. selectProject → sets viewMode='project', activeIssue=null, githubIssues=[]
 *  2. setState injects: githubIssues with the fake issue (so useTerminalDrawer
 *     can find it via issueTargets), terminalVisible=true, terminalThreadId=THREAD_ID
 *  3. activeIssue stays null → TerminalDrawer mounts
 */
async function openDrawer(harness: { callStore: Function; setState: Function }, projectId: string) {
  await harness.callStore('selectProject', projectId);
  await harness.setState({
    githubIssues: [fakeIssue(projectId)],
    terminalVisible: true,
    terminalThreadId: THREAD_ID,
    activeIssue: null,
  });
}

test.describe('terminal drawer — transcript rendering', () => {
  test.use({
    seedOptions: {
      onboarded: true,
      issues: [
        {
          issueNumber: 42,
          title: 'E2E terminal test issue',
        },
      ],
    },
  });

  test('drawer opens and empty state shows before any events', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();
    // Transcript should be present (may show empty message or pending label)
    await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible();
  });

  test('renders a text event row after terminal:event push', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:1:text`,
      threadId: THREAD_ID,
      runId: null,
      event: { kind: 'text', content: 'Hello from the assistant' },
      createdAt: new Date().toISOString(),
    });

    // The transcript batches at 50ms; wait for the row to appear.
    await expect(harness.page.getByTestId('terminal-event-text').first()).toBeVisible({
      timeout: 5_000,
    });

    // The actual content should be visible inside the row.
    await expect(harness.page.getByText('Hello from the assistant')).toBeVisible();
  });

  test('renders a tool_start event row', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    // tool_start is grouped into WorkLogCard by groupTranscriptEvents.
    // TerminalTranscript.tsx wraps each WorkLogCard row in
    // data-testid="terminal-event-{kind}" — so the assertion works.
    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:2:tool_start`,
      threadId: THREAD_ID,
      runId: null,
      event: {
        kind: 'tool_start',
        name: 'Bash',
        summary: 'run tests',
        command: 'bun run test',
      },
      createdAt: new Date().toISOString(),
    });

    await expect(harness.page.getByTestId('terminal-event-tool_start').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('renders a lifecycle event row', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    // lifecycle events with info severity go to WorkLogCard; those with error/
    // warning severity render as standalone rows. Either way, TerminalTranscript
    // now wraps the element in data-testid="terminal-event-lifecycle".
    // Use an error-severity message so the row renders as a visible error card.
    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:3:lifecycle`,
      threadId: THREAD_ID,
      runId: null,
      event: { kind: 'lifecycle', message: 'Pipeline error occurred' },
      createdAt: new Date().toISOString(),
    });

    await expect(harness.page.getByTestId('terminal-event-lifecycle').first()).toBeVisible({
      timeout: 5_000,
    });

    await expect(harness.page.getByText('Pipeline error occurred')).toBeVisible();
  });

  test('renders a done event row', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:4:done`,
      threadId: THREAD_ID,
      runId: null,
      event: { kind: 'done', totalCostUsd: 0.0012 },
      createdAt: new Date().toISOString(),
    });

    await expect(harness.page.getByTestId('terminal-event-done').first()).toBeVisible({
      timeout: 5_000,
    });

    // The "Done" label is rendered in the done row.
    await expect(harness.page.getByText(/done/i).first()).toBeVisible();
  });

  test('multiple events accumulate in the transcript', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    const now = new Date().toISOString();

    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:10:turn_start`,
      threadId: THREAD_ID,
      runId: null,
      event: { kind: 'turn_start', turn: 1 },
      createdAt: now,
    });

    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:11:text`,
      threadId: THREAD_ID,
      runId: null,
      event: { kind: 'text', content: 'Analysing requirements' },
      createdAt: now,
    });

    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:12:tool_start`,
      threadId: THREAD_ID,
      runId: null,
      event: {
        kind: 'tool_start',
        name: 'Read',
        summary: 'src/index.ts',
        filePath: 'src/index.ts',
      },
      createdAt: now,
    });

    // Wait for at least the text row.
    await expect(harness.page.getByTestId('terminal-event-text').first()).toBeVisible({
      timeout: 5_000,
    });

    // All three event kinds should have produced rows.
    await expect(harness.page.getByTestId('terminal-event-turn_start').first()).toBeVisible();
    await expect(harness.page.getByTestId('terminal-event-tool_start').first()).toBeVisible();
    await expect(harness.page.getByText('Analysing requirements')).toBeVisible();
  });

  test('transcript shows empty state message before events arrive', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();
    await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible();

    // Before any events, the transcript renders the empty message.
    await expect(harness.page.getByText('No console output yet.')).toBeVisible();
  });

  test('events for a different threadId do not appear in the transcript', async ({ harness }) => {
    await openDrawer(harness, harness.seed.projectId);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    // Fire an event for a different thread — should NOT appear.
    await harness.fire('terminal:event', {
      id: 'other-thread:99:text',
      threadId: 'other-thread-id',
      runId: null,
      event: { kind: 'text', content: 'Should not appear' },
      createdAt: new Date().toISOString(),
    });

    // Give the 50ms batch window time to flush.
    await harness.page.waitForTimeout(200);

    // The text from the other thread must NOT be in the transcript.
    await expect(harness.page.getByText('Should not appear')).not.toBeVisible();

    // Empty state should still show.
    await expect(harness.page.getByText('No console output yet.')).toBeVisible();
  });
});
