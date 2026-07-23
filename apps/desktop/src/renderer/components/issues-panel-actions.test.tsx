// @vitest-environment jsdom

import {
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type Thread,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../stores/toast-store';
import { useIssuesPanelActions } from './issues-panel-actions';

const logError = vi.hoisted(() => vi.fn());

vi.mock('electron-log/renderer', () => ({
  default: {
    error: logError,
  },
}));

const PROJECT_ID = 'project-1';
const THREAD_ID = 'thread-1';
const ISSUE_ID = 'issue-1';
const ISSUE_NUMBER = 313;

function makeIssue(pipelineStatus: IssuePipelineStatus = ISSUE_PIPELINE_STATUS.executing) {
  return {
    id: ISSUE_ID,
    issueNumber: ISSUE_NUMBER,
    pipelineStatus,
    threadId: THREAD_ID,
  };
}

function makeThread(pausedPhase: Thread['pausedPhase'] = PIPELINE_PHASE.verifying): Thread {
  return {
    id: THREAD_ID,
    pausedPhase,
  } as Thread;
}

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const patchIssueOptimistic = vi.fn();
  const patchThreadOptimistic = vi.fn();
  const refreshIssues = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useIssuesPanelActions({
        activeProjectId: PROJECT_ID,
        threadById: new Map([[THREAD_ID, makeThread()]]),
        patchIssueOptimistic,
        patchThreadOptimistic,
        refreshIssues,
      }),
    { wrapper },
  );

  return {
    ...view,
    invalidateQueries,
    patchIssueOptimistic,
    patchThreadOptimistic,
    refreshIssues,
  };
}

describe('useIssuesPanelActions', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('starts an issue and refreshes issue state after success', async () => {
    const { result, patchIssueOptimistic, refreshIssues, invalidateQueries } = renderActions();

    await act(async () => {
      await result.current.startPipeline(makeIssue());
    });

    expect(patchIssueOptimistic).toHaveBeenCalledWith(ISSUE_ID, {
      pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
    });
    expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
      projectId: PROJECT_ID,
      issueNumber: ISSUE_NUMBER,
    });
    expect(refreshIssues).toHaveBeenCalledWith(PROJECT_ID);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('refreshes, logs, and reports a failed issue start', async () => {
    const error = new Error('start failed');
    invokeMock.mockRejectedValue(error);
    const { result, refreshIssues } = renderActions();

    await act(async () => {
      await result.current.startPipeline(makeIssue());
    });

    expect(refreshIssues).toHaveBeenCalledWith(PROJECT_ID);
    expect(logError).toHaveBeenCalledWith('[threadpanel] start-issue failed', {
      issueNumber: ISSUE_NUMBER,
      err: error,
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: `Failed to start issue #${ISSUE_NUMBER}`,
      body: 'start failed',
    });
  });

  it('pauses a thread and reconciles issue and thread state after success', async () => {
    const {
      result,
      patchIssueOptimistic,
      patchThreadOptimistic,
      refreshIssues,
      invalidateQueries,
    } = renderActions();

    await act(async () => {
      await result.current.pausePipeline(makeIssue());
    });

    expect(patchIssueOptimistic).toHaveBeenCalledWith(ISSUE_ID, {
      pipelineStatus: ISSUE_PIPELINE_STATUS.paused,
    });
    expect(patchThreadOptimistic).toHaveBeenCalledWith(THREAD_ID, {
      status: PIPELINE_PHASE.paused,
      pausedPhase: ISSUE_PIPELINE_STATUS.executing,
      pausedAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(invokeMock).toHaveBeenCalledWith('pipeline:pause', { threadId: THREAD_ID });
    expect(refreshIssues).toHaveBeenCalledWith(PROJECT_ID);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-panel-data', PROJECT_ID],
    });
  });

  it('reconciles, logs, and reports a failed pause', async () => {
    const error = new Error('pause failed');
    invokeMock.mockRejectedValue(error);
    const { result, refreshIssues, invalidateQueries } = renderActions();

    await act(async () => {
      await result.current.pausePipeline(makeIssue());
    });

    expect(refreshIssues).toHaveBeenCalledWith(PROJECT_ID);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-panel-data', PROJECT_ID],
    });
    expect(logError).toHaveBeenCalledWith('[threadpanel] pause failed', {
      issueNumber: ISSUE_NUMBER,
      err: error,
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Failed to pause task',
      body: 'pause failed',
    });
  });

  it('resumes a thread to its paused phase and reconciles after success', async () => {
    const {
      result,
      patchIssueOptimistic,
      patchThreadOptimistic,
      refreshIssues,
      invalidateQueries,
    } = renderActions();

    await act(async () => {
      await result.current.resumePipeline(makeIssue(ISSUE_PIPELINE_STATUS.paused));
    });

    expect(patchIssueOptimistic).toHaveBeenCalledWith(ISSUE_ID, {
      pipelineStatus: PIPELINE_PHASE.verifying,
    });
    expect(patchThreadOptimistic).toHaveBeenCalledWith(THREAD_ID, {
      status: PIPELINE_PHASE.verifying,
      pausedPhase: null,
      pausedAt: null,
      updatedAt: expect.any(String),
    });
    expect(invokeMock).toHaveBeenCalledWith('pipeline:resume', { threadId: THREAD_ID });
    expect(refreshIssues).toHaveBeenCalledWith(PROJECT_ID);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-panel-data', PROJECT_ID],
    });
  });

  it('reconciles, logs, and reports a failed resume', async () => {
    const error = new Error('resume failed');
    invokeMock.mockRejectedValue(error);
    const { result, refreshIssues, invalidateQueries } = renderActions();

    await act(async () => {
      await result.current.resumePipeline(makeIssue(ISSUE_PIPELINE_STATUS.paused));
    });

    expect(refreshIssues).toHaveBeenCalledWith(PROJECT_ID);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-panel-data', PROJECT_ID],
    });
    expect(logError).toHaveBeenCalledWith('[threadpanel] resume failed', {
      issueNumber: ISSUE_NUMBER,
      err: error,
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Failed to resume task',
      body: 'resume failed',
    });
  });
});
