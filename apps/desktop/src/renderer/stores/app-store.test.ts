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

const appendEvent = (threadId: string, suffix = 'first') =>
  useAppStore
    .getState()
    .appendCanonicalEvent(
      threadId,
      { kind: 'text', content: threadId },
      { id: `${threadId}:${suffix}`, createdAt: '2026-04-16T00:00:00.000Z' },
    );

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
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
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

    it('opens terminal without changing maximized state when toggled open', () => {
      useAppStore.setState({
        terminalVisible: false,
        terminalMaximized: true,
      });

      useAppStore.getState().toggleTerminal();

      const state = useAppStore.getState();
      expect(state.terminalVisible).toBe(true);
      expect(state.terminalMaximized).toBe(true);
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

    it('removes and clears notifications', () => {
      const createdAt = new Date().toISOString();
      useAppStore.setState({
        notifications: [
          {
            id: 'notification-1',
            threadId: 'thread-1',
            projectId: 'project-1',
            kind: 'completed',
            title: 'Done',
            body: 'first',
            createdAt,
            dismissedAt: null,
          },
          {
            id: 'notification-2',
            threadId: 'thread-2',
            projectId: 'project-1',
            kind: 'failed',
            title: 'Failed',
            body: 'second',
            createdAt,
            dismissedAt: null,
          },
        ],
      });

      useAppStore.getState().removeNotification('notification-1');
      expect(useAppStore.getState().notifications.map((notification) => notification.id)).toEqual([
        'notification-2',
      ]);

      useAppStore.getState().clearNotifications();
      expect(useAppStore.getState().notifications).toEqual([]);
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

    it('preserves state when appending an empty canonical event batch', () => {
      const before = useAppStore.getState();
      useAppStore.getState().appendCanonicalEvents('thread-empty', []);
      expect(useAppStore.getState()).toBe(before);
    });

    it('evicts the least recently written threads past the stream bound', () => {
      useAppStore.setState({
        canonicalTerminalStream: {},
        activeThreadId: null,
        terminalThreadId: null,
        assistantThreadId: null,
        terminalPaneThreadIds: [],
      });

      // Five past the bound of 20, so the five oldest keys should be gone.
      for (let i = 0; i < 25; i += 1) {
        appendEvent(`bounded-${i}`);
      }

      const keys = Object.keys(useAppStore.getState().canonicalTerminalStream);
      expect(keys).toHaveLength(20);
      expect(keys[0]).toBe('bounded-5');
      expect(keys.at(-1)).toBe('bounded-24');
    });

    it('re-orders a rewritten thread to the newest slot instead of duplicating it', () => {
      useAppStore.setState({
        canonicalTerminalStream: {},
        activeThreadId: null,
        terminalThreadId: null,
        assistantThreadId: null,
        terminalPaneThreadIds: [],
      });

      for (let i = 0; i < 20; i += 1) {
        appendEvent(`recency-${i}`);
      }
      // Touching the oldest thread makes it the newest, so the next write over
      // the bound evicts recency-1 rather than recency-0.
      appendEvent('recency-0', 'second');
      appendEvent('recency-20');

      const keys = Object.keys(useAppStore.getState().canonicalTerminalStream);
      expect(keys).toHaveLength(20);
      expect(keys).not.toContain('recency-1');
      expect(keys.at(-2)).toBe('recency-0');
      expect(keys.at(-1)).toBe('recency-20');
    });

    it('never evicts threads the UI is currently rendering', () => {
      useAppStore.setState({
        canonicalTerminalStream: {},
        activeThreadId: 'pinned-active',
        terminalThreadId: 'pinned-terminal',
        assistantThreadId: 'pinned-assistant',
        terminalPaneThreadIds: ['pinned-pane'],
      });

      for (const threadId of [
        'pinned-active',
        'pinned-terminal',
        'pinned-assistant',
        'pinned-pane',
      ])
        appendEvent(threadId);
      for (let i = 0; i < 30; i += 1) {
        appendEvent(`churn-${i}`);
      }

      const stream = useAppStore.getState().canonicalTerminalStream;
      expect(stream['pinned-active']).toHaveLength(1);
      expect(stream['pinned-terminal']).toHaveLength(1);
      expect(stream['pinned-assistant']).toHaveLength(1);
      expect(stream['pinned-pane']).toHaveLength(1);
      // Pinning changes which keys are dropped, not how many are kept: the
      // churn threads absorb the whole eviction quota.
      expect(Object.keys(stream)).toHaveLength(20);
      expect(stream['churn-0']).toBeUndefined();
      expect(stream['churn-29']).toHaveLength(1);
    });
  });

  describe('keyed cache bounds', () => {
    it('bounds per-thread and per-process caches', () => {
      useAppStore.setState({
        currentModels: {},
        lastActivityByThread: {},
        terminalEventsByThread: {},
        processToThread: {},
        agentOutputs: {},
        activeThreadId: null,
        terminalThreadId: null,
        assistantThreadId: null,
        terminalPaneThreadIds: [],
      });

      for (let i = 0; i < 130; i += 1) {
        useAppStore.getState().setCurrentModel(`model-thread-${i}`, 'sonnet');
        useAppStore.getState().touchLastActivity(`activity-thread-${i}`);
        useAppStore.getState().logTerminalEventForThread(`log-thread-${i}`, 'line');
        useAppStore.getState().mapProcessToThread(`process-${i}`, `thread-${i}`);
        useAppStore.getState().appendAgentOutput(`output-process-${i}`, 'chunk');
      }

      const state = useAppStore.getState();
      expect(Object.keys(state.currentModels)).toHaveLength(100);
      expect(Object.keys(state.lastActivityByThread)).toHaveLength(100);
      expect(Object.keys(state.terminalEventsByThread)).toHaveLength(100);
      expect(Object.keys(state.processToThread)).toHaveLength(100);
      expect(Object.keys(state.agentOutputs)).toHaveLength(100);
      expect(state.currentModels['model-thread-29']).toBeUndefined();
      expect(state.currentModels['model-thread-30']).toBe('sonnet');
      expect(state.processToThread['process-129']).toBe('thread-129');
    });
  });

  describe('terminal pane metadata', () => {
    it('stores pane mode/title/state and removes metadata on close', () => {
      useAppStore.getState().addTerminalPane('thread-live', {
        mode: 'live',
        cli: 'claude',
        title: 'Claude shell',
        state: 'running',
      });

      expect(useAppStore.getState().terminalPaneMetaByThread['thread-live']).toEqual({
        mode: 'live',
        cli: 'claude',
        title: 'Claude shell',
        state: 'running',
      });

      useAppStore.getState().setTerminalPaneState('thread-live', 'exited');
      expect(useAppStore.getState().terminalPaneMetaByThread['thread-live']?.state).toBe('exited');

      useAppStore.getState().removeTerminalPane('thread-live');
      expect(useAppStore.getState().terminalPaneMetaByThread['thread-live']).toBeUndefined();
    });

    it('keeps existing pane metadata defaults and ignores missing pane state updates', () => {
      useAppStore.getState().addTerminalPane('thread-live', {
        mode: 'live',
        title: 'Live terminal',
        cli: 'codex',
      });
      useAppStore.getState().addTerminalPane('thread-live', {});
      useAppStore.getState().setTerminalPaneState('missing-thread', 'running');

      expect(useAppStore.getState().terminalPaneThreadIds).toEqual(['thread-live']);
      expect(useAppStore.getState().terminalPaneMetaByThread['thread-live']).toEqual({
        mode: 'live',
        title: 'Live terminal',
        cli: 'codex',
        state: undefined,
      });

      useAppStore.getState().setTerminalSplitDirection('vertical');
      expect(useAppStore.getState().terminalSplitDirection).toBe('vertical');
    });

    it('writes no metadata for a thread dropped at the pane cap', () => {
      useAppStore.setState({ terminalPaneThreadIds: [], terminalPaneMetaByThread: {} });

      for (let i = 0; i < 5; i += 1) {
        useAppStore.getState().addTerminalPane(`pane-${i}`, { mode: 'live', title: `Pane ${i}` });
      }

      const state = useAppStore.getState();
      expect(state.terminalPaneThreadIds).toEqual(['pane-0', 'pane-1', 'pane-2', 'pane-3']);
      // removeTerminalPane only ever runs for open panes, so metadata for the
      // rejected thread would never be reclaimed.
      expect(state.terminalPaneMetaByThread['pane-4']).toBeUndefined();
      expect(Object.keys(state.terminalPaneMetaByThread)).toHaveLength(4);
    });
  });

  describe('view and modal actions', () => {
    it('switches top-level views and clears detail context', () => {
      useAppStore.setState({
        activeIssue: makeIssue({ threadId: 'thread-1' }),
        activeAutomationThreadId: 'automation-thread',
        activeAutomationDetailId: 'automation',
        terminalMaximized: true,
        currentPlan: { tasks: [] } as never,
        currentReview: { approved: false } as never,
        currentVerification: { passed: false } as never,
      });

      useAppStore.getState().openView('overview');
      expect(useAppStore.getState()).toMatchObject({
        viewMode: 'overview',
        activeIssue: null,
        activeAutomationThreadId: null,
        activeAutomationDetailId: null,
        terminalMaximized: false,
        currentPlan: null,
        currentReview: null,
        currentVerification: null,
      });

      for (const mode of ['activity', 'inbox', 'costs', 'skills', 'automations'] as const) {
        useAppStore.getState().openView(mode);
        expect(useAppStore.getState().viewMode).toBe(mode);
      }
    });

    it('opens and closes modals through command surfaces', () => {
      useAppStore.setState({ commandPaletteOpen: true });

      useAppStore.getState().openCreateIssueModal();
      expect(useAppStore.getState()).toMatchObject({
        createIssueModalOpen: true,
        editingPrd: null,
        commandPaletteOpen: false,
      });

      useAppStore.getState().openEditPrdModal(42, 'body', ['bug']);
      expect(useAppStore.getState().editingPrd).toEqual({
        issueNumber: 42,
        body: 'body',
        labels: ['bug'],
      });

      useAppStore.getState().closeCreateIssueModal();
      expect(useAppStore.getState()).toMatchObject({
        createIssueModalOpen: false,
        editingPrd: null,
      });

      useAppStore.getState().openProjectSettingsModal('project-1', 'github');
      expect(useAppStore.getState()).toMatchObject({
        projectSettingsModalOpen: true,
        projectSettingsModalProjectId: 'project-1',
        projectSettingsModalInitialTab: 'github',
      });
      useAppStore.getState().closeProjectSettingsModal();
      expect(useAppStore.getState().projectSettingsModalProjectId).toBeNull();

      useAppStore.getState().openProjectSettingsModal('project-2');
      expect(useAppStore.getState().projectSettingsModalInitialTab).toBeNull();

      useAppStore.getState().openCreateAutomationModal('automation-1');
      expect(useAppStore.getState()).toMatchObject({
        createAutomationModalOpen: true,
        editingAutomationId: 'automation-1',
      });
      useAppStore.getState().closeCreateAutomationModal();
      expect(useAppStore.getState().editingAutomationId).toBeNull();

      useAppStore.getState().openCreateAutomationModal();
      expect(useAppStore.getState().editingAutomationId).toBeNull();

      useAppStore.getState().openAddProjectExplorer();
      expect(useAppStore.getState().addProjectExplorerOpen).toBe(true);
      useAppStore.getState().closeAddProjectExplorer();
      expect(useAppStore.getState().addProjectExplorerOpen).toBe(false);
    });
  });

  describe('assistant and pipeline actions', () => {
    it('queues assistant prompts, tracks messages, and updates assistant settings', () => {
      useAppStore.getState().openAssistant();
      useAppStore.getState().setAssistantDraft('Draft text');
      useAppStore.getState().queueAssistantPrompt('Queued prompt');
      useAppStore.getState().setAssistantThread('assistant-thread');
      useAppStore.getState().setAssistantCli('codex');
      useAppStore.getState().appendAssistantUserMessage({
        threadId: 'assistant-thread',
        content: 'Hello assistant',
      });
      useAppStore.getState().clearAssistantQueuedPrompt();
      useAppStore.getState().closeAssistant();

      expect(useAppStore.getState()).toMatchObject({
        assistantVisible: false,
        assistantDraft: 'Queued prompt',
        assistantQueuedPrompt: null,
        assistantThreadId: 'assistant-thread',
        assistantCli: 'codex',
      });
      expect(useAppStore.getState().assistantUserMessages[0]).toMatchObject({
        threadId: 'assistant-thread',
        content: 'Hello assistant',
      });
    });

    it('tracks pending created issues and pipeline phase terminal reopening rules', () => {
      const pending = makeIssue({ id: 'pending-1' });

      useAppStore.getState().addPendingCreatedIssue(pending);
      useAppStore.getState().addPendingCreatedIssue({ ...pending, title: 'Updated pending' });
      expect(useAppStore.getState().pendingCreatedIssues).toEqual([
        expect.objectContaining({ id: 'pending-1', title: 'Updated pending' }),
      ]);

      useAppStore.getState().removePendingCreatedIssue('pending-1');
      expect(useAppStore.getState().pendingCreatedIssues).toEqual([]);

      useAppStore.setState({ pipelinePhase: 'idle', terminalVisible: false });
      useAppStore.getState().setPipelinePhase('planning');
      expect(useAppStore.getState()).toMatchObject({
        pipelinePhase: 'planning',
        terminalVisible: true,
      });

      useAppStore.setState({ terminalVisible: false });
      useAppStore.getState().setPipelinePhase('executing');
      expect(useAppStore.getState()).toMatchObject({
        pipelinePhase: 'executing',
        terminalVisible: false,
      });

      useAppStore.getState().setPipelinePhase('idle');
      expect(useAppStore.getState().pipelinePhase).toBe('idle');
    });

    it('sets core pipeline and health state', () => {
      useAppStore.getState().setPlan({ tasks: [] } as never);
      useAppStore.getState().setReview({ approved: true } as never);
      useAppStore.getState().setVerification({ passed: true } as never);
      useAppStore.getState().setSystemHealth({ git: { available: true } } as never);

      expect(useAppStore.getState()).toMatchObject({
        currentPlan: { tasks: [] },
        currentReview: { approved: true },
        currentVerification: { passed: true },
        systemHealth: { git: { available: true } },
      });
    });
  });

  describe('navigation and terminal buffers', () => {
    it('covers direct setters, automation selection, and non-trimming buffer paths', () => {
      useAppStore.setState({
        terminalVisible: false,
        terminalMaximized: true,
        activeAutomationThreadId: 'old-automation-thread',
        activeAutomationDetailId: 'old-automation',
        activeIssue: makeIssue(),
        currentPlan: { tasks: [] } as never,
        currentReview: { approved: false } as never,
        currentVerification: { passed: false } as never,
      });

      useAppStore.getState().setViewMode('activity');
      useAppStore.getState().selectThread('thread-selected');
      useAppStore.getState().selectAutomationThread('automation-thread');
      useAppStore.getState().openAutomationDetail('automation-detail');
      useAppStore.getState().toggleSidebar();
      useAppStore.getState().openTerminal();
      useAppStore.getState().setTerminalMaximized(true);
      useAppStore.getState().setSettingsSection('developer');
      useAppStore.getState().setTerminalThread('thread-terminal');
      useAppStore.getState().openCommandPalette();

      useAppStore.getState().appendAgentOutput('process-short', 'chunk');
      useAppStore.getState().logTerminalEvent('event-short');
      useAppStore.getState().logTerminalEventForThread('thread-short', 'thread-event-short');
      useAppStore.getState().appendCanonicalEvent('thread-generated-id', {
        kind: 'text',
        content: 'generated id',
      });

      expect(useAppStore.getState()).toMatchObject({
        viewMode: 'project',
        activeThreadId: 'automation-thread',
        activeAutomationThreadId: null,
        activeAutomationDetailId: 'automation-detail',
        activeIssue: null,
        sidebarCollapsed: true,
        terminalVisible: true,
        terminalMaximized: true,
        settingsSection: 'developer',
        terminalThreadId: 'thread-terminal',
        commandPaletteOpen: true,
      });
      expect(useAppStore.getState().agentOutputs['process-short']).toEqual(['chunk']);
      expect(useAppStore.getState().terminalEvents).toEqual(['event-short']);
      expect(useAppStore.getState().terminalEventsByThread['thread-short']).toEqual([
        'thread-event-short',
      ]);
      expect(
        useAppStore.getState().canonicalTerminalStream['thread-generated-id']?.[0],
      ).toMatchObject({
        threadId: 'thread-generated-id',
        event: { kind: 'text', content: 'generated id' },
      });

      useAppStore.setState({ terminalThreadId: 'pinned-thread', terminalVisible: false });
      useAppStore.getState().selectIssue(makeIssue({ threadId: null, pipelineStatus: 'todo' }));
      expect(useAppStore.getState()).toMatchObject({
        activeThreadId: null,
        terminalThreadId: null,
        terminalVisible: false,
      });

      useAppStore.setState({ terminalThreadId: 'pinned-thread' });
      useAppStore.getState().selectAutomationThread(null);
      expect(useAppStore.getState()).toMatchObject({
        activeAutomationThreadId: null,
        activeThreadId: null,
        terminalThreadId: 'pinned-thread',
      });
    });

    it('navigates to issues and worktrees with the right project context', () => {
      const issue = makeIssue({
        projectId: 'project-2',
        threadId: 'thread-2',
        pipelineStatus: 'planning',
      });
      useAppStore.setState({
        terminalVisible: false,
        terminalMaximized: true,
        commandPaletteOpen: true,
      });

      useAppStore.getState().navigateToIssue('project-2', issue);
      expect(useAppStore.getState()).toMatchObject({
        activeProjectId: 'project-2',
        viewMode: 'project',
        projectTab: 'issues',
        activeIssue: issue,
        activeThreadId: 'thread-2',
        terminalThreadId: 'thread-2',
        terminalVisible: true,
        commandPaletteOpen: false,
      });

      useAppStore.getState().navigateToGitWorktree('project-3', '/tmp/worktree');
      expect(useAppStore.getState()).toMatchObject({
        activeProjectId: 'project-3',
        activeIssue: null,
        activeThreadId: null,
        projectTab: 'git',
        pendingGitWorktreePath: '/tmp/worktree',
        githubIssues: [],
      });

      useAppStore.getState().clearPendingGitWorktreePath();
      expect(useAppStore.getState().pendingGitWorktreePath).toBeNull();

      useAppStore.setState({ terminalVisible: false });
      useAppStore
        .getState()
        .navigateToIssue('project-2', makeIssue({ threadId: null, pipelineStatus: 'todo' }));
      expect(useAppStore.getState()).toMatchObject({
        terminalThreadId: null,
        terminalVisible: false,
      });
    });

    it('trims agent output and terminal event buffers', () => {
      useAppStore.setState({
        agentOutputs: { process: Array.from({ length: 800 }, (_, index) => `old-${index}`) },
        terminalEvents: Array.from({ length: 500 }, (_, index) => `event-${index}`),
        terminalEventsByThread: {
          thread: Array.from({ length: 200 }, (_, index) => `thread-event-${index}`),
        },
      });

      useAppStore.getState().appendAgentOutput('process', 'new');
      expect(useAppStore.getState().agentOutputs.process).toHaveLength(800);
      expect(useAppStore.getState().agentOutputs.process.at(-1)).toBe('new');

      useAppStore.getState().logTerminalEvent('latest');
      expect(useAppStore.getState().terminalEvents).toHaveLength(500);
      expect(useAppStore.getState().terminalEvents.at(-1)).toBe('latest');

      useAppStore.getState().logTerminalEventForThread('thread', 'latest-thread');
      expect(useAppStore.getState().terminalEventsByThread.thread).toHaveLength(200);
      expect(useAppStore.getState().terminalEventsByThread.thread?.at(-1)).toBe('latest-thread');

      useAppStore.getState().clearAgentOutput('process');
      expect(useAppStore.getState().agentOutputs.process).toBeUndefined();
    });

    it('stores model, activity, comment composer requests, and terminal tabs', () => {
      useAppStore.getState().mapProcessToThread('process-1', 'thread-1');
      useAppStore.getState().touchLastActivity('thread-1');
      useAppStore.getState().setCurrentModel('thread-1', 'Codex / GPT-5.4');
      useAppStore.getState().requestCommentComposer('issue-1');
      useAppStore.getState().requestCommentComposer('issue-1');
      useAppStore.getState().toggleCommandPalette();
      useAppStore.getState().toggleCommandPalette();
      useAppStore.getState().setProjectTab('pull-requests');
      useAppStore.getState().setActivePrNumber(12);

      expect(useAppStore.getState()).toMatchObject({
        processToThread: { 'process-1': 'thread-1' },
        currentModels: { 'thread-1': 'Codex / GPT-5.4' },
        commentComposerRequest: { issueId: 'issue-1', requestId: 2 },
        commandPaletteOpen: false,
        projectTab: 'pull-requests',
        activePrNumber: 12,
      });
      expect(useAppStore.getState().lastActivityByThread['thread-1']).toBeTypeOf('number');

      useAppStore.setState({ activeProjectId: null, projectTab: 'issues' });
      useAppStore.getState().openTerminalTab();
      expect(useAppStore.getState().projectTab).toBe('issues');

      useAppStore.setState({
        activeProjectId: 'project-1',
        activeIssue: makeIssue(),
        activeAutomationThreadId: 'automation-thread',
        activeAutomationDetailId: 'automation',
        currentPlan: { tasks: [] } as never,
        currentReview: { approved: false } as never,
        currentVerification: { passed: false } as never,
      });
      useAppStore.getState().openTerminalTab();
      expect(useAppStore.getState()).toMatchObject({
        viewMode: 'project',
        projectTab: 'terminal',
        activeIssue: null,
        activeAutomationThreadId: null,
        activeAutomationDetailId: null,
        terminalMaximized: false,
        currentPlan: null,
        currentReview: null,
        currentVerification: null,
      });
    });

    it('trims canonical terminal streams and preserves default pane metadata', () => {
      const manyEvents = Array.from({ length: 2005 }, (_, index) => ({
        id: `event-${index}`,
        threadId: 'thread-long',
        event: { kind: 'text' as const, content: `event ${index}` },
        createdAt: `2026-04-16T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(
          index % 60,
        ).padStart(2, '0')}.000Z`,
      }));
      useAppStore.getState().appendCanonicalEvents('thread-long', manyEvents);
      expect(useAppStore.getState().canonicalTerminalStream['thread-long']).toHaveLength(2000);
      expect(useAppStore.getState().canonicalTerminalStream['thread-long']?.[0]?.id).toBe(
        'event-5',
      );

      useAppStore.getState().hydrateCanonicalEvents('thread-hydrate-long', manyEvents);
      expect(useAppStore.getState().canonicalTerminalStream['thread-hydrate-long']).toHaveLength(
        2000,
      );

      useAppStore.getState().addTerminalPane('pane-default');
      expect(useAppStore.getState().terminalPaneMetaByThread['pane-default']).toEqual({
        mode: 'replay',
        title: null,
        cli: undefined,
        state: undefined,
      });
    });

    it('orders hydrated canonical events with matching timestamps by id', () => {
      useAppStore.getState().hydrateCanonicalEvents('thread-sorted', [
        {
          id: 'event-b',
          threadId: 'thread-sorted',
          event: { kind: 'text', content: 'b' },
          createdAt: '2026-04-16T00:00:00.000Z',
        },
        {
          id: 'event-a',
          threadId: 'thread-sorted',
          event: { kind: 'text', content: 'a' },
          createdAt: '2026-04-16T00:00:00.000Z',
        },
      ]);

      expect(
        useAppStore.getState().canonicalTerminalStream['thread-sorted']?.map((event) => event.id),
      ).toEqual(['event-a', 'event-b']);
    });
  });
});
