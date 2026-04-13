import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';

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
  threadId: null,
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

describe('app-store', () => {
  beforeEach(() => {
    // Reset store to a known state before each test.
    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      activeIssue: makeIssue({ threadId: 'thread-1', pipelineStatus: 'reviewing' }),
      viewMode: 'project',
      pipelinePhase: 'reviewing',
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    });
  });

  describe('selectProject', () => {
    it('clears activeIssue when switching to a different project', () => {
      // Sanity check: we start with an active issue
      expect(useAppStore.getState().activeIssue).not.toBeNull();

      useAppStore.getState().selectProject('project-2');

      const state = useAppStore.getState();
      expect(state.activeProjectId).toBe('project-2');
      expect(state.activeIssue).toBeNull();
      expect(state.activeThreadId).toBeNull();
      expect(state.pipelinePhase).toBe('idle');
    });

    it('clears activeIssue when switching to null (no project)', () => {
      useAppStore.getState().selectProject(null);

      const state = useAppStore.getState();
      expect(state.activeProjectId).toBeNull();
      expect(state.activeIssue).toBeNull();
      expect(state.activeThreadId).toBeNull();
    });

    it('clears githubIssues on project switch to prevent stale terminal header and tabs', () => {
      // Populate githubIssues with issues from the current project
      useAppStore.setState({ githubIssues: [makeIssue(), makeIssue({ id: 'issue-2' })] });
      expect(useAppStore.getState().githubIssues).toHaveLength(2);

      useAppStore.getState().selectProject('project-2');

      expect(useAppStore.getState().githubIssues).toHaveLength(0);
    });
  });
});
