import { expect, type Harness, test } from '../../fixtures/electron-app';

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
 *   - useTerminalDrawer resolves displayTarget from either an issue in
 *     githubIssues whose threadId matches terminalThreadId, or the thread
 *     returned by the `thread:get` query for that id. When displayTarget is
 *     null, showEmptyState=true and ThreadConsoleTranscript never mounts.
 *   - The target therefore comes entirely from *seeded database state* (see
 *     `linkedIdleThread` in fixtures/seed.ts), never from a renderer-state
 *     injection. store.githubIssues is a read-only projection of the
 *     ['github-issues', projectId] query cache — anything written into it
 *     directly is erased the moment that query refetches, which is exactly how
 *     this suite went red on the scheduled macOS runs.
 *   - tool_start / lifecycle(info) / raw(info) events are grouped into
 *     WorkLogCard by groupTranscriptEvents. TerminalTranscript.tsx wraps each
 *     WorkLogCard item in data-testid="terminal-event-{kind}" so assertions work.
 */

const ISSUE_NUMBER = 42;

/**
 * Open the terminal drawer on the seeded thread and return its id.
 *
 * Both resolution paths are backed by real rows the seed created, so each one
 * survives every refetch of the issue list and of `thread:get`:
 *   - `github_issue_cache.thread_id` → issueTargets → explicitTarget
 *   - `threads.id`                   → thread:get   → explicitThreadTarget
 *
 * Whichever query lands first resolves displayTarget to the same thread, and
 * neither can be clobbered by the other. No waiting on an unrelated element as
 * a proxy for readiness, and no timeout inflation.
 */
async function openDrawer(harness: Harness): Promise<string> {
  const threadId = harness.seed.issueThreads[ISSUE_NUMBER];
  if (!threadId) {
    throw new Error(
      `[e2e] seed did not link a thread to issue #${ISSUE_NUMBER} — check linkedIdleThread in seedOptions`,
    );
  }

  await harness.callStore('selectProject', harness.seed.projectId);
  await harness.setState({
    terminalVisible: true,
    terminalThreadId: threadId,
    activeIssue: null,
  });

  await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible({ timeout: 15_000 });
  // Assert the drawer left its empty-state branch before asserting the
  // transcript. The empty state carries its own test id, so an unresolved
  // target fails as "expected 0 empty-state elements, got 1" instead of a bare
  // "terminal-transcript element(s) not found" that cannot be told apart from
  // a transcript that simply has not painted yet.
  await expect(harness.page.getByTestId('terminal-drawer-empty-state')).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible({ timeout: 15_000 });

  return threadId;
}

test.describe('terminal drawer — transcript rendering', () => {
  test.use({
    seedOptions: {
      onboarded: true,
      issues: [
        {
          issueNumber: ISSUE_NUMBER,
          title: 'E2E terminal test issue',
          // Real thread row + real issue→thread link, with an empty console.
          linkedIdleThread: true,
        },
      ],
    },
  });

  test('drawer opens and empty state shows before any events', async ({ harness }) => {
    await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();
    // Transcript should be present (may show empty message or pending label)
    await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible();
  });

  test('renders a text event row after terminal:event push', async ({ harness }) => {
    const threadId = await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    await harness.fire('terminal:event', {
      id: `${threadId}:1:text`,
      threadId,
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
    const threadId = await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    // tool_start is grouped into WorkLogCard by groupTranscriptEvents.
    // TerminalTranscript.tsx wraps each WorkLogCard row in
    // data-testid="terminal-event-{kind}" — so the assertion works.
    await harness.fire('terminal:event', {
      id: `${threadId}:2:tool_start`,
      threadId,
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
    const threadId = await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    // lifecycle events with info severity go to WorkLogCard; those with error/
    // warning severity render as standalone rows. Either way, TerminalTranscript
    // now wraps the element in data-testid="terminal-event-lifecycle".
    // Use an error-severity message so the row renders as a visible error card.
    await harness.fire('terminal:event', {
      id: `${threadId}:3:lifecycle`,
      threadId,
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
    const threadId = await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    await harness.fire('terminal:event', {
      id: `${threadId}:4:done`,
      threadId,
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
    const threadId = await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    const now = new Date().toISOString();

    await harness.fire('terminal:event', {
      id: `${threadId}:10:turn_start`,
      threadId,
      runId: null,
      event: { kind: 'turn_start', turn: 1 },
      createdAt: now,
    });

    await harness.fire('terminal:event', {
      id: `${threadId}:11:text`,
      threadId,
      runId: null,
      event: { kind: 'text', content: 'Analysing requirements' },
      createdAt: now,
    });

    await harness.fire('terminal:event', {
      id: `${threadId}:12:tool_start`,
      threadId,
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
    await openDrawer(harness);

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();
    await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible();

    // Before any events, no event rows are rendered. (The transcript shows a
    // pending/empty state whose exact copy depends on the resolved target, so we
    // assert the absence of event rows rather than a specific message string.)
    await expect(harness.page.getByTestId('terminal-event-text')).toHaveCount(0);
  });

  test('events for a different threadId do not appear in the transcript', async ({ harness }) => {
    await openDrawer(harness);

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

    // The transcript for the selected thread is still mounted and has no rows.
    await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible();
    await expect(harness.page.getByTestId('terminal-event-text')).toHaveCount(0);
  });
});
