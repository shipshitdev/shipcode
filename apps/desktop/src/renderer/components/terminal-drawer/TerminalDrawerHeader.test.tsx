// @vitest-environment jsdom

import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalDrawerTarget } from './constants';
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
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function issueTarget(issue: GitHubIssueCacheRecord): TerminalDrawerTarget {
  if (!issue.threadId) throw new Error('Test issue must have a threadId');
  return {
    kind: 'issue',
    threadId: issue.threadId,
    projectId: issue.projectId,
    title: issue.title,
    label: `#${issue.issueNumber}`,
    phase: issue.pipelineStatus as TerminalDrawerTarget['phase'],
    issue,
  };
}

function renderHeader(header: ReactElement) {
  return render(<TooltipProvider>{header}</TooltipProvider>);
}

afterEach(() => {
  cleanup();
});

describe('TerminalDrawerHeader', () => {
  it('renders the active issue context and forwards single-tab actions', () => {
    const onOpenIssue = vi.fn();
    const onResetHeight = vi.fn();
    const onToggleMinimized = vi.fn();
    const onToggleMaximize = vi.fn();
    const onToggleTerminal = vi.fn();
    const issue = makeIssue();

    renderHeader(
      <TerminalDrawerHeader
        activeProjectId={null}
        approvedAwaitingExecution={false}
        currentModel="gpt-5.4"
        displayTarget={issueTarget(issue)}
        isMaximized={false}
        isMinimized={false}
        pipelinePhase="executing"
        runningTargets={[issueTarget(issue)]}
        startedAt="2m 10s"
        terminalThreadId={issue.threadId}
        onOpenProjectTerminal={() => {}}
        onOpenTarget={onOpenIssue}
        onResetHeight={onResetHeight}
        onToggleMinimized={onToggleMinimized}
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
    fireEvent.click(screen.getByRole('button', { name: 'Maximize terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minimize terminal to one line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset terminal size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));

    expect(onOpenIssue).toHaveBeenCalledWith(issueTarget(issue));
    expect(onResetHeight).toHaveBeenCalledTimes(1);
    expect(onToggleMinimized).toHaveBeenCalledTimes(1);
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

    renderHeader(
      <TerminalDrawerHeader
        activeProjectId={null}
        approvedAwaitingExecution={false}
        currentModel={null}
        displayTarget={issueTarget(issueA)}
        isMaximized={true}
        isMinimized={false}
        pipelinePhase="idle"
        runningTargets={[issueTarget(issueA), issueTarget(issueB)]}
        startedAt={null}
        terminalThreadId={issueA.threadId}
        onOpenProjectTerminal={() => {}}
        onOpenTarget={onOpenIssue}
        onResetHeight={vi.fn()}
        onToggleMinimized={vi.fn()}
        onToggleMaximize={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: /#19/i }));

    await waitFor(() => {
      expect(screen.getByText('Retry pipeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry pipeline'));
    expect(onOpenIssue).toHaveBeenCalledWith(issueTarget(issueB));
  });

  it('renders one configured terminal opener action', () => {
    const issue = makeIssue();
    const onOpenProjectTerminal = vi.fn();

    renderHeader(
      <TerminalDrawerHeader
        activeProjectId="project-1"
        approvedAwaitingExecution={false}
        currentModel={null}
        displayTarget={issueTarget(issue)}
        isMaximized={false}
        isMinimized={false}
        pipelinePhase="idle"
        runningTargets={[issueTarget(issue)]}
        startedAt={null}
        terminalThreadId={issue.threadId}
        onOpenProjectTerminal={onOpenProjectTerminal}
        onOpenTarget={() => {}}
        onResetHeight={() => {}}
        onToggleMinimized={() => {}}
        onToggleMaximize={() => {}}
        onToggleTerminal={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: /claude/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /codex/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));
    expect(onOpenProjectTerminal).toHaveBeenCalledTimes(1);
  });

  it('renders waiting-for-slot copy for approved execution waiters', () => {
    const issue = makeIssue({ pipelineStatus: 'approval' });

    renderHeader(
      <TerminalDrawerHeader
        activeProjectId={null}
        approvedAwaitingExecution
        currentModel={null}
        displayTarget={issueTarget(issue)}
        isMaximized={false}
        isMinimized={false}
        pipelinePhase="approval"
        runningTargets={[issueTarget(issue)]}
        startedAt={null}
        terminalThreadId={issue.threadId}
        onOpenProjectTerminal={() => {}}
        onOpenTarget={() => {}}
        onResetHeight={() => {}}
        onToggleMinimized={() => {}}
        onToggleMaximize={() => {}}
        onToggleTerminal={() => {}}
      />,
    );

    expect(screen.getByText('Waiting for slot')).toBeInTheDocument();
    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
  });

  it('renders automation thread context without an issue detail action', () => {
    const target: TerminalDrawerTarget = {
      kind: 'thread',
      threadId: 'thread-auto',
      projectId: 'project-1',
      title: '[Auto] clean',
      label: 'Automation',
      phase: 'testing',
    };

    renderHeader(
      <TerminalDrawerHeader
        activeProjectId="project-1"
        approvedAwaitingExecution={false}
        currentModel="gpt-5.4"
        displayTarget={target}
        isMaximized={false}
        isMinimized={false}
        pipelinePhase="testing"
        runningTargets={[target]}
        startedAt="21:26:15"
        terminalThreadId={target.threadId}
        onOpenProjectTerminal={() => {}}
        onOpenTarget={vi.fn()}
        onResetHeight={() => {}}
        onToggleMinimized={() => {}}
        onToggleMaximize={() => {}}
        onToggleTerminal={() => {}}
      />,
    );

    expect(screen.getByText('Automation')).toBeInTheDocument();
    expect(screen.getByText('[Auto] clean')).toBeInTheDocument();
    expect(screen.queryByTitle(/Open issue detail/)).toBeNull();
  });
});
