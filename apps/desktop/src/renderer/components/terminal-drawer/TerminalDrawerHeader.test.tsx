// @vitest-environment jsdom

import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalDrawerHeader } from './TerminalDrawerHeader';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 19,
    title: 'Fix the board',
    body: null,
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'executing',
    threadId: 'thread-1',
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
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('TerminalDrawerHeader', () => {
  it('renders the active issue context and forwards single-tab actions', () => {
    const onOpenIssue = vi.fn();
    const onToggleMaximize = vi.fn();
    const onToggleTerminal = vi.fn();
    const issue = makeIssue();

    render(
      <TerminalDrawerHeader
        activeProjectId={null}
        approvedAwaitingExecution={false}
        currentModel="gpt-5.4"
        displayIssue={issue}
        ghosttyAvailable={false}
        isMaximized={false}
        pipelinePhase="executing"
        runningTabs={[issue]}
        startedAt="2m 10s"
        terminalAvailable={false}
        terminalThreadId={issue.threadId}
        onNewClaudeSession={() => {}}
        onNewCodexSession={() => {}}
        onOpenInGhostty={() => {}}
        onOpenInTerminalApp={() => {}}
        onOpenIssue={onOpenIssue}
        onToggleMaximize={onToggleMaximize}
        onToggleTerminal={onToggleTerminal}
      />,
    );

    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByText('#19')).toBeInTheDocument();
    expect(screen.getByText('Fix the board')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('2m 10s')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Open issue detail for #19'));
    fireEvent.click(screen.getByRole('button', { name: 'Expand terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));

    expect(onOpenIssue).toHaveBeenCalledWith(issue);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
    expect(onToggleTerminal).toHaveBeenCalledTimes(1);
  });

  it('lists multiple running tabs in the primary dropdown', async () => {
    const onOpenIssue = vi.fn();
    const issueA = makeIssue({ id: 'issue-1', issueNumber: 19, title: 'Fix the board' });
    const issueB = makeIssue({
      id: 'issue-2',
      issueNumber: 42,
      title: 'Retry pipeline',
      threadId: 'thread-2',
    });

    render(
      <TerminalDrawerHeader
        activeProjectId={null}
        approvedAwaitingExecution={false}
        currentModel={null}
        displayIssue={issueA}
        ghosttyAvailable={false}
        isMaximized={true}
        pipelinePhase="idle"
        runningTabs={[issueA, issueB]}
        startedAt={null}
        terminalAvailable={false}
        terminalThreadId={issueA.threadId}
        onNewClaudeSession={() => {}}
        onNewCodexSession={() => {}}
        onOpenInGhostty={() => {}}
        onOpenInTerminalApp={() => {}}
        onOpenIssue={onOpenIssue}
        onToggleMaximize={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: /#19/i }));

    await waitFor(() => {
      expect(screen.getByText('Retry pipeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry pipeline'));
    expect(onOpenIssue).toHaveBeenCalledWith(issueB);
  });

  it('renders direct CLI shell buttons and disables unavailable external terminals', async () => {
    const issue = makeIssue();
    const onNewClaudeSession = vi.fn();
    const onNewCodexSession = vi.fn();

    render(
      <TerminalDrawerHeader
        activeProjectId="project-1"
        approvedAwaitingExecution={false}
        currentModel={null}
        displayIssue={issue}
        ghosttyAvailable={false}
        isMaximized={false}
        pipelinePhase="idle"
        runningTabs={[issue]}
        startedAt={null}
        terminalAvailable={false}
        terminalThreadId={issue.threadId}
        onNewClaudeSession={onNewClaudeSession}
        onNewCodexSession={onNewCodexSession}
        onOpenInGhostty={() => {}}
        onOpenInTerminalApp={() => {}}
        onOpenIssue={() => {}}
        onToggleMaximize={() => {}}
        onToggleTerminal={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New Claude shell' }));
    fireEvent.click(screen.getByRole('button', { name: 'New Codex shell' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open external terminal' }));
    const ghosttyItem = screen.getByText('Open in Ghostty').closest('[role="menuitem"]');
    const terminalItem = screen.getByText('Open in Terminal.app').closest('[role="menuitem"]');
    expect(ghosttyItem).toHaveAttribute('aria-disabled', 'true');
    expect(terminalItem).toHaveAttribute('aria-disabled', 'true');

    expect(onNewClaudeSession).toHaveBeenCalledTimes(1);
    expect(onNewCodexSession).toHaveBeenCalledTimes(1);
  });

  it('renders waiting-for-slot copy for approved execution waiters', () => {
    const issue = makeIssue({ pipelineStatus: 'awaiting_approval' });

    render(
      <TerminalDrawerHeader
        activeProjectId={null}
        approvedAwaitingExecution
        currentModel={null}
        displayIssue={issue}
        ghosttyAvailable={false}
        isMaximized={false}
        pipelinePhase="awaiting_approval"
        runningTabs={[issue]}
        startedAt={null}
        terminalAvailable={false}
        terminalThreadId={issue.threadId}
        onNewClaudeSession={() => {}}
        onNewCodexSession={() => {}}
        onOpenInGhostty={() => {}}
        onOpenInTerminalApp={() => {}}
        onOpenIssue={() => {}}
        onToggleMaximize={() => {}}
        onToggleTerminal={() => {}}
      />,
    );

    expect(screen.getByText('Waiting for slot')).toBeInTheDocument();
    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
  });
});
