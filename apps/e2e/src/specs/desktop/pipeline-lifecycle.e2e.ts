/**
 * Flow 4 — Pipeline lifecycle
 *
 * Seeds one issue, clicks its card to open IssueDetail, then drives phase
 * transitions via harness.fire() to verify the sidebar PipelineTab provider
 * selects are present and the header PhaseChip updates on each transition.
 *
 * Determinism: no real gh / no network. Phase transitions are driven entirely
 * by harness.fire() which replicates what the main process sends over IPC.
 *
 * Navigation pattern (mirrors project-board.e2e.ts which passes):
 *   selectProject → wait for kanban board → click issue card → IssueDetail
 *   opens → inject activeThreadId via setState so pipeline:phase events match.
 */
import { expect, test } from '../../fixtures/electron-app';

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
    const { page } = harness;

    // 1. Select the project — sets viewMode:'project', projectTab:'issues'.
    await harness.callStore('selectProject', harness.seed.projectId);

    // 2. Wait for the kanban board to render the seeded issue card.
    await expect(page.getByTestId(`issue-card-${ISSUE_NUMBER}`)).toBeVisible({
      timeout: 15_000,
    });

    // 3. Click the issue card → IssueDetail opens (selectIssue in the store).
    await page.getByTestId(`issue-card-${ISSUE_NUMBER}`).click();

    // 4. IssueDetail mounts when activeIssue !== null. Wait for the heading.
    // Confirm IssueDetail mounted via the unambiguous "Back to board" control.
    // (A /add dark mode/i heading match would clash with the body-markdown h1.)
    await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible({
      timeout: 10_000,
    });

    // 5. Inject the test threadId so pipeline:phase events are routed correctly.
    //    The seeded DB record has no threadId; we set it in-memory only.
    await harness.setState({ activeThreadId: THREAD_ID });

    // 6. The PipelineTab sidebar is always rendered when IssueDetail is open —
    //    it lives in the right-hand sidebar, not inside any tab panel.
    //    Assert all four phase-provider SelectTrigger elements are in the DOM.
    await expect(page.getByTestId('phase-provider-select-planner')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId('phase-provider-select-reviewer')).toBeVisible();
    await expect(page.getByTestId('phase-provider-select-executor')).toBeVisible();
    await expect(page.getByTestId('phase-provider-select-verifier')).toBeVisible();
  });

  test('pipeline:phase events update the status indicator', async ({ harness }) => {
    const { page } = harness;

    // ── Setup: open IssueDetail via real card click ───────────────────────────
    await harness.callStore('selectProject', harness.seed.projectId);
    await expect(page.getByTestId(`issue-card-${ISSUE_NUMBER}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`issue-card-${ISSUE_NUMBER}`).click();
    // Confirm IssueDetail mounted via the unambiguous "Back to board" control.
    // (A /add dark mode/i heading match would clash with the body-markdown h1.)
    await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible({
      timeout: 10_000,
    });

    // Inject the threadId so the pipeline:phase IPC handler matches.
    // useIpc.ts: `if (data.threadId === store.activeThreadId)` → applyPipelinePhase.
    await harness.setState({ activeThreadId: THREAD_ID });

    // The initial status chip is visible (shows "todo" from the seeded record).
    await expect(page.getByTestId('issue-phase-chip')).toBeVisible({ timeout: 5_000 });

    // ── planning ──────────────────────────────────────────────────────────────
    // pipeline:phase fires → store.pipelinePhase = 'planning'
    // IssueDetail: headerStatus = threadPhase = 'planning' (activeThreadId is set)
    // PhaseChip renders "PLANNING" (uppercase via CSS).
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'planning' });
    await expect(page.getByTestId('issue-phase-chip')).toContainText(/planning/i, {
      timeout: 5_000,
    });

    // ── reviewing ─────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'reviewing' });
    await expect(page.getByTestId('issue-phase-chip')).toContainText(/reviewing/i, {
      timeout: 5_000,
    });

    // ── executing ─────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'executing' });
    await expect(page.getByTestId('issue-phase-chip')).toContainText(/executing/i, {
      timeout: 5_000,
    });

    // ── verifying ─────────────────────────────────────────────────────────────
    await harness.fire('pipeline:phase', { threadId: THREAD_ID, phase: 'verifying' });
    await expect(page.getByTestId('issue-phase-chip')).toContainText(/verifying/i, {
      timeout: 5_000,
    });

    // Verify the store reflects the final phase.
    const state = await harness.getState();
    expect(state.pipelinePhase).toBe('verifying');
  });
});
