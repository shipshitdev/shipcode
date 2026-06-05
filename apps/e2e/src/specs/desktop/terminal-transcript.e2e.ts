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
 */

const THREAD_ID = 'e2e-terminal-thread-1';

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
    // Navigate to project view so TerminalDrawer can mount.
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.setState({
      terminalVisible: true,
      terminalThreadId: THREAD_ID,
    });

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();
    // Transcript should be present (may show empty message or pending label)
    await expect(harness.page.getByTestId('terminal-transcript')).toBeVisible();
  });

  test('renders a text event row after terminal:event push', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.setState({
      terminalVisible: true,
      terminalThreadId: THREAD_ID,
    });

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
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.setState({
      terminalVisible: true,
      terminalThreadId: THREAD_ID,
    });

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

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

    // Badge text for the tool name should appear.
    await expect(harness.page.getByText('Bash').first()).toBeVisible();
  });

  test('renders a lifecycle event row', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.setState({
      terminalVisible: true,
      terminalThreadId: THREAD_ID,
    });

    await expect(harness.page.getByTestId('terminal-drawer')).toBeVisible();

    await harness.fire('terminal:event', {
      id: `${THREAD_ID}:3:lifecycle`,
      threadId: THREAD_ID,
      runId: null,
      event: { kind: 'lifecycle', message: 'Pipeline started' },
      createdAt: new Date().toISOString(),
    });

    await expect(harness.page.getByTestId('terminal-event-lifecycle').first()).toBeVisible({
      timeout: 5_000,
    });

    await expect(harness.page.getByText('Pipeline started')).toBeVisible();
  });

  test('renders a done event row', async ({ harness }) => {
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.setState({
      terminalVisible: true,
      terminalThreadId: THREAD_ID,
    });

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
    await harness.callStore('selectProject', harness.seed.projectId);
    await harness.setState({
      terminalVisible: true,
      terminalThreadId: THREAD_ID,
    });

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
});
