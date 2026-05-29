/**
 * Additional branch-coverage tests for register-github-handlers.ts
 *
 * Mirrors the mock conventions of register-github-handlers.test.ts exactly.
 * Focuses on the specific branches, catch-handlers, and edge cases that the
 * existing suite leaves uncovered.
 */
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitHubHandlers } from './register-github-handlers';

vi.mock('../logger.service', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  logEvent: vi.fn(),
}));

// ---- hoisted mocks – must match the primary test file exactly ----
const {
  closeIssueMock,
  createIssueMock,
  editIssueMock,
  getIssueMock,
  getRepoMetadataMock,
  reopenIssueMock,
  listAllIssuesMock,
  fetchProjectPrioritiesMock,
  fetchProjectStatusesMock,
  checkProjectReadinessMock,
  triageGitHubIssuesMock,
  enhancePrdDraftMock,
  checkCliModelCapabilitiesMock,
  archiveProjectItemsMock,
  addIssueCommentMock,
  listIssueCommentsMock,
  listRepoLabelsWithMetaMock,
  ensureLabelsMock,
  addIssueToProjectMock,
  setIssueLabelPresenceMock,
  setIssueProjectMetadataMock,
  syncIssueLabelsMock,
  applyTriageRulesOnceMock,
} = vi.hoisted(() => ({
  closeIssueMock: vi.fn(),
  createIssueMock: vi.fn(),
  editIssueMock: vi.fn(),
  getIssueMock: vi.fn(),
  getRepoMetadataMock: vi.fn(),
  reopenIssueMock: vi.fn(),
  listAllIssuesMock: vi.fn(async () => [] as Array<unknown>),
  fetchProjectPrioritiesMock: vi.fn(),
  fetchProjectStatusesMock: vi.fn(),
  checkProjectReadinessMock: vi.fn(),
  triageGitHubIssuesMock: vi.fn(),
  enhancePrdDraftMock: vi.fn(),
  checkCliModelCapabilitiesMock: vi.fn(),
  archiveProjectItemsMock: vi.fn(async () => undefined),
  addIssueCommentMock: vi.fn(async () => undefined),
  listIssueCommentsMock: vi.fn(async () => [] as Array<unknown>),
  listRepoLabelsWithMetaMock: vi.fn(async () => [] as Array<unknown>),
  addIssueToProjectMock: vi.fn(async () => ({ alreadyPresent: false })),
  setIssueLabelPresenceMock: vi.fn(async () => undefined),
  setIssueProjectMetadataMock: vi.fn(async () => [] as string[]),
  syncIssueLabelsMock: vi.fn(async () => undefined),
  ensureLabelsMock: vi.fn(async () => ({
    created: [],
    alreadyPresent: [],
    failed: [],
  })),
  applyTriageRulesOnceMock: vi.fn(async () => ({ status: 'skipped' as const })),
}));

vi.mock('@shipcode/agents', async () => {
  const actual = await vi.importActual<typeof import('@shipcode/agents')>('@shipcode/agents');
  class MockGhCli {
    closeIssue = closeIssueMock;
    createIssue = createIssueMock;
    editIssue = editIssueMock;
    getIssue = getIssueMock;
    getRepoMetadata = getRepoMetadataMock;
    reopenIssue = reopenIssueMock;
    listAllIssues = listAllIssuesMock;
    archiveProjectItems = archiveProjectItemsMock;
    addIssueComment = addIssueCommentMock;
    listIssueComments = listIssueCommentsMock;
    listRepoLabelsWithMeta = listRepoLabelsWithMetaMock;
    ensureLabels = ensureLabelsMock;
    addIssueToProject = addIssueToProjectMock;
    setIssueLabelPresence = setIssueLabelPresenceMock;
    setIssueProjectMetadata = setIssueProjectMetadataMock;
    syncIssueLabels = syncIssueLabelsMock;
  }
  return {
    ...actual,
    GhCli: MockGhCli,
    fetchProjectPriorities: fetchProjectPrioritiesMock,
    fetchProjectStatuses: fetchProjectStatusesMock,
    checkProjectReadiness: checkProjectReadinessMock,
    triageGitHubIssues: triageGitHubIssuesMock,
    enhancePrdDraft: enhancePrdDraftMock,
    checkCliModelCapabilities: checkCliModelCapabilitiesMock,
    applyTriageRulesOnce: applyTriageRulesOnceMock,
  };
});

// ---- shared test scaffolding ----

describe('registerGitHubHandlers – branch coverage supplement', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  };

  const baseProject = {
    id: 'project-1',
    name: 'Project',
    path: '/tmp',
    gitRemote: 'https://github.com/acme/repo.git',
    githubProjectUrl: null,
    githubStatusMapping: null,
    defaultBranch: 'main',
    githubRepoFullName: 'acme/repo',
    notifyGithubUser: null,
  };

  const baseIssue = {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue title',
    body: 'Issue body',
    labels: [] as string[],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: null as string | null,
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
    requireApprovalOverride: null,
    linkedPrNumber: null as number | null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [] as string[],
    unresolvedReviewComments: [] as unknown[],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null as string | null,
    fetchedAt: new Date().toISOString(),
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    rulesAppliedAt: null as string | null,
    issueType: null,
    archivedAt: null,
    updatedAt: null,
  };

  const baseThread = {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread',
    prompt: 'Prompt',
    status: 'failed',
    kind: 'pipeline' as const,
    worktreeBranch: 'ship/42',
    worktreePath: '/tmp/worktree',
    plannerModel: 'claude',
    reviewerModel: 'claude',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 1,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: 'sha',
    githubIssueNumber: 42,
    githubPrNumber: null as number | null,
    githubRepo: 'acme/repo',
    automationId: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
  };

  function buildGithubIssuesQueries(
    overrides: Record<string, unknown> = {},
    listResult: unknown[] = [baseIssue],
  ): Record<string, ReturnType<typeof vi.fn>> {
    return {
      getByNumber: vi.fn(() => baseIssue),
      updatePipelineStatus: vi.fn(),
      linkThread: vi.fn(),
      clearThread: vi.fn(),
      list: vi.fn(() => listResult),
      setIssueType: vi.fn(),
      reconcileCompletedFromEvidence: vi.fn(),
      resetStaleApproval: vi.fn(() => 0),
      markTriageRulesApplied: vi.fn(),
      recordTriageRulesFailure: vi.fn(),
      runInTransaction: vi.fn((fn: () => unknown) => fn()),
      updateState: vi.fn(),
      clearArchivedAt: vi.fn(),
      upsert: vi.fn(() => ({ ...baseIssue })),
      markClosedOnClose: vi.fn(),
      ...overrides,
    };
  }

  function registerHandlers(queries: unknown): void {
    handlers.clear();
    vi.clearAllMocks();
    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });
  }

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    listAllIssuesMock.mockResolvedValue([]);
    fetchProjectPrioritiesMock.mockResolvedValue({
      priorities: new Map(),
      issueTypes: new Map(),
      archivedIssueNumbers: new Set(),
    });
    fetchProjectStatusesMock.mockResolvedValue(new Map());
    getRepoMetadataMock.mockResolvedValue({
      githubRepoId: 'repo-1',
      githubRepoFullName: 'acme/repo',
    });
    createIssueMock.mockResolvedValue({
      number: 42,
      title: 'Issue title',
      body: 'Issue body',
      labels: [],
      assignee: null,
      state: 'open',
      url: 'https://github.com/acme/repo/issues/42',
    });
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Issue title',
      body: 'Issue body',
      labels: [],
      assignee: null,
      state: 'open',
      author: null,
    });
    setIssueProjectMetadataMock.mockResolvedValue([]);
    addIssueToProjectMock.mockResolvedValue({ alreadyPresent: false });
    applyTriageRulesOnceMock.mockResolvedValue({ status: 'skipped' as const });
    checkProjectReadinessMock.mockResolvedValue({
      ok: true,
      items: [],
      labelSync: { created: [], alreadyPresent: [], failed: [] },
      statusMapping: null,
    });
  });

  // ---------------------------------------------------------------------------
  // resolveOpenIssuePipelineStatus branches (lines 89-94)
  // Exercised via github:reopen-issue which calls syncOpenIssueState
  // ---------------------------------------------------------------------------

  describe('resolveOpenIssuePipelineStatus', () => {
    it('returns the label status when thread exists in an active (non-stale) status and issue has a pipeline label', async () => {
      // thread.status = 'planning' → NOT in STALE_LINK_THREAD_STATUSES
      // labelStatus from 'shipcode:pipeline:queued' → 'queued' (not null)
      // → branch 7[0] (line 89): if (labelStatus !== null) return labelStatus
      const activeThread = { ...baseThread, status: 'planning' };
      const issue = {
        ...baseIssue,
        labels: ['shipcode:pipeline:queued'],
        pipelineStatus: 'todo' as const,
        threadId: activeThread.id,
      };
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries(
          {
            getByNumber: vi.fn(() => issue),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
          },
          [issue],
        ),
        threads: {
          getById: vi.fn(() => activeThread),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
      registerHandlers(queries);

      const reopen = handlers.get('github:reopen-issue');
      if (!reopen) throw new Error('handler not registered');

      await reopen(undefined, { projectId: 'project-1', issueNumber: 42 });

      // The labelStatus (queued) should be applied
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(issue.id, 'queued');
    });

    it('returns thread status when thread is in active status and issue has no pipeline label', async () => {
      // thread.status = 'planning' → NOT stale, labelStatus is null → line 90
      // thread.status !== idle → returns thread.status directly (branch 8[0])
      const activeThread = { ...baseThread, status: 'planning' };
      const issue = {
        ...baseIssue,
        labels: [] as string[],
        pipelineStatus: 'todo' as const,
        threadId: activeThread.id,
      };
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries(
          {
            getByNumber: vi.fn(() => issue),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
          },
          [issue],
        ),
        threads: {
          getById: vi.fn(() => activeThread),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
      registerHandlers(queries);

      const reopen = handlers.get('github:reopen-issue');
      if (!reopen) throw new Error('handler not registered');

      await reopen(undefined, { projectId: 'project-1', issueNumber: 42 });

      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(issue.id, 'planning');
    });

    it('returns labelStatus when no thread and issue has a pipeline label (line 94)', async () => {
      // No thread, labelStatus not null → branch 10[0]: return labelStatus
      const issue = {
        ...baseIssue,
        labels: ['shipcode:pipeline:failed'],
        pipelineStatus: 'todo' as const,
        threadId: null,
      };
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries(
          {
            getByNumber: vi.fn(() => issue),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
          },
          [issue],
        ),
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
      registerHandlers(queries);

      const reopen = handlers.get('github:reopen-issue');
      if (!reopen) throw new Error('handler not registered');

      await reopen(undefined, { projectId: 'project-1', issueNumber: 42 });

      // labelStatus from 'shipcode:pipeline:failed' = 'failed'
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(issue.id, 'failed');
    });

    it('returns queued when no thread, no pipeline label, and pipelineStatus is queued (branch 10[0])', async () => {
      // No thread, labelStatus = null (no pipeline label), pipelineStatus === 'queued'
      // → branch 10[0] at line 95: if (issue.pipelineStatus === queued) return queued
      const queuedIssue = {
        ...baseIssue,
        labels: [] as string[],
        pipelineStatus: 'queued' as const,
        threadId: null,
        linkedPrNumber: null,
      };
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries(
          {
            getByNumber: vi.fn(() => queuedIssue),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
          },
          [queuedIssue],
        ),
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
      registerHandlers(queries);

      const reopen = handlers.get('github:reopen-issue');
      if (!reopen) throw new Error('handler not registered');

      await reopen(undefined, { projectId: 'project-1', issueNumber: 42 });

      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
        queuedIssue.id,
        'queued',
      );
    });

    it('returns completed when no thread, no label, and issue has a linked PR', async () => {
      // No thread, labelStatus null, pipelineStatus != queued, linkedPrNumber != null
      // → returns ISSUE_PIPELINE_STATUS.completed
      const issue = {
        ...baseIssue,
        labels: [] as string[],
        pipelineStatus: 'todo' as const,
        threadId: null,
        linkedPrNumber: 7,
      };
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries(
          {
            getByNumber: vi.fn(() => issue),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
          },
          [issue],
        ),
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
      registerHandlers(queries);

      const reopen = handlers.get('github:reopen-issue');
      if (!reopen) throw new Error('handler not registered');

      await reopen(undefined, { projectId: 'project-1', issueNumber: 42 });

      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(issue.id, 'completed');
    });
  });

  // ---------------------------------------------------------------------------
  // mergeTriageLabels – suggestedAgent already present in labels (branch 18[1])
  // ---------------------------------------------------------------------------

  describe('github:triage-issues – mergeTriageLabels branch', () => {
    it('skips adding the suggestedAgent label when labels already contain a routing label', async () => {
      const candidate = {
        ...baseIssue,
        id: 'triage-candidate',
        state: 'open',
        pipelineStatus: 'todo',
        isQuickMode: false,
        threadId: null,
        labels: [] as string[],
      };

      // recommendation: confidence >= threshold, has suggestedAgent,
      // and suggestedLabels already includes an agent routing label
      triageGitHubIssuesMock.mockResolvedValue({
        provider: 'openrouter',
        modelId: 'openrouter/auto',
        resolvedModel: 'openrouter/auto',
        recommendations: [
          {
            issueNumber: 42,
            confidence: 1.0,
            needsHuman: false,
            suggestedAgent: 'claude',
            // 'shipcode:agent:codex' is a routing label – already present
            suggestedLabels: ['shipcode:agent:codex', 'bug'],
            shouldStart: false,
            rationale: 'test',
          },
        ],
      });
      getIssueMock.mockResolvedValue({
        number: 42,
        title: 'Issue',
        body: 'Body',
        labels: ['shipcode:agent:codex', 'bug'],
        assignee: null,
        state: 'open',
      });
      ensureLabelsMock.mockResolvedValue({ created: [], alreadyPresent: [], failed: [] });

      const queries = {
        projects: { getById: vi.fn(() => ({ ...baseProject, path: '/tmp' })) },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn(() => [candidate]),
            upsert: vi.fn(() => ({ ...candidate })),
          },
          [candidate],
        ),
        settings: {
          get: vi.fn(() => ({
            triageModel: 'openrouter',
            triageModelId: 'openrouter/auto',
            triageAutoApplyThreshold: 0.5,
          })),
        },
      };
      registerHandlers(queries);

      const triage = handlers.get('github:triage-issues');
      if (!triage) throw new Error('handler not registered');

      const result = await triage(undefined, { projectId: 'project-1' });

      expect(result).toMatchObject({ appliedCount: 1 });
      // syncIssueLabels called – but the extra agent label should NOT have been added
      // because suggestedLabels already contains an agent routing label
      expect(syncIssueLabelsMock).toHaveBeenCalledWith(
        42,
        expect.not.arrayContaining(['shipcode:agent:claude']),
        expect.any(Object),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // refresh-issues: applyTriageRulesOnce returning 'applied' (lines 304-320)
  // ---------------------------------------------------------------------------

  describe('github:refresh-issues – triage rules applied path', () => {
    it('upserts the refreshed issue when applyTriageRulesOnce returns applied', async () => {
      const newRecord = {
        ...baseIssue,
        id: 'new-issue',
        issueNumber: 99,
        rulesAppliedAt: null,
        state: 'open',
      };
      const refreshedIssue = {
        number: 99,
        title: 'Updated title',
        body: 'Updated body',
        labels: ['bug'],
        assignee: null,
        state: 'open',
        updatedAt: '2026-05-01T00:00:00.000Z',
      };

      applyTriageRulesOnceMock.mockResolvedValue({
        status: 'applied' as const,
        refreshedIssue,
      });

      listAllIssuesMock.mockResolvedValue([
        {
          number: 99,
          title: 'New Issue',
          body: 'Body',
          labels: [],
          assignee: null,
          state: 'open',
          updatedAt: null,
          url: 'https://github.com/acme/repo/issues/99',
        },
      ]);

      const queries = {
        projects: {
          getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn().mockReturnValueOnce([]).mockReturnValue([newRecord]),
            getByNumber: vi.fn(() => null), // new issue, not in cache
            upsert: vi.fn(() => ({ ...newRecord })),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
            resetStaleApproval: vi.fn(() => 0),
          },
          [newRecord],
        ),
        issueEdges: { replaceBodyEdges: vi.fn() },
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
        triageRules: { list: vi.fn(() => [{ id: 'rule-1', name: 'Test rule' }]) },
      };
      registerHandlers(queries);

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('handler not registered');

      await refresh(undefined, { projectId: 'project-1', force: true });

      // upsert should have been called twice: initial + after triage applied
      expect(queries.githubIssues.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          issueNumber: 99,
          title: 'Updated title',
          updatedAt: '2026-05-01T00:00:00.000Z',
        }),
      );
    });

    it('invokes recordFailure and onWarn callbacks when applyTriageRulesOnce calls them', async () => {
      // Simulate applyTriageRulesOnce calling the recordFailure and onWarn callbacks
      // by capturing them from the arguments and invoking them directly.
      applyTriageRulesOnceMock.mockImplementationOnce(
        async ({
          recordFailure,
          onWarn,
        }: {
          recordFailure: (issueId: string, reason: string) => void;
          onWarn: (message: string, err: unknown) => void;
        }) => {
          recordFailure('new-issue', 'triage failed');
          onWarn('triage warning', new Error('warn'));
          return { status: 'failed' as const };
        },
      );

      const newRecord = {
        ...baseIssue,
        id: 'new-issue',
        issueNumber: 88,
        rulesAppliedAt: null,
        state: 'open',
      };

      listAllIssuesMock.mockResolvedValue([
        {
          number: 88,
          title: 'New Issue',
          body: 'Body',
          labels: [],
          assignee: null,
          state: 'open',
          updatedAt: null,
          url: 'https://github.com/acme/repo/issues/88',
        },
      ]);

      const queries = {
        projects: {
          getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn().mockReturnValueOnce([]).mockReturnValue([newRecord]),
            getByNumber: vi.fn(() => null),
            upsert: vi.fn(() => ({ ...newRecord })),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
            resetStaleApproval: vi.fn(() => 0),
            recordTriageRulesFailure: vi.fn(),
          },
          [newRecord],
        ),
        issueEdges: { replaceBodyEdges: vi.fn() },
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
        triageRules: { list: vi.fn(() => [{ id: 'rule-1' }]) },
      };
      registerHandlers(queries);

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('handler not registered');

      await refresh(undefined, { projectId: 'project-1', force: true });

      // The recordFailure callback body (line 304) should have been invoked
      expect(queries.githubIssues.recordTriageRulesFailure).toHaveBeenCalledWith(
        'new-issue',
        'triage failed',
      );
      // The onWarn callback body (line 305) should have been invoked
      const { default: log } = await import('../logger.service');
      expect(log.warn).toHaveBeenCalledWith('triage warning', expect.any(Error));
    });

    it('uses null updatedAt when refreshedIssue.updatedAt is absent (branch 39[1])', async () => {
      // applyTriageRulesOnce returns applied with a refreshedIssue that has no updatedAt
      // → updatedAt: refreshedIssue.updatedAt ?? null → null (right side of ??)
      applyTriageRulesOnceMock.mockImplementationOnce(async () => ({
        status: 'applied' as const,
        refreshedIssue: {
          number: 55,
          title: 'Refreshed',
          body: 'Body',
          labels: [],
          assignee: null,
          state: 'open',
          updatedAt: undefined, // undefined → right side of ?? → null
        },
      }));

      const newRecord = {
        ...baseIssue,
        id: 'new-55',
        issueNumber: 55,
        rulesAppliedAt: null,
        state: 'open',
      };

      listAllIssuesMock.mockResolvedValue([
        {
          number: 55,
          title: 'New',
          body: 'Body',
          labels: [],
          assignee: null,
          state: 'open',
          updatedAt: null,
          url: 'https://github.com/acme/repo/issues/55',
        },
      ]);

      const queries = {
        projects: {
          getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn().mockReturnValueOnce([]).mockReturnValue([newRecord]),
            getByNumber: vi.fn(() => null),
            upsert: vi.fn(() => ({ ...newRecord })),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
            resetStaleApproval: vi.fn(() => 0),
          },
          [newRecord],
        ),
        issueEdges: { replaceBodyEdges: vi.fn() },
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
        triageRules: { list: vi.fn(() => [{ id: 'r1' }]) },
      };
      registerHandlers(queries);

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('handler not registered');

      await refresh(undefined, { projectId: 'project-1', force: true });

      // upsert for the refreshed issue should use null for updatedAt
      expect(queries.githubIssues.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ issueNumber: 55, updatedAt: null }),
      );
    });

    it('skips re-upsert when applyTriageRulesOnce returns status other than applied', async () => {
      applyTriageRulesOnceMock.mockResolvedValue({ status: 'skipped' as const });

      const newRecord = {
        ...baseIssue,
        id: 'new-skip',
        issueNumber: 77,
        rulesAppliedAt: null,
        state: 'open',
      };

      listAllIssuesMock.mockResolvedValue([
        {
          number: 77,
          title: 'Skip issue',
          body: 'Body',
          labels: [],
          assignee: null,
          state: 'open',
          updatedAt: null,
          url: 'https://github.com/acme/repo/issues/77',
        },
      ]);

      const queries = {
        projects: {
          getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn().mockReturnValueOnce([]).mockReturnValue([newRecord]),
            getByNumber: vi.fn(() => null),
            upsert: vi.fn(() => ({ ...newRecord })),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
            resetStaleApproval: vi.fn(() => 0),
          },
          [newRecord],
        ),
        issueEdges: { replaceBodyEdges: vi.fn() },
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
        triageRules: { list: vi.fn(() => [{ id: 'rule-1' }]) },
      };
      registerHandlers(queries);

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('handler not registered');

      await refresh(undefined, { projectId: 'project-1', force: true });

      // upsert is only called once (initial upsert in the transaction, not for triage)
      const upsertCalls = (queries.githubIssues.upsert as ReturnType<typeof vi.fn>).mock.calls;
      expect(upsertCalls.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // refresh-issues: PR feedback sync .catch() fires (line 461)
  // ---------------------------------------------------------------------------

  describe('github:refresh-issues – PR feedback sync error path', () => {
    it('logs a warning when syncLinkedPullRequestFeedback rejects but still resolves refresh', async () => {
      // Issue with threadId → sync will attempt; GhCli.getPullRequestFeedback is not
      // defined on MockGhCli, so the call throws a TypeError (not a function), which
      // is caught by the .catch() at line 460-464.
      const issueWithThread = {
        ...baseIssue,
        id: 'pr-sync-issue',
        issueNumber: 42,
        threadId: 'thread-1',
        prLastSyncAt: null,
      };

      listAllIssuesMock.mockResolvedValue([]);

      const queries = {
        projects: {
          getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn(() => [issueWithThread]),
            getByNumber: vi.fn(() => null),
            upsert: vi.fn(),
            updateState: vi.fn(),
            clearArchivedAt: vi.fn(),
            resetStaleApproval: vi.fn(() => 0),
            reconcileCompletedFromEvidence: vi.fn(),
            updatePullRequestFeedback: vi.fn(),
            setCachedLabelPresence: vi.fn(),
          },
          [issueWithThread],
        ),
        issueEdges: { replaceBodyEdges: vi.fn() },
        threads: {
          getById: vi.fn(() => ({
            ...baseThread,
            id: 'thread-1',
            // githubPrNumber triggers ghCli.getPullRequestFeedback call
            githubPrNumber: 99,
          })),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
      registerHandlers(queries);

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('handler not registered');

      // Should resolve without rethrowing the PR sync error
      await expect(refresh(undefined, { projectId: 'project-1', force: true })).resolves.toEqual(
        expect.any(Array),
      );

      // The warn from the .catch() is called
      const { default: log } = await import('../logger.service');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('PR feedback sync failed for #42'),
        expect.any(Error),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // github:refresh-issues – githubRemoteRef null (branch 31[1] line 240)
  // ---------------------------------------------------------------------------

  it('passes githubRepoFullName to fetchProjectPriorities and fetchProjectStatuses when already set', async () => {
    // When project.githubRepoFullName is set, githubRepoFullName is used directly
    // instead of parsing from remote. This exercises branches 43[1] and 47[1] where
    // the non-null left side of `??` is used.
    const projectWithFullName = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubRepoFullName: 'acme/repo',
      githubStatusMapping: {
        todo: { name: 'Todo', optionId: 'todo-id' },
        inProgress: { name: 'In Progress', optionId: 'progress-id' },
        humanReview: { name: 'Human Review', optionId: 'review-id' },
        deferred: { name: 'Deferred', optionId: 'deferred-id' },
        done: { name: 'Done', optionId: 'done-id' },
      },
    };
    listAllIssuesMock.mockResolvedValue([]);
    fetchProjectStatusesMock.mockResolvedValue(new Map());

    const queries = {
      projects: {
        getById: vi.fn(() => projectWithFullName),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([]),
          upsert: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
        },
        [],
      ),
      issueEdges: { replaceBodyEdges: vi.fn() },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('handler not registered');

    await refresh(undefined, { projectId: 'project-1', force: true });

    // updateGithubRepoIdentity should NOT be called (githubRepoFullName was already set)
    expect(queries.projects.updateGithubRepoIdentity).not.toHaveBeenCalled();
    // fetchProjectPriorities should be called with the preset repoFullName
    expect(fetchProjectPrioritiesMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'acme/repo' }),
    );
    expect(fetchProjectStatusesMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'acme/repo' }),
    );
  });

  it('passes undefined repoFullName to priority/status fetchers when githubRepoFullName is null (branches 43[1] and 47[1])', async () => {
    // When githubRepoFullName resolves to null and project has a board URL,
    // `githubRepoFullName ?? undefined` passes undefined to fetchProjectPriorities/Statuses.
    // This needs: githubRepoFullName=null + project.githubProjectUrl set.
    const projectNoRepoName = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubRepoFullName: null, // no pre-set name
      gitRemote: 'not-a-parseable-remote', // parseGithubRemote returns null
      githubStatusMapping: {
        todo: { name: 'Todo', optionId: 'tid' },
        inProgress: { name: 'In Progress', optionId: 'pid' },
        humanReview: { name: 'HR', optionId: 'hid' },
        deferred: { name: 'Deferred', optionId: 'did' },
        done: { name: 'Done', optionId: 'done-id' },
      },
    };
    // getRepoMetadata fails so githubRepoFullName stays null
    getRepoMetadataMock.mockRejectedValue(new Error('meta fail'));
    listAllIssuesMock.mockResolvedValue([]);
    fetchProjectStatusesMock.mockResolvedValue(new Map());

    const queries = {
      projects: {
        getById: vi.fn(() => projectNoRepoName),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([]),
          upsert: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
        },
        [],
      ),
      issueEdges: { replaceBodyEdges: vi.fn() },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('handler not registered');

    await refresh(undefined, { projectId: 'project-1', force: true });

    // repoFullName should be undefined (right side of ??) for both calls
    expect(fetchProjectPrioritiesMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: undefined }),
    );
    expect(fetchProjectStatusesMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: undefined }),
    );
  });

  it('uses null repo full name when gitRemote cannot be parsed', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => ({
          ...baseProject,
          path: '/tmp',
          gitRemote: 'not-a-real-remote-url', // parseGithubRemote returns null
          githubRepoFullName: null,
        })),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([]),
          upsert: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
        },
        [],
      ),
      issueEdges: { replaceBodyEdges: vi.fn() },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('handler not registered');

    await expect(refresh(undefined, { projectId: 'project-1', force: true })).resolves.toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // github:refresh-issues – issue state neither closed nor open (branch 35[1])
  // ---------------------------------------------------------------------------

  it('skips state sync when issue state is neither open nor closed', async () => {
    listAllIssuesMock.mockResolvedValue([
      {
        number: 42,
        title: 'Draft',
        body: 'Body',
        labels: [],
        assignee: null,
        state: 'draft', // neither 'open' nor 'closed'
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/42',
      },
    ]);

    const draftRecord = {
      ...baseIssue,
      id: 'draft-1',
      issueNumber: 42,
      state: 'draft',
      threadId: null,
    };

    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([draftRecord]),
          getByNumber: vi.fn(() => null),
          upsert: vi.fn(() => ({ ...draftRecord })),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
          markClosedOnClose: vi.fn(),
        },
        [draftRecord],
      ),
      issueEdges: { replaceBodyEdges: vi.fn() },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('handler not registered');

    await refresh(undefined, { projectId: 'project-1', force: true });

    // markClosedOnClose should NOT be called for a draft
    expect(queries.githubIssues.markClosedOnClose).not.toHaveBeenCalled();
    // updateState should NOT be called (only happens in syncOpenIssueState for 'open' records)
    expect(queries.githubIssues.updateState).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // github:update-issue-metadata – project/issue missing, no-op metadata
  // ---------------------------------------------------------------------------

  describe('github:update-issue-metadata', () => {
    it('throws when project is not found', async () => {
      const queries = {
        projects: { getById: vi.fn(() => null) },
        githubIssues: buildGithubIssuesQueries(),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:update-issue-metadata');
      if (!handler) throw new Error('handler not registered');

      await expect(handler(undefined, { projectId: 'project-1', issueNumber: 42 })).rejects.toThrow(
        'Project project-1 not found',
      );
    });

    it('throws when issue is not found', async () => {
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries({ getByNumber: vi.fn(() => null) }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:update-issue-metadata');
      if (!handler) throw new Error('handler not registered');

      await expect(handler(undefined, { projectId: 'project-1', issueNumber: 42 })).rejects.toThrow(
        'Issue #42 not found in project project-1',
      );
    });

    it('skips setIssueProjectMetadata call when no metadata keys are specified', async () => {
      const queries = {
        projects: { getById: vi.fn(() => ({ ...baseProject, githubProjectUrl: null })) },
        githubIssues: buildGithubIssuesQueries({ setIssueType: vi.fn(), setPriority: vi.fn() }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:update-issue-metadata');
      if (!handler) throw new Error('handler not registered');

      // Neither issueType nor priority passed – metadata object stays empty
      await handler(undefined, { projectId: 'project-1', issueNumber: 42 });

      expect(setIssueProjectMetadataMock).not.toHaveBeenCalled();
    });

    it('maps all supported priority values to their rank codes', async () => {
      const queries = {
        projects: {
          getById: vi.fn(() => ({
            ...baseProject,
            githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
          })),
        },
        githubIssues: buildGithubIssuesQueries({
          getByNumber: vi.fn(() => baseIssue),
          setIssueType: vi.fn(),
          setPriority: vi.fn(),
        }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:update-issue-metadata');
      if (!handler) throw new Error('handler not registered');

      // Test P0
      await handler(undefined, { projectId: 'project-1', issueNumber: 42, priority: 'P0' });
      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({ rank: 'p0', raw: 'P0' }),
      );

      // Test P2
      handlers.clear();
      registerHandlers(queries);
      const handler2 = handlers.get('github:update-issue-metadata');
      if (!handler2) throw new Error('handler not registered');
      await handler2(undefined, { projectId: 'project-1', issueNumber: 42, priority: 'P2' });
      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({ rank: 'p2', raw: 'P2' }),
      );

      // Test P3
      handlers.clear();
      registerHandlers(queries);
      const handler3 = handlers.get('github:update-issue-metadata');
      if (!handler3) throw new Error('handler not registered');
      await handler3(undefined, { projectId: 'project-1', issueNumber: 42, priority: 'P3' });
      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({ rank: 'p3', raw: 'P3' }),
      );

      // Test unknown priority → rank null
      handlers.clear();
      registerHandlers(queries);
      const handler4 = handlers.get('github:update-issue-metadata');
      if (!handler4) throw new Error('handler not registered');
      await handler4(undefined, { projectId: 'project-1', issueNumber: 42, priority: 'Unknown' });
      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({ rank: null, raw: 'Unknown' }),
      );
    });

    it('sets issueType and priority to empty string when passed null', async () => {
      const queries = {
        projects: {
          getById: vi.fn(() => ({
            ...baseProject,
            githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
          })),
        },
        githubIssues: buildGithubIssuesQueries({
          getByNumber: vi.fn(() => baseIssue),
          setIssueType: vi.fn(),
          setPriority: vi.fn(),
        }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:update-issue-metadata');
      if (!handler) throw new Error('handler not registered');

      // passing null explicitly should set rank=null, raw=null
      await handler(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        issueType: null,
        priority: null,
      });

      // metadata is built with '' for null values → setIssueProjectMetadata is called
      expect(setIssueProjectMetadataMock).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { issueType: '', priority: '' } }),
      );
      expect(queries.githubIssues.setIssueType).toHaveBeenCalledWith({
        id: baseIssue.id,
        issueType: null,
      });
      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({ rank: null, raw: null }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // github:create-issue – prdMetadata with warnings, null createdRecord
  // ---------------------------------------------------------------------------

  describe('github:create-issue – prdMetadata branch', () => {
    it('accumulates project-attach warning and metadata warnings when both occur', async () => {
      const projectWithBoard = {
        ...baseProject,
        githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      };
      // First addIssueToProject call (from attachIssueToConfiguredProjectBoard) → succeeds
      addIssueToProjectMock.mockResolvedValue({ alreadyPresent: false });
      // setIssueProjectMetadata returns warnings
      setIssueProjectMetadataMock.mockResolvedValue(['complexity field not found']);

      const createdRecord = { ...baseIssue, issueNumber: 42 };
      const queries = {
        projects: { getById: vi.fn(() => projectWithBoard) },
        githubIssues: buildGithubIssuesQueries(
          {
            upsert: vi.fn(),
            getByNumber: vi.fn(() => createdRecord),
            setIssueType: vi.fn(),
            setPriority: vi.fn(),
          },
          [createdRecord],
        ),
      };
      registerHandlers(queries);

      const create = handlers.get('github:create-issue');
      if (!create) throw new Error('handler not registered');

      const result = await create(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        prdMetadata: { estimatedComplexity: 'medium', blastRadius: 'low' },
      });

      expect((result as { projectAttachWarning: string | null }).projectAttachWarning).toContain(
        'complexity field not found',
      );
    });

    it('catches and warns when setIssueProjectMetadata throws', async () => {
      const projectWithBoard = {
        ...baseProject,
        githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      };
      setIssueProjectMetadataMock.mockRejectedValue(new Error('metadata boom'));

      const createdRecord = { ...baseIssue, issueNumber: 42 };
      const queries = {
        projects: { getById: vi.fn(() => projectWithBoard) },
        githubIssues: buildGithubIssuesQueries(
          {
            upsert: vi.fn(),
            getByNumber: vi.fn(() => createdRecord),
            setIssueType: vi.fn(),
            setPriority: vi.fn(),
          },
          [createdRecord],
        ),
      };
      registerHandlers(queries);

      const create = handlers.get('github:create-issue');
      if (!create) throw new Error('handler not registered');

      const result = await create(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        prdMetadata: { estimatedComplexity: 'low', blastRadius: 'low' },
      });

      const { default: log } = await import('../logger.service');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('project metadata failed for #42'),
        expect.any(Error),
      );
      // Still returns a result
      expect(result).toMatchObject({ issue: createdRecord });
    });

    it('skips setIssueType/setPriority when createdRecord is null after prdMetadata upsert', async () => {
      const projectWithBoard = {
        ...baseProject,
        githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      };

      const queries = {
        projects: { getById: vi.fn(() => projectWithBoard) },
        githubIssues: buildGithubIssuesQueries(
          {
            upsert: vi.fn(),
            // first call returns record (for the final getByNumber), second returns null (for prdMetadata)
            getByNumber: vi
              .fn()
              .mockReturnValueOnce(null) // prdMetadata: createdRecord is null
              .mockReturnValueOnce({ ...baseIssue }), // final return
            setIssueType: vi.fn(),
            setPriority: vi.fn(),
          },
          [baseIssue],
        ),
      };
      registerHandlers(queries);

      const create = handlers.get('github:create-issue');
      if (!create) throw new Error('handler not registered');

      await create(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        prdMetadata: { estimatedComplexity: 'high', blastRadius: 'high' },
      });

      // setIssueType/setPriority must NOT be called because createdRecord was null
      expect(queries.githubIssues.setIssueType).not.toHaveBeenCalled();
      expect(queries.githubIssues.setPriority).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // github:sync-to-project-board – various branches
  // ---------------------------------------------------------------------------

  describe('github:sync-to-project-board', () => {
    const projectWithBoard = {
      ...baseProject,
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };

    it('counts already-present and failed board sync results correctly', async () => {
      const issue1 = { ...baseIssue, id: 'i1', issueNumber: 10, isQuickMode: false };
      const issue2 = { ...baseIssue, id: 'i2', issueNumber: 11, isQuickMode: false };
      const issue3 = { ...baseIssue, id: 'i3', issueNumber: 12, isQuickMode: false };

      addIssueToProjectMock
        .mockResolvedValueOnce({ alreadyPresent: true }) // issue1
        .mockRejectedValueOnce(new Error('board error')) // issue2 → failed
        .mockResolvedValueOnce({ alreadyPresent: false }); // issue3 → attached

      const queries = {
        projects: {
          getById: vi.fn(() => projectWithBoard),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          {
            list: vi.fn(() => [issue1, issue2, issue3]),
            setPriority: vi.fn(),
            setIssueType: vi.fn(),
          },
          [issue1, issue2, issue3],
        ),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:sync-to-project-board');
      if (!handler) throw new Error('handler not registered');

      const result = await handler(undefined, { projectId: 'project-1' });

      expect(result).toMatchObject({ attached: 1, alreadyPresent: 1, failed: 1 });
      expect((result as { errors: string[] }).errors).toHaveLength(1);
      expect((result as { errors: string[] }).errors[0]).toContain('#11');
    });

    it('falls back to null when githubRepoFullName is absent and remote is unparseable', async () => {
      const projectNoRemote = {
        ...baseProject,
        githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
        githubRepoFullName: null,
        gitRemote: 'git@noparse', // won't parse to owner/repo
      };
      getRepoMetadataMock.mockResolvedValue({
        githubRepoId: 'r1',
        githubRepoFullName: 'acme/repo',
      });

      const queries = {
        projects: {
          getById: vi.fn(() => projectNoRemote),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          { list: vi.fn(() => []), setPriority: vi.fn(), setIssueType: vi.fn() },
          [],
        ),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:sync-to-project-board');
      if (!handler) throw new Error('handler not registered');

      const result = await handler(undefined, { projectId: 'project-1' });

      expect(result).toMatchObject({ attached: 0, alreadyPresent: 0, failed: 0 });
    });

    it('swallows fetchProjectPriorities errors during sync', async () => {
      fetchProjectPrioritiesMock.mockRejectedValue(new Error('priority boom'));

      const queries = {
        projects: {
          getById: vi.fn(() => projectWithBoard),
          updateGithubRepoIdentity: vi.fn(),
        },
        githubIssues: buildGithubIssuesQueries(
          { list: vi.fn(() => []), setPriority: vi.fn(), setIssueType: vi.fn() },
          [],
        ),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:sync-to-project-board');
      if (!handler) throw new Error('handler not registered');

      await expect(handler(undefined, { projectId: 'project-1' })).resolves.toMatchObject({
        attached: 0,
        alreadyPresent: 0,
        failed: 0,
      });

      const { default: log } = await import('../logger.service');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('priority sync failed'),
        expect.any(Error),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // github:auto-run – maxTasks = 0 (unlimited)
  // ---------------------------------------------------------------------------

  it('runs all eligible issues when maxTasks is 0 (unlimited)', async () => {
    const { PipelineScheduler } = await import('../pipeline-scheduler');
    const startOrQueue = vi
      .spyOn(PipelineScheduler.prototype, 'startOrQueue')
      .mockResolvedValue({ queued: false });

    const eligibleIssues = [
      { ...baseIssue, id: 'e1', issueNumber: 1 },
      { ...baseIssue, id: 'e2', issueNumber: 2 },
      { ...baseIssue, id: 'e3', issueNumber: 3 },
    ];

    const queries = {
      projects: { getById: vi.fn(() => baseProject) },
      githubIssues: {
        getEligibleTodoIssues: vi.fn(() => eligibleIssues),
        list: vi.fn(() => eligibleIssues),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const autoRun = handlers.get('github:auto-run');
    if (!autoRun) throw new Error('handler not registered');

    const result = await autoRun(undefined, {
      projectId: 'project-1',
      priorities: ['p0', 'p1', 'p2', 'p3'],
      maxTasks: 0, // unlimited
    });

    // Should start all 3 without slicing
    expect(startOrQueue).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ started: 3, queued: 0 });
    startOrQueue.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // assertPhaseRole – invalid phase throws (line 1363-1364)
  // ---------------------------------------------------------------------------

  describe('assertPhaseRole – invalid phase validation', () => {
    it('throws on invalid phase in set-phase-model-override', () => {
      const queries = {
        githubIssues: buildGithubIssuesQueries({ updatePhaseModelOverride: vi.fn() }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:set-phase-model-override');
      if (!handler) throw new Error('handler not registered');

      expect(() =>
        handler(undefined, {
          projectId: 'project-1',
          issueNumber: 42,
          phase: 'invalid-phase',
          model: 'claude',
        }),
      ).toThrow('Invalid phase role: invalid-phase');
    });

    it('throws on invalid phase in clear-phase-model-override', () => {
      const queries = {
        githubIssues: buildGithubIssuesQueries({ updatePhaseModelOverride: vi.fn() }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:clear-phase-model-override');
      if (!handler) throw new Error('handler not registered');

      expect(() =>
        handler(undefined, {
          projectId: 'project-1',
          issueNumber: 42,
          phase: 'admin',
        }),
      ).toThrow('Invalid phase role: admin');
    });

    it('throws on invalid phase in set-phase-model-id-override', () => {
      const queries = {
        githubIssues: buildGithubIssuesQueries({ updatePhaseModelIdOverride: vi.fn() }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:set-phase-model-id-override');
      if (!handler) throw new Error('handler not registered');

      expect(() =>
        handler(undefined, {
          projectId: 'project-1',
          issueNumber: 42,
          phase: 'manager',
          modelId: 'claude-3',
        }),
      ).toThrow('Invalid phase role: manager');
    });

    it('throws on invalid phase in set-phase-reasoning-effort-override', () => {
      const queries = {
        githubIssues: buildGithubIssuesQueries({
          updatePhaseReasoningEffortOverride: vi.fn(),
        }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:set-phase-reasoning-effort-override');
      if (!handler) throw new Error('handler not registered');

      expect(() =>
        handler(undefined, {
          projectId: 'project-1',
          issueNumber: 42,
          phase: 'unknown',
          effort: 'high',
        }),
      ).toThrow('Invalid phase role: unknown');
    });

    it('throws on invalid phase in clear-phase-reasoning-effort-override', () => {
      const queries = {
        githubIssues: buildGithubIssuesQueries({
          updatePhaseReasoningEffortOverride: vi.fn(),
        }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:clear-phase-reasoning-effort-override');
      if (!handler) throw new Error('handler not registered');

      expect(() =>
        handler(undefined, {
          projectId: 'project-1',
          issueNumber: 42,
          phase: 'bad',
        }),
      ).toThrow('Invalid phase role: bad');
    });
  });

  // ---------------------------------------------------------------------------
  // github:set-phase-model-id-override – invalid model ID characters (line 1441-1442)
  // ---------------------------------------------------------------------------

  it('throws when model ID contains invalid characters', () => {
    const queries = {
      githubIssues: buildGithubIssuesQueries({ updatePhaseModelIdOverride: vi.fn() }),
    };
    registerHandlers(queries);

    const handler = handlers.get('github:set-phase-model-id-override');
    if (!handler) throw new Error('handler not registered');

    expect(() =>
      handler(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        modelId: 'bad model id with spaces!',
      }),
    ).toThrow('Invalid model ID: bad model id with spaces!');
  });

  it('accepts model IDs with all valid characters', () => {
    const queries = {
      githubIssues: buildGithubIssuesQueries({ updatePhaseModelIdOverride: vi.fn() }),
    };
    registerHandlers(queries);

    const handler = handlers.get('github:set-phase-model-id-override');
    if (!handler) throw new Error('handler not registered');

    // Valid characters: letters, digits, ._:/@-
    expect(() =>
      handler(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        modelId: 'openrouter/anthropic/claude-opus-4.5:thinking',
      }),
    ).not.toThrow();

    expect(queries.githubIssues.updatePhaseModelIdOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'planner',
      'openrouter/anthropic/claude-opus-4.5:thinking',
    );
  });

  // ---------------------------------------------------------------------------
  // github:auto-run – error path within per-issue catch
  // ---------------------------------------------------------------------------

  it('reports failed issues in auto-run and continues with remaining issues', async () => {
    const { PipelineScheduler } = await import('../pipeline-scheduler');
    const startOrQueue = vi
      .spyOn(PipelineScheduler.prototype, 'startOrQueue')
      .mockRejectedValueOnce(new Error('pipeline error'))
      .mockResolvedValueOnce({ queued: true });

    const eligibleIssues = [
      { ...baseIssue, id: 'e1', issueNumber: 1 },
      { ...baseIssue, id: 'e2', issueNumber: 2 },
    ];

    const queries = {
      projects: { getById: vi.fn(() => baseProject) },
      githubIssues: {
        getEligibleTodoIssues: vi.fn(() => eligibleIssues),
        list: vi.fn(() => eligibleIssues),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const autoRun = handlers.get('github:auto-run');
    if (!autoRun) throw new Error('handler not registered');

    const result = await autoRun(undefined, {
      projectId: 'project-1',
      priorities: ['p0'],
      maxTasks: 5,
    });

    // First issue failed, second queued
    expect(result).toMatchObject({ started: 0, queued: 1 });
    const { default: log } = await import('../logger.service');
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to enqueue issue #1'),
      expect.any(Error),
    );
    startOrQueue.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // github:check-project-readiness – path and statusMapping branches
  // ---------------------------------------------------------------------------

  describe('github:check-project-readiness – additional coverage', () => {
    it('clears statusMapping when project has board URL but readiness returns no mapping', async () => {
      const projectWithBoard = {
        ...baseProject,
        githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      };
      checkProjectReadinessMock.mockResolvedValue({
        ok: true,
        items: [],
        labelSync: { created: [], alreadyPresent: [], failed: [] },
        statusMapping: null, // no mapping returned → should call clearGithubStatusMapping
      });

      const queries = {
        projects: {
          getById: vi.fn(() => projectWithBoard),
          setGithubStatusMapping: vi.fn(),
          clearGithubStatusMapping: vi.fn(),
        },
      };
      registerHandlers(queries);

      const handler = handlers.get('github:check-project-readiness');
      if (!handler) throw new Error('handler not registered');

      await handler(undefined, { projectId: 'project-1' });

      expect(queries.projects.clearGithubStatusMapping).toHaveBeenCalledWith('project-1');
      expect(queries.projects.setGithubStatusMapping).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // github:list-comments – cache and in-flight deduplication branches
  // ---------------------------------------------------------------------------

  describe('github:list-comments – caching paths', () => {
    it('returns cached comments when within TTL and force is false', async () => {
      const cachedComments = [{ id: 1, body: 'Comment 1', author: 'alice', createdAt: '' }];
      listIssueCommentsMock.mockResolvedValue(cachedComments);

      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries({ getByNumber: vi.fn(() => baseIssue) }),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:list-comments');
      if (!handler) throw new Error('handler not registered');

      // First call populates the cache
      await handler(undefined, { projectId: 'project-1', issueNumber: 42, force: true });
      expect(listIssueCommentsMock).toHaveBeenCalledTimes(1);

      // Second call (force=false, within TTL) should return cache without calling API
      const result = await handler(undefined, { projectId: 'project-1', issueNumber: 42 });
      expect(result).toEqual(cachedComments);
      // Still only called once
      expect(listIssueCommentsMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // github:archive-issue – project or issue missing
  // ---------------------------------------------------------------------------

  describe('github:archive-issue – missing project/issue', () => {
    it('throws when project is missing', async () => {
      const queries = {
        projects: { getById: vi.fn(() => null) },
        githubIssues: buildGithubIssuesQueries(),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:archive-issue');
      if (!handler) throw new Error('handler not registered');

      await expect(
        handler(undefined, { projectId: 'project-1', issueId: 'issue-1', issueNumber: 42 }),
      ).rejects.toThrow('Project project-1 not found');
    });

    it('throws when issue is not in the active issue list', async () => {
      const queries = {
        projects: { getById: vi.fn(() => baseProject) },
        githubIssues: buildGithubIssuesQueries({ list: vi.fn(() => []) }, []),
      };
      registerHandlers(queries);

      const handler = handlers.get('github:archive-issue');
      if (!handler) throw new Error('handler not registered');

      await expect(
        handler(undefined, { projectId: 'project-1', issueId: 'missing', issueNumber: 42 }),
      ).rejects.toThrow('Issue missing not found in project project-1');
    });
  });

  // ---------------------------------------------------------------------------
  // github:refresh-issues – PR feedback TTL cache branch (line 451)
  // When issue.prLastSyncAt is within TTL and force=false, skip PR sync entirely
  // ---------------------------------------------------------------------------

  it('skips PR feedback sync when prLastSyncAt is within TTL and force is false', async () => {
    // The PR feedback TTL branch fires when !force && prLastSyncAt is within 60s TTL.
    // For the refresh to run (not hit the early cache return), the initial list must be
    // stale. We return stale issues on the first list call, then fresh issues (with recent
    // prLastSyncAt) on the second call (cachedAfterIssueSync).
    const staleIssue = {
      ...baseIssue,
      id: 'stale-cache',
      fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    const freshPrSyncIssue = {
      ...baseIssue,
      id: 'fresh-pr-sync',
      issueNumber: 42,
      threadId: 'thread-1',
      prLastSyncAt: new Date().toISOString(), // very recent – within TTL
      fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };

    listAllIssuesMock.mockResolvedValue([]);

    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi
            .fn()
            .mockReturnValueOnce([staleIssue]) // initial cache check → stale, triggers refresh
            .mockReturnValue([freshPrSyncIssue]), // cachedAfterIssueSync
          getByNumber: vi.fn(() => null),
          upsert: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
        },
        [freshPrSyncIssue],
      ),
      issueEdges: { replaceBodyEdges: vi.fn() },
      threads: {
        getById: vi.fn(() => ({
          ...baseThread,
          id: 'thread-1',
          githubPrNumber: 99,
        })),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };
    registerHandlers(queries);

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('handler not registered');

    // force=false with stale initial cache → refresh proceeds; inside flatMap the
    // fresh prLastSyncAt hits the TTL branch and returns [] (no PR sync).
    await expect(refresh(undefined, { projectId: 'project-1', force: false })).resolves.toEqual([
      freshPrSyncIssue,
    ]);

    // setIssueLabelPresence must NOT be called – PR sync was skipped via TTL
    expect(setIssueLabelPresenceMock).not.toHaveBeenCalled();
  });
});
