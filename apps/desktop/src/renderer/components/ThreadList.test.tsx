// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { renderWithQueryClient } from '../test/render';
import { ThreadList } from './ThreadList';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: '[P1] Wire the agent',
    body: 'body',
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
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
    fetchedAt: '2026-08-19T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

describe('ThreadList', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeIssue: null,
      githubIssues: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders issues for the selected project and opens the conversation on click', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'github:list-issues') {
        return [makeIssue(), makeIssue({ id: 'issue-2', issueNumber: 7, title: 'Older' })];
      }
      return [];
    });

    renderWithQueryClient(<ThreadList />);

    expect(await screen.findByTestId('thread-row-42')).toBeInTheDocument();
    expect(screen.getByText('Wire the agent')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thread-row-42'));
    expect(useAppStore.getState().activeIssue?.issueNumber).toBe(42);
  });

  it('asks the user to pick a project when none is selected', () => {
    useAppStore.setState({ activeProjectId: null });
    invokeMock.mockResolvedValue([]);

    renderWithQueryClient(<ThreadList />);

    expect(screen.getByText(/Select a project to see its issues/)).toBeInTheDocument();
  });
});
