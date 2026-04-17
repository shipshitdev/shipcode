// @vitest-environment jsdom

import type { GitHubIssueCacheRecord } from '@shipcode/shared';
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
        currentModel="gpt-5.4"
        displayIssue={issue}
        isMaximized={false}
        pipelinePhase="executing"
        runningTabs={[issue]}
        startedAt="2m 10s"
        terminalThreadId={issue.threadId}
        onOpenIssue={onOpenIssue}
        onToggleMaximize={onToggleMaximize}
        onToggleTerminal={onToggleTerminal}
      />,
    );

    expect(screen.getByText('Terminal')).toBeInTheDocument();
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
        currentModel={null}
        displayIssue={issueA}
        isMaximized={true}
        pipelinePhase="idle"
        runningTabs={[issueA, issueB]}
        startedAt={null}
        terminalThreadId={issueA.threadId}
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
});
