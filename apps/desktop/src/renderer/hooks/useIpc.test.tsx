import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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
  fetchedAt: new Date().toISOString(),
  priorityRank: null,
  priorityRaw: null,
  priorityFetchedAt: null,
  isQuickMode: false,
  ...overrides,
});

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  projectId: 'project-1',
  kind: 'pipeline',
  title: 'Issue',
  prompt: 'Body',
  status: 'planning',
  worktreeBranch: null,
  worktreePath: null,
  plannerModel: 'claude',
  reviewerModel: 'claude',
  verifierModel: 'claude',
  executorModel: 'claude',
  reviewRound: 0,
  clarificationRound: 0,
  clarificationRequest: null,
  clarificationAnswers: [],
  answeredClarification: null,
  verificationStatus: null,
  verificationRetries: 0,
  autonomous: true,
  baseBranch: 'main',
  forkPointSha: null,
  githubIssueNumber: null,
  githubPrNumber: null,
  githubRepo: null,
  automationId: null,
  lastError: null,
  failurePhase: null,
  failureCount: 0,
  createdAt: '2026-04-22T10:00:00.000Z',
  updatedAt: '2026-04-22T10:00:00.000Z',
  plannerResolvedModel: null,
  reviewerResolvedModel: null,
  revisorResolvedModel: null,
  executorResolvedModel: null,
  verifierResolvedModel: null,
  totalTokensPrompt: 0,
  totalTokensCompletion: 0,
  totalCostUsd: 0,
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
      terminalPaneMetaByThread: {},
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
    const view = render(
      <QueryClientProvider client={queryClient}>
        <TestHarness />
      </QueryClientProvider>,
    );
    return { ...view, queryClient };
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

  it('updates selected-project issue status locally without refetching github issues', () => {
    useAppStore.setState({
      activeThreadId: 'thread-1',
      activeIssue: currentIssue,
      githubIssues: [currentIssue],
    });

    renderHarness();

    listeners.get('pipeline:phase')?.({ phase: 'executing', threadId: 'thread-1' });

    const state = useAppStore.getState();
    expect(state.pipelinePhase).toBe('executing');
    expect(state.githubIssues[0]?.pipelineStatus).toBe('executing');
    expect(state.activeIssue?.pipelineStatus).toBe('executing');
    expect(invokeMock).not.toHaveBeenCalledWith(
      'github:list-issues',
      expect.objectContaining({ projectId: 'project-1' }),
    );
  });

  it('updates cached thread-panel data so automation cards move live', () => {
    invokeMock.mockResolvedValue(null);
    const automationThread = makeThread({
      id: 'automation-thread-1',
      title: '[Auto] Nightly cleanup',
      automationId: 'automation-1',
      status: 'planning',
    });
    const { queryClient } = renderHarness();
    queryClient.setQueryData<ThreadPanelData>(['thread-panel-data', 'project-1'], {
      project: null,
      settings: DEFAULT_SETTINGS,
      threads: [automationThread],
      latestPlanStatusByThreadId: {},
      branches: [],
    });

    listeners.get('pipeline:phase')?.({ phase: 'executing', threadId: automationThread.id });

    const panelData = queryClient.getQueryData<ThreadPanelData>(['thread-panel-data', 'project-1']);
    expect(panelData?.threads[0]?.status).toBe('executing');
  });

  it('batches raw terminal events before hydrating the canonical stream', () => {
    vi.useFakeTimers();
    renderHarness();

    listeners.get('terminal:event')?.({
      id: 'event-1',
      threadId: 'thread-1',
      event: { kind: 'raw', content: 'hello' },
      createdAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
    });
    listeners.get('terminal:event')?.({
      id: 'event-2',
      threadId: 'thread-1',
      event: { kind: 'raw', content: 'world' },
      createdAt: new Date('2026-04-16T00:00:00.001Z').toISOString(),
    });

    expect(useAppStore.getState().canonicalTerminalStream).toEqual({});

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(useAppStore.getState().canonicalTerminalStream['thread-1']).toHaveLength(2);
    vi.useRealTimers();
  });

  it('tracks live terminal pane state from agent lifecycle events', () => {
    useAppStore.getState().addTerminalPane('thread-live', {
      mode: 'live',
      cli: 'claude',
      title: 'Claude shell',
      state: 'running',
    });

    renderHarness();

    listeners.get('agent:state')?.({
      processId: 'proc-live',
      type: 'claude',
      state: 'exited',
      threadId: 'thread-live',
    });

    expect(useAppStore.getState().terminalPaneMetaByThread['thread-live']?.state).toBe('exited');
  });

  it('formats provider and model consistently for terminal headers', () => {
    renderHarness();

    listeners.get('pipeline:model-resolved')?.({
      threadId: 'thread-1',
      phase: 'review',
      requestedModel: 'gpt-5.4',
      resolvedModel: 'codex',
    });

    expect(useAppStore.getState().currentModels['thread-1']).toBe('Codex / GPT-5.4');
  });

  it('invalidates plan-history queries when phase event fires for the active thread', () => {
    useAppStore.setState({
      activeThreadId: 'thread-1',
      activeIssue: currentIssue,
      githubIssues: [currentIssue],
    });

    const { queryClient } = renderHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    listeners.get('pipeline:phase')?.({ phase: 'executing', threadId: 'thread-1' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['plan-history', 'thread-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issue-plan-history'] });
  });

  it('invalidates plan-history queries when plan:parsed event fires', () => {
    useAppStore.setState({ activeThreadId: 'thread-1' });

    const { queryClient } = renderHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    listeners.get('plan:parsed')?.({
      threadId: 'thread-1',
      plan: { steps: [], objective: 'x', files: [], acceptanceCriteria: [] },
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['plan-history', 'thread-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issue-plan-history'] });
  });
});
