import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';

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

  describe('toggleSettings', () => {
    it('closes the terminal when opening settings', () => {
      useAppStore.setState({
        settingsVisible: false,
        terminalVisible: true,
        terminalMaximized: true,
      });

      useAppStore.getState().toggleSettings();

      const state = useAppStore.getState();
      expect(state.settingsVisible).toBe(true);
      expect(state.terminalVisible).toBe(false);
      expect(state.terminalMaximized).toBe(false);
      expect(state.settingsSection).toBe('general');
    });

    it('does not reopen the terminal when closing settings', () => {
      useAppStore.setState({
        settingsVisible: true,
        terminalVisible: false,
        settingsSection: 'pipeline',
      });

      useAppStore.getState().toggleSettings();

      const state = useAppStore.getState();
      expect(state.settingsVisible).toBe(false);
      expect(state.terminalVisible).toBe(false);
      expect(state.settingsSection).toBe('general');
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

  describe('toggleTerminal', () => {
    it('clears terminalMaximized when closing the terminal', () => {
      useAppStore.setState({
        terminalVisible: true,
        terminalMaximized: true,
      });

      useAppStore.getState().toggleTerminal();

      const state = useAppStore.getState();
      expect(state.terminalVisible).toBe(false);
      expect(state.terminalMaximized).toBe(false);
    });
  });

  describe('selectIssue', () => {
    it('auto-opens the terminal for active pipeline issues', () => {
      useAppStore.setState({ terminalVisible: false });

      useAppStore
        .getState()
        .selectIssue(makeIssue({ threadId: 'thread-2', pipelineStatus: 'executing' }));

      const state = useAppStore.getState();
      expect(state.activeThreadId).toBe('thread-2');
      expect(state.terminalThreadId).toBe('thread-2');
      expect(state.terminalVisible).toBe(true);
    });

    it('keeps the terminal pinned to the prior thread when the detail panel closes', () => {
      useAppStore
        .getState()
        .selectIssue(makeIssue({ threadId: 'thread-3', pipelineStatus: 'executing' }));
      expect(useAppStore.getState().terminalThreadId).toBe('thread-3');

      useAppStore.getState().selectIssue(null);

      const state = useAppStore.getState();
      expect(state.activeIssue).toBeNull();
      expect(state.activeThreadId).toBeNull();
      // Console stays pinned so its output remains visible after closing detail.
      expect(state.terminalThreadId).toBe('thread-3');
    });
  });

  describe('notifications', () => {
    it('replaces notifications with the same id instead of duplicating them', () => {
      const createdAt = new Date().toISOString();

      useAppStore.getState().addNotification({
        id: 'notification-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        kind: 'completed',
        title: 'Done',
        body: 'first',
        createdAt,
        dismissedAt: null,
      });
      useAppStore.getState().addNotification({
        id: 'notification-1',
        threadId: 'thread-1',
        projectId: 'project-1',
        kind: 'completed',
        title: 'Done',
        body: 'updated',
        createdAt,
        dismissedAt: null,
      });

      expect(useAppStore.getState().notifications).toHaveLength(1);
      expect(useAppStore.getState().notifications[0]?.body).toBe('updated');
    });
  });

  describe('canonical terminal stream', () => {
    it('deduplicates canonical events by id when appending and hydrating', () => {
      useAppStore
        .getState()
        .appendCanonicalEvent(
          'thread-1',
          { kind: 'text', content: 'hello' },
          { id: 'event-1', createdAt: '2026-04-16T00:00:00.000Z' },
        );
      useAppStore
        .getState()
        .appendCanonicalEvent(
          'thread-1',
          { kind: 'text', content: 'hello again' },
          { id: 'event-1', createdAt: '2026-04-16T00:00:01.000Z' },
        );

      useAppStore.getState().hydrateCanonicalEvents('thread-1', [
        {
          id: 'event-1',
          threadId: 'thread-1',
          event: { kind: 'text', content: 'hydrated duplicate' },
          createdAt: '2026-04-16T00:00:02.000Z',
        },
        {
          id: 'event-2',
          threadId: 'thread-1',
          event: { kind: 'done', totalTokens: { prompt: 1, completion: 2 } },
          createdAt: '2026-04-16T00:00:03.000Z',
        },
      ]);

      expect(useAppStore.getState().canonicalTerminalStream['thread-1']).toHaveLength(2);
      expect(useAppStore.getState().canonicalTerminalStream['thread-1']?.[0]?.id).toBe('event-1');
      expect(useAppStore.getState().canonicalTerminalStream['thread-1']?.[1]?.id).toBe('event-2');
    });

    it('deduplicates batched canonical events by id', () => {
      useAppStore.getState().appendCanonicalEvents('thread-1', [
        {
          id: 'event-1',
          threadId: 'thread-1',
          event: { kind: 'text', content: 'first copy' },
          createdAt: '2026-04-16T00:00:00.000Z',
        },
        {
          id: 'event-2',
          threadId: 'thread-1',
          event: { kind: 'text', content: 'second event' },
          createdAt: '2026-04-16T00:00:01.000Z',
        },
      ]);

      useAppStore.getState().appendCanonicalEvents('thread-1', [
        {
          id: 'event-1',
          threadId: 'thread-1',
          event: { kind: 'text', content: 'latest copy' },
          createdAt: '2026-04-16T00:00:02.000Z',
        },
      ]);

      expect(useAppStore.getState().canonicalTerminalStream['thread-1']).toHaveLength(2);
      expect(useAppStore.getState().canonicalTerminalStream['thread-1']?.[0]?.event).toEqual({
        kind: 'text',
        content: 'latest copy',
      });
      expect(useAppStore.getState().canonicalTerminalStream['thread-1']?.[1]?.id).toBe('event-2');
    });
  });

  describe('instant pane metadata', () => {
    it('stores pane mode/title/state and removes metadata on close', () => {
      useAppStore.getState().addInstantPane('thread-live', {
        mode: 'live',
        cli: 'claude',
        title: 'Claude shell',
        state: 'running',
      });

      expect(useAppStore.getState().instantPaneMetaByThread['thread-live']).toEqual({
        mode: 'live',
        cli: 'claude',
        title: 'Claude shell',
        state: 'running',
      });

      useAppStore.getState().setInstantPaneState('thread-live', 'exited');
      expect(useAppStore.getState().instantPaneMetaByThread['thread-live']?.state).toBe('exited');

      useAppStore.getState().removeInstantPane('thread-live');
      expect(useAppStore.getState().instantPaneMetaByThread['thread-live']).toBeUndefined();
    });
  });
});
