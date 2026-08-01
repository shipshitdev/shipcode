import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';
import { githubIssuesQueryKey, subscribeIssueCacheProjection } from './issue-cache-projection';

const makeIssue = (overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord => ({
  id: 'issue-1',
  projectId: 'project-1',
  issueNumber: 42,
  title: 'Test issue',
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
  fetchedAt: new Date().toISOString(),
  priorityRank: null,
  priorityRaw: null,
  priorityFetchedAt: null,
  isQuickMode: false,
  ...overrides,
});

describe('issue cache projection', () => {
  let queryClient: QueryClient;
  let unsubscribe: () => void;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      activeIssue: null,
      githubIssues: [],
    });
    unsubscribe = subscribeIssueCacheProjection(queryClient);
  });

  afterEach(() => {
    unsubscribe();
    queryClient.clear();
  });

  it('derives the store issue list from a cache write', () => {
    const issue = makeIssue();

    queryClient.setQueryData(githubIssuesQueryKey('project-1'), [issue]);

    expect(useAppStore.getState().githubIssues).toEqual([issue]);
  });

  it('reconciles the active issue with the newest cached record', () => {
    const issue = makeIssue();
    useAppStore.setState({ activeIssue: issue, githubIssues: [issue] });

    queryClient.setQueryData(githubIssuesQueryKey('project-1'), [
      { ...issue, pipelineStatus: 'executing' },
    ]);

    const state = useAppStore.getState();
    expect(state.activeIssue?.pipelineStatus).toBe('executing');
    // Board and detail view read the same record, so they cannot disagree.
    expect(state.githubIssues[0]).toBe(state.activeIssue);
  });

  it('clears the active issue when it disappears from the cache but keeps the thread', () => {
    const issue = makeIssue();
    useAppStore.setState({ activeIssue: issue, githubIssues: [issue] });

    queryClient.setQueryData(githubIssuesQueryKey('project-1'), []);

    expect(useAppStore.getState().activeIssue).toBeNull();
    expect(useAppStore.getState().activeThreadId).toBe('thread-1');
  });

  it('ignores cache writes for projects that are not selected', () => {
    const issue = makeIssue();
    useAppStore.setState({ githubIssues: [issue] });

    queryClient.setQueryData(githubIssuesQueryKey('project-2'), [
      makeIssue({ id: 'foreign', projectId: 'project-2' }),
    ]);

    expect(useAppStore.getState().githubIssues).toEqual([issue]);
  });

  it('projects the already-cached list when the active project changes', () => {
    const foreign = makeIssue({ id: 'issue-2', projectId: 'project-2', threadId: 'thread-2' });
    queryClient.setQueryData(githubIssuesQueryKey('project-2'), [foreign]);
    expect(useAppStore.getState().githubIssues).toEqual([]);

    useAppStore.setState({ activeProjectId: 'project-2' });

    expect(useAppStore.getState().githubIssues).toEqual([foreign]);
  });

  it('projects whatever is already cached at subscribe time', () => {
    unsubscribe();
    const issue = makeIssue();
    queryClient.setQueryData(githubIssuesQueryKey('project-1'), [issue]);
    useAppStore.setState({ githubIssues: [] });

    unsubscribe = subscribeIssueCacheProjection(queryClient);

    expect(useAppStore.getState().githubIssues).toEqual([issue]);
  });

  it('stops writing once unsubscribed', () => {
    unsubscribe();
    unsubscribe = () => {};

    queryClient.setQueryData(githubIssuesQueryKey('project-1'), [makeIssue()]);

    expect(useAppStore.getState().githubIssues).toEqual([]);
  });
});
