// @vitest-environment jsdom

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
  pausedPhase: null,
  pausedAt: null,
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
  doneAt: null,
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

  it('does nothing when the preload bridge is unavailable', () => {
    (window as typeof window & { shipcode: typeof window.shipcode | undefined }).shipcode =
      undefined as never;

    expect(() => renderHarness()).not.toThrow();
    expect(listeners.size).toBe(0);
  });

  it('ignores github issue updates for non-selected projects', () => {
    renderHarness();

    listeners.get('github:issues-updated')?.({
      projectId: 'project-2',
      issues: [makeIssue({ id: 'foreign', projectId: 'project-2', title: 'Foreign issue' })],
    });

    expect(useAppStore.getState().githubIssues).toEqual([currentIssue]);
  });

  it('invalidates thread-panel data when GitHub issue updates arrive', () => {
    const { queryClient } = renderHarness();
    queryClient.setQueryData<ThreadPanelData>(['thread-panel-data', 'project-1'], {
      project: null,
      settings: DEFAULT_SETTINGS,
      threads: [],
      latestPlanStatusByThreadId: {},
      branches: [],
    });

    listeners.get('github:issues-updated')?.({
      projectId: 'project-1',
      issues: [makeIssue({ id: 'updated' })],
    });

    expect(queryClient.getQueryState(['thread-panel-data', 'project-1'])?.isInvalidated).toBe(true);
  });

  it('refreshes or clears the active issue when selected project issues update', () => {
    const refreshed = makeIssue({ id: 'issue-1', title: 'Refreshed', threadId: 'thread-new' });
    useAppStore.setState({
      activeIssue: currentIssue,
      activeThreadId: 'thread-1',
      githubIssues: [currentIssue],
    });
    renderHarness();

    listeners.get('github:issues-updated')?.({
      projectId: 'project-1',
      issues: [refreshed],
    });

    expect(useAppStore.getState().activeIssue?.title).toBe('Refreshed');
    expect(useAppStore.getState().activeThreadId).toBe('thread-new');

    listeners.get('github:issues-updated')?.({
      projectId: 'project-1',
      issues: [],
    });

    expect(useAppStore.getState().activeIssue).toBeNull();
    expect(useAppStore.getState().activeThreadId).toBe('thread-new');
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

  it('upserts full same-project thread records from phase lookup', async () => {
    const fullThread = makeThread({
      id: 'thread-100',
      projectId: 'project-1',
      status: 'planning',
      automationId: 'automation-1',
    });
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') return fullThread;
      return null;
    });
    const { queryClient } = renderHarness();
    queryClient.setQueryData<ThreadPanelData>(['thread-panel-data', 'project-1'], {
      project: null,
      settings: DEFAULT_SETTINGS,
      threads: [],
      latestPlanStatusByThreadId: {},
      branches: [],
    });

    listeners.get('pipeline:phase')?.({ phase: 'executing', threadId: 'thread-100' });

    await waitFor(() => {
      expect(useAppStore.getState().terminalVisible).toBe(true);
      expect(useAppStore.getState().terminalThreadId).toBe('thread-100');
    });
    expect(
      queryClient.getQueryData<ThreadPanelData>(['thread-panel-data', 'project-1'])?.threads,
    ).toEqual([expect.objectContaining({ id: 'thread-100', status: 'executing' })]);
  });

  it('updates existing full thread-panel records from phase lookup', async () => {
    const existingThread = makeThread({
      id: 'thread-101',
      projectId: 'project-1',
      title: 'Old title',
      status: 'planning',
    });
    const fullThread = makeThread({
      id: 'thread-101',
      projectId: 'project-1',
      title: 'Refreshed title',
      status: 'planning',
    });
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'thread:get') return fullThread;
      return null;
    });
    const { queryClient } = renderHarness();
    queryClient.setQueryData<ThreadPanelData>(['thread-panel-data', 'project-1'], {
      project: null,
      settings: DEFAULT_SETTINGS,
      threads: [existingThread],
      latestPlanStatusByThreadId: {},
      branches: [],
    });

    listeners.get('pipeline:phase')?.({ phase: 'executing', threadId: 'thread-101' });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ThreadPanelData>(['thread-panel-data', 'project-1'])?.threads,
      ).toEqual([expect.objectContaining({ id: 'thread-101', title: 'Refreshed title' })]);
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

  it('maps idle phase back to todo and ignores focus when no project is selected', () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      activeIssue: currentIssue,
      githubIssues: [currentIssue],
    });
    const { unmount } = renderHarness();

    listeners.get('pipeline:phase')?.({ phase: 'idle', threadId: 'thread-1' });

    expect(useAppStore.getState().githubIssues[0]?.pipelineStatus).toBe('todo');
    expect(useAppStore.getState().activeIssue?.pipelineStatus).toBe('todo');

    unmount();
    cleanup();
    listeners.clear();
    useAppStore.setState({
      activeProjectId: null,
      activeIssue: makeIssue({ threadId: 'thread-no-project' }),
      githubIssues: [makeIssue({ threadId: 'thread-no-project' })],
      terminalVisible: false,
      terminalThreadId: null,
    });
    renderHarness();

    listeners.get('pipeline:phase')?.({ phase: 'planning', threadId: 'thread-no-project' });

    expect(useAppStore.getState().terminalVisible).toBe(false);
    expect(useAppStore.getState().terminalThreadId).toBeNull();
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

  it('maps running agent state and ignores unsupported lifecycle states', () => {
    renderHarness();

    listeners.get('agent:state')?.({
      processId: 'proc-running',
      type: 'codex',
      state: 'running',
      threadId: 'thread-running',
    });
    listeners.get('agent:state')?.({
      processId: 'proc-queued',
      type: 'codex',
      state: 'queued',
      threadId: 'thread-queued',
    });

    expect(useAppStore.getState().processToThread['proc-running']).toBe('thread-running');
    expect(useAppStore.getState().processToThread['proc-queued']).toBeUndefined();
  });

  it('formats provider and model consistently for terminal headers', () => {
    useAppStore.setState({ terminalThreadId: 'thread-terminal' });
    renderHarness();

    listeners.get('pipeline:model-resolved')?.({
      threadId: 'thread-1',
      phase: 'review',
      requestedModel: 'gpt-5.4',
      resolvedModel: 'codex',
    });
    listeners.get('pipeline:model-resolved')?.({
      threadId: null,
      phase: 'execute',
      requestedModel: 'claude-sonnet-4-5',
      resolvedModel: 'claude',
    });

    expect(useAppStore.getState().currentModels['thread-1']).toBe('Codex / GPT-5.4');
    expect(useAppStore.getState().currentModels['thread-terminal']).toBe('claude-sonnet-4-5');
  });

  it('skips unresolved model display but still invalidates cost queries', () => {
    const { queryClient } = renderHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    listeners.get('pipeline:model-resolved')?.({
      threadId: 'thread-1',
      phase: 'review',
      requestedModel: null,
      resolvedModel: null,
    });

    expect(useAppStore.getState().currentModels['thread-1']).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['costs-summary'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['costs-project-tasks-count'] });
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

  it('applies review and verification events only to the active thread', () => {
    useAppStore.setState({
      activeThreadId: 'thread-1',
      currentReview: null,
      currentVerification: null,
    });
    renderHarness();

    listeners.get('review:parsed')?.({
      threadId: 'thread-2',
      review: { approved: false },
    });
    listeners.get('verification:parsed')?.({
      threadId: 'thread-2',
      verification: { passed: false },
    });
    expect(useAppStore.getState().currentReview).toBeNull();
    expect(useAppStore.getState().currentVerification).toBeNull();

    listeners.get('review:parsed')?.({
      threadId: 'thread-1',
      review: { approved: true },
    });
    listeners.get('verification:parsed')?.({
      threadId: 'thread-1',
      verification: { passed: true },
    });
    expect(useAppStore.getState().currentReview).toEqual({ approved: true });
    expect(useAppStore.getState().currentVerification).toEqual({ passed: true });
  });

  it('maps agent output to threads and throttles last-activity updates', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000);

    renderHarness();

    listeners.get('agent:output')?.({
      processId: 'proc-1',
      threadId: 'thread-1',
    });

    expect(useAppStore.getState().processToThread['proc-1']).toBe('thread-1');
    expect(useAppStore.getState().lastActivityByThread['thread-1']).toBe(1_000);

    nowSpy.mockReturnValue(1_250);
    listeners.get('agent:output')?.({
      processId: 'proc-1',
      threadId: 'thread-1',
    });
    expect(useAppStore.getState().lastActivityByThread['thread-1']).toBe(1_000);

    nowSpy.mockReturnValueOnce(1_600).mockReturnValueOnce(1_600);
    listeners.get('agent:output')?.({
      processId: 'proc-1',
      threadId: 'thread-1',
    });
    expect(useAppStore.getState().lastActivityByThread['thread-1']).toBe(1_600);
  });

  it('invalidates requested dashboard query groups and defaults to all groups', () => {
    const { queryClient } = renderHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    listeners.get('dashboard:invalidate')?.({ kinds: ['stats', 'running'] });
    listeners.get('dashboard:invalidate')?.({});

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'stats'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'running'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'activity'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard', 'recent'] });
  });

  it('adds, focuses, and dismisses notifications from IPC events', () => {
    const { queryClient } = renderHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    listeners.get('notification:fire')?.({
      id: 'notification-1',
      threadId: 'thread-1',
      projectId: 'project-2',
      kind: 'completed',
      title: 'Done',
      body: 'Finished',
      createdAt: '2026-04-16T00:00:00.000Z',
      dismissedAt: null,
    });

    expect(useAppStore.getState().notifications).toHaveLength(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] });

    listeners.get('notification:focus-thread')?.({
      projectId: 'project-2',
      threadId: 'thread-2',
    });

    expect(useAppStore.getState().activeProjectId).toBe('project-2');
    expect(useAppStore.getState().activeThreadId).toBe('thread-2');
    expect(useAppStore.getState().viewMode).toBe('project');

    listeners.get('notification:focus-thread')?.({
      projectId: null,
      threadId: 'thread-3',
    });
    expect(useAppStore.getState().activeProjectId).toBe('project-2');
    expect(useAppStore.getState().activeThreadId).toBe('thread-3');

    listeners.get('notification:dismiss')?.({ id: 'notification-1' });
    expect(useAppStore.getState().notifications).toEqual([]);
  });

  it('flushes pending terminal events and unsubscribes on cleanup', () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    window.shipcode.on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.set(event, cb);
      return unsubscribe;
    }) as unknown as typeof window.shipcode.on;

    const { unmount } = renderHarness();

    listeners.get('terminal:event')?.({
      id: 'event-1',
      threadId: 'thread-1',
      event: { kind: 'raw', content: 'cleanup' },
      createdAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
    });

    unmount();

    expect(useAppStore.getState().canonicalTerminalStream['thread-1']).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
