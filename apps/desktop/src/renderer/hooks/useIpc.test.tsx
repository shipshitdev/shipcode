import type { GitHubIssueCacheRecord, Thread } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { useIpc } from './useIpc';

const listeners = new Map<string, (...args: unknown[]) => void>();

function TestHarness() {
  useIpc();
  return null;
}

const makeIssue = (overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord => ({
  id: 'issue-1',
  projectId: 'project-1',
  issueNumber: 1,
  title: 'Issue',
  body: 'Body',
  labels: [],
  assignee: null,
  state: 'open',
  pipelineStatus: 'planning',
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
  fetchedAt: new Date().toISOString(),
  ...overrides,
});

describe('useIpc terminal scoping', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  let currentIssue: GitHubIssueCacheRecord;

  beforeEach(() => {
    listeners.clear();
    invokeMock.mockReset();
    currentIssue = makeIssue();
    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners.set(event, cb);
        return () => listeners.delete(event);
      }) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: null,
      activeIssue: null,
      terminalVisible: false,
      terminalThreadId: 'thread-1',
      pipelinePhase: 'idle',
      githubIssues: [currentIssue],
      currentModels: {},
      canonicalTerminalStream: {},
      notifications: [],
    });
  });

  afterEach(() => {
    cleanup();
    listeners.clear();
  });

  function renderHarness() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <TestHarness />
      </QueryClientProvider>,
    );
  }

  it('ignores github issue updates for non-selected projects', () => {
    renderHarness();

    listeners.get('github:issues-updated')?.({
      projectId: 'project-2',
      issues: [makeIssue({ id: 'foreign', projectId: 'project-2', title: 'Foreign issue' })],
    });

    expect(useAppStore.getState().githubIssues).toEqual([currentIssue]);
  });

  it('does not retarget the terminal when a foreign project pipeline starts', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') {
        return { id: 'thread-2', projectId: 'project-2' } satisfies Partial<Thread>;
      }
      if (channel === 'github:list-issues') {
        return [currentIssue];
      }
      return null;
    });

    renderHarness();

    listeners.get('pipeline:phase')?.({ phase: 'planning', threadId: 'thread-2' });

    await waitFor(() => {
      expect(useAppStore.getState().terminalVisible).toBe(false);
      expect(useAppStore.getState().terminalThreadId).toBe('thread-1');
    });
  });

  it('focuses a new same-project pipeline via thread lookup even before issue refresh catches up', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') {
        return { id: 'thread-99', projectId: 'project-1' } satisfies Partial<Thread>;
      }
      if (channel === 'github:list-issues') {
        return [makeIssue({ threadId: 'thread-99', title: 'Fresh thread issue' })];
      }
      return null;
    });

    useAppStore.setState({
      githubIssues: [makeIssue({ threadId: null, pipelineStatus: 'planning' })],
      terminalVisible: false,
      terminalThreadId: null,
    });

    renderHarness();

    listeners.get('pipeline:phase')?.({ phase: 'planning', threadId: 'thread-99' });

    await waitFor(() => {
      expect(useAppStore.getState().terminalVisible).toBe(true);
      expect(useAppStore.getState().terminalThreadId).toBe('thread-99');
    });
  });
});
