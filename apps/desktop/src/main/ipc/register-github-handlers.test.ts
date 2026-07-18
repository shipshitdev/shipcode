import { createGhSyncService } from '@shipcode/pipeline';
import type { PrdMetadataFields } from '@shipcode/shared';
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

const PRD_METADATA_FIXTURE = {
  estimatedComplexity: 'medium',
  blastRadius: 'contained',
} satisfies PrdMetadataFields;

const {
  closeIssueMock,
  createIssueMock,
  editIssueMock,
  getIssueMock,
  applyIssueLabelActionsMock,
  getRepoMetadataMock,
  reopenIssueMock,
  listAllIssuesMock,
  fetchProjectPrioritiesMock,
  fetchProjectStatusesMock,
  validateProjectStatusFieldMock,
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
} = vi.hoisted(() => ({
  closeIssueMock: vi.fn(),
  createIssueMock: vi.fn(),
  editIssueMock: vi.fn(),
  getIssueMock: vi.fn(),
  applyIssueLabelActionsMock: vi.fn(
    async (): Promise<{ added: string[]; removed: string[]; skipped: string[] }> => ({
      added: [],
      removed: [],
      skipped: [],
    }),
  ),
  getRepoMetadataMock: vi.fn(),
  reopenIssueMock: vi.fn(),
  listAllIssuesMock: vi.fn(async () => [] as Array<unknown>),
  fetchProjectPrioritiesMock: vi.fn(),
  fetchProjectStatusesMock: vi.fn(),
  validateProjectStatusFieldMock: vi.fn(),
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
  ensureLabelsMock: vi.fn(
    async (): Promise<{
      created: string[];
      alreadyPresent: string[];
      failed: Array<{ name: string; error: string }>;
    }> => ({
      created: [],
      alreadyPresent: [],
      failed: [],
    }),
  ),
}));

vi.mock('@shipcode/agents', async () => {
  const actual = await vi.importActual<typeof import('@shipcode/agents')>('@shipcode/agents');
  class MockGhCli {
    closeIssue = closeIssueMock;
    createIssue = createIssueMock;
    editIssue = editIssueMock;
    getIssue = getIssueMock;
    applyIssueLabelActions = applyIssueLabelActionsMock;
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
    validateProjectStatusField: validateProjectStatusFieldMock,
    checkProjectReadiness: checkProjectReadinessMock,
    triageGitHubIssues: triageGitHubIssuesMock,
    enhancePrdDraft: enhancePrdDraftMock,
    checkCliModelCapabilities: checkCliModelCapabilitiesMock,
  };
});

describe('registerGitHubHandlers', () => {
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
    path: '/tmp/project',
    gitRemote: 'https://github.com/acme/repo.git',
    githubProjectUrl: null,
    githubStatusMapping: null,
    defaultBranch: 'main',
  };

  const baseIssue = {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue title',
    body: 'Issue body',
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
    requireApprovalOverride: null,
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
  };

  const reusableThread = {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Old title',
    prompt: 'Old prompt',
    status: 'failed',
    kind: 'pipeline' as const,
    worktreeBranch: 'ship/42-issue-title',
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
    forkPointSha: 'sha123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'acme/repo',
    automationId: null,
    lastError: 'Verification commands failed after 2 attempt(s).',
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

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    closeIssueMock.mockReset();
    createIssueMock.mockReset();
    createIssueMock.mockResolvedValue({
      number: 42,
      title: 'Issue title',
      body: 'Issue body',
      labels: [],
      assignee: null,
      state: 'open',
      url: 'https://github.com/acme/repo/issues/42',
    });
    editIssueMock.mockReset();
    editIssueMock.mockResolvedValue(undefined);
    getIssueMock.mockReset();
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Issue title',
      body: 'Issue body',
      labels: [],
      assignee: null,
      state: 'open',
      author: null,
    });
    getRepoMetadataMock.mockReset();
    getRepoMetadataMock.mockResolvedValue({
      githubRepoId: 'repo-1',
      githubRepoFullName: 'acme/repo',
      githubProjectUrl: null,
    });
    reopenIssueMock.mockReset();
    listAllIssuesMock.mockReset();
    listAllIssuesMock.mockImplementation(async () => []);
    fetchProjectPrioritiesMock.mockReset();
    fetchProjectPrioritiesMock.mockResolvedValue({
      priorities: new Map(),
      issueTypes: new Map(),
      archivedIssueNumbers: new Set(),
    });
    fetchProjectStatusesMock.mockReset();
    fetchProjectStatusesMock.mockResolvedValue(new Map());
    validateProjectStatusFieldMock.mockReset();
    validateProjectStatusFieldMock.mockResolvedValue({
      ok: false,
      reason: 'No project configured',
      availableOptions: [],
      mapping: null,
    });
    triageGitHubIssuesMock.mockReset();
    triageGitHubIssuesMock.mockResolvedValue({
      provider: 'openrouter',
      modelId: 'openrouter/auto',
      resolvedModel: 'openrouter/auto',
      recommendations: [],
    });
    enhancePrdDraftMock.mockReset();
    enhancePrdDraftMock.mockResolvedValue({ body: 'Enhanced PRD' });
    checkCliModelCapabilitiesMock.mockReset();
    checkCliModelCapabilitiesMock.mockResolvedValue({
      claude: {
        provider: 'claude',
        source: 'catalog',
        checkedAt: new Date().toISOString(),
        error: null,
        models: [
          {
            value: 'claude-sonnet-4-5',
            label: 'Claude Sonnet 4.5',
            description: null,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: ['low', 'medium', 'high'],
          },
        ],
      },
      codex: {
        provider: 'codex',
        source: 'catalog',
        checkedAt: new Date().toISOString(),
        error: null,
        models: [
          {
            value: 'gpt-5.2',
            label: 'GPT-5.2',
            description: null,
            defaultReasoningEffort: 'high',
            supportedReasoningEfforts: ['low', 'medium', 'high'],
          },
        ],
      },
      gemini: {
        provider: 'gemini',
        source: 'catalog',
        checkedAt: new Date().toISOString(),
        error: null,
        models: [],
      },
    });
    archiveProjectItemsMock.mockReset();
    archiveProjectItemsMock.mockResolvedValue(undefined);
    addIssueCommentMock.mockReset();
    addIssueCommentMock.mockResolvedValue(undefined);
    listIssueCommentsMock.mockReset();
    listIssueCommentsMock.mockResolvedValue([]);
    listRepoLabelsWithMetaMock.mockReset();
    listRepoLabelsWithMetaMock.mockResolvedValue([]);
    addIssueToProjectMock.mockReset();
    addIssueToProjectMock.mockResolvedValue({ alreadyPresent: false });
    setIssueLabelPresenceMock.mockReset();
    setIssueLabelPresenceMock.mockResolvedValue(undefined);
    setIssueProjectMetadataMock.mockReset();
    setIssueProjectMetadataMock.mockResolvedValue([]);
    syncIssueLabelsMock.mockReset();
    syncIssueLabelsMock.mockResolvedValue(undefined);
    ensureLabelsMock.mockReset();
    ensureLabelsMock.mockResolvedValue({
      created: [],
      alreadyPresent: [],
      failed: [],
    });
    checkProjectReadinessMock.mockReset();
    checkProjectReadinessMock.mockResolvedValue({
      ok: true,
      items: [],
      labelSync: { created: [], alreadyPresent: [], failed: [] },
      statusMapping: null,
    });
  });

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
      ...overrides,
    };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('returns cached GitHub issues for simple read handlers', () => {
    const issue = { ...baseIssue, issueNumber: 7, title: 'Seven' };
    const queries = {
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => issue),
        },
        [issue],
      ),
    };

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

    const getIssue = handlers.get('github:get-issue');
    const listIssues = handlers.get('github:list-issues');
    if (!getIssue || !listIssues) throw new Error('read handlers not registered');

    expect(getIssue(undefined, { projectId: 'project-1', issueNumber: 7 })).toBe(issue);
    expect(listIssues(undefined, { projectId: 'project-1' })).toEqual([issue]);
    expect(queries.githubIssues.getByNumber).toHaveBeenCalledWith('project-1', 7);
    expect(queries.githubIssues.list).toHaveBeenCalledWith('project-1');
  });

  it('updates issue metadata only after GitHub accepts the change', async () => {
    const issue = { ...baseIssue, id: 'issue-42', issueNumber: 42, isQuickMode: false };
    const queries = {
      projects: {
        getById: vi.fn(() => ({
          ...baseProject,
          path: '/tmp/project',
          githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
        })),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => issue),
          setIssueType: vi.fn(),
          setPriority: vi.fn(),
        },
        [issue],
      ),
    };

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

    const updateMetadata = handlers.get('github:update-issue-metadata');
    if (!updateMetadata) throw new Error('github:update-issue-metadata handler not registered');

    await expect(
      updateMetadata(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        issueType: 'Feature',
        priority: 'P1',
      }),
    ).resolves.toBe(issue);

    expect(setIssueProjectMetadataMock).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: {
        issueType: 'Feature',
        priority: 'P1',
      },
    });
    expect(queries.githubIssues.setIssueType).toHaveBeenCalledWith({
      id: 'issue-42',
      issueType: 'Feature',
    });
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-42', rank: 'p1', raw: 'P1' }),
    );
  });

  it('rejects issue metadata updates when GitHub reports metadata warnings', async () => {
    const issue = { ...baseIssue, id: 'issue-42', issueNumber: 42, isQuickMode: false };
    setIssueProjectMetadataMock.mockResolvedValueOnce(['#42: issue type "Enhancement" not found']);
    const queries = {
      projects: {
        getById: vi.fn(() => ({
          ...baseProject,
          path: '/tmp/project',
          githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
        })),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => issue),
          setIssueType: vi.fn(),
          setPriority: vi.fn(),
        },
        [issue],
      ),
    };

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

    const updateMetadata = handlers.get('github:update-issue-metadata');
    if (!updateMetadata) throw new Error('github:update-issue-metadata handler not registered');

    await expect(
      updateMetadata(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        issueType: 'Enhancement',
      }),
    ).rejects.toThrow('#42: issue type "Enhancement" not found');

    expect(queries.githubIssues.setIssueType).not.toHaveBeenCalled();
    expect(queries.githubIssues.setPriority).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(
      'github:issues-updated',
      expect.objectContaining({ projectId: 'project-1' }),
    );
  });

  it('refreshes issues from GitHub, syncs board metadata, archives board-archived issues, and broadcasts', async () => {
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo', optionId: 'todo-id' },
        inProgress: { name: 'In Progress', optionId: 'progress-id' },
        humanReview: { name: 'Human Review', optionId: 'review-id' },
        deferred: { name: 'Deferred', optionId: 'deferred-id' },
        done: { name: 'Done', optionId: 'done-id' },
      },
    };
    const openRecord = {
      ...baseIssue,
      id: 'issue-open',
      issueNumber: 42,
      state: 'open',
      pipelineStatus: 'todo',
      threadId: null,
    };
    const closedRecord = {
      ...baseIssue,
      id: 'issue-closed',
      issueNumber: 43,
      state: 'closed',
      pipelineStatus: 'todo',
      threadId: null,
    };
    const cachedAfterSync = [openRecord, closedRecord];
    listAllIssuesMock.mockResolvedValue([
      {
        number: 42,
        title: 'Open issue',
        body: 'Open body',
        labels: ['bug'],
        assignee: null,
        state: 'open',
        updatedAt: '2026-05-08T00:00:00.000Z',
        url: 'https://github.com/acme/repo/issues/42',
      },
      {
        number: 43,
        title: 'Closed issue',
        body: 'Closed body',
        labels: [],
        assignee: null,
        state: 'closed',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/43',
      },
    ]);
    fetchProjectPrioritiesMock.mockResolvedValue({
      priorities: new Map([[42, { rank: 'p1', raw: 'P1' }]]),
      issueTypes: new Map(),
      archivedIssueNumbers: new Set([43]),
    });
    fetchProjectStatusesMock.mockResolvedValue(new Map([[42, { raw: 'In Progress' }]]));
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue(cachedAfterSync),
          getByNumber: vi.fn((_projectId: string, issueNumber: number) =>
            issueNumber === 43 ? closedRecord : null,
          ),
          upsert: vi.fn((input: { issueNumber: number }) =>
            input.issueNumber === 42 ? openRecord : closedRecord,
          ),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
          archiveIssues: vi.fn(),
          resetStaleApproval: vi.fn(() => 1),
        },
        cachedAfterSync,
      ),
      issueEdges: {
        replaceBodyEdges: vi.fn(),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await expect(refresh(undefined, { projectId: 'project-1', force: true })).resolves.toEqual(
      cachedAfterSync,
    );

    expect(queries.projects.updateGithubRepoIdentity).toHaveBeenCalledWith('project-1', {
      githubRepoId: 'repo-1',
      githubRepoFullName: 'acme/repo',
    });
    expect(queries.githubIssues.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 42, updatedAt: '2026-05-08T00:00:00.000Z' }),
    );
    expect(queries.githubIssues.markClosedOnClose).toHaveBeenCalledWith('issue-closed');
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-open', 'open');
    expect(addIssueToProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueUrl: 'https://github.com/acme/repo/issues/42' }),
    );
    expect(queries.githubIssues.resetStaleApproval).toHaveBeenCalledWith('project-1');
    expect(fetchProjectPrioritiesMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectUrl: projectWithBoard.githubProjectUrl }),
    );
    expect(fetchProjectStatusesMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectUrl: projectWithBoard.githubProjectUrl }),
    );
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-open', rank: 'p1', raw: 'P1' }),
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-open', 'queued');
    expect(queries.githubIssues.archiveIssues).toHaveBeenCalledWith(['issue-closed']);
    expect(queries.issueEdges.replaceBodyEdges).toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: cachedAfterSync,
    });
  });

  it('probes repo metadata at most once per session for a board-less repo', async () => {
    // Identity already resolved, but no associated Projects-v2 board (URL stays null).
    const noBoardProject = {
      ...baseProject,
      id: 'project-noboard',
      path: '/tmp',
      githubRepoFullName: 'acme/repo',
      githubProjectUrl: null,
    };
    const queries = {
      projects: {
        getById: vi.fn(() => noBoardProject),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => []),
          getByNumber: vi.fn(() => null),
          upsert: vi.fn(),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
          archiveIssues: vi.fn(),
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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await refresh(undefined, { projectId: 'project-noboard', force: true });
    await refresh(undefined, { projectId: 'project-noboard', force: true });

    // Metadata is probed once; the session negative-cache suppresses the second (and
    // every subsequent) probe so board-less repos don't re-run `gh repo view` forever.
    expect(getRepoMetadataMock).toHaveBeenCalledTimes(1);
  });

  it('refresh keeps terminal local thread state ahead of stale active pipeline labels', async () => {
    const failedThreadIssue = {
      ...baseIssue,
      id: 'issue-failed-thread',
      issueNumber: 50,
      labels: ['shipcode:pipeline:planning'],
      pipelineStatus: 'planning',
      threadId: 'thread-failed',
    };
    const staleQueuedLabelIssue = {
      ...baseIssue,
      id: 'issue-stale-queued-label',
      issueNumber: 60,
      labels: ['shipcode:pipeline:queued'],
      pipelineStatus: 'todo',
      threadId: null,
    };
    const staleExecutingNoThreadIssue = {
      ...baseIssue,
      id: 'issue-stale-executing-no-thread',
      issueNumber: 62,
      labels: ['shipcode:pipeline:queued', 'shipcode:pipeline:executing'],
      pipelineStatus: 'executing',
      threadId: null,
    };
    const liveQueuedIssue = {
      ...baseIssue,
      id: 'issue-live-queued',
      issueNumber: 61,
      labels: ['shipcode:pipeline:queued'],
      pipelineStatus: 'queued',
      threadId: null,
    };
    const cachedAfterSync = [
      failedThreadIssue,
      staleQueuedLabelIssue,
      staleExecutingNoThreadIssue,
      liveQueuedIssue,
    ];

    listAllIssuesMock.mockResolvedValue([
      {
        number: 50,
        title: failedThreadIssue.title,
        body: failedThreadIssue.body,
        labels: failedThreadIssue.labels,
        assignee: null,
        state: 'open',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/50',
      },
      {
        number: 60,
        title: staleQueuedLabelIssue.title,
        body: staleQueuedLabelIssue.body,
        labels: staleQueuedLabelIssue.labels,
        assignee: null,
        state: 'open',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/60',
      },
      {
        number: 61,
        title: liveQueuedIssue.title,
        body: liveQueuedIssue.body,
        labels: liveQueuedIssue.labels,
        assignee: null,
        state: 'open',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/61',
      },
      {
        number: 62,
        title: staleExecutingNoThreadIssue.title,
        body: staleExecutingNoThreadIssue.body,
        labels: staleExecutingNoThreadIssue.labels,
        assignee: null,
        state: 'open',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/62',
      },
    ]);
    getIssueMock.mockImplementation(async (issueNumber: number) => {
      const issue = cachedAfterSync.find((candidate) => candidate.issueNumber === issueNumber);
      return {
        number: issueNumber,
        title: issue?.title ?? 'Issue title',
        body: issue?.body ?? 'Issue body',
        labels: issue?.labels ?? [],
        assignee: null,
        state: 'open',
        author: null,
      };
    });

    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue(cachedAfterSync),
          getByNumber: vi.fn(
            (_projectId: string, issueNumber: number) =>
              cachedAfterSync.find((issue) => issue.issueNumber === issueNumber) ?? null,
          ),
          upsert: vi.fn((input: { issueNumber: number }) =>
            cachedAfterSync.find((issue) => issue.issueNumber === input.issueNumber),
          ),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
          updatePipelineStatus: vi.fn(),
        },
        cachedAfterSync,
      ),
      issueEdges: {
        replaceBodyEdges: vi.fn(),
      },
      threads: {
        getById: vi.fn((threadId: string) =>
          threadId === 'thread-failed'
            ? { ...baseIssue, id: 'thread-failed', projectId: 'project-1', status: 'failed' }
            : null,
        ),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

    const ghSync = createGhSyncService({
      getProject: () => queries.projects.getById() as never,
    }).deps;

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      ghSync,
    });

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await refresh(undefined, { projectId: 'project-1', force: true });

    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-failed-thread',
      'failed',
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-stale-queued-label',
      'queued',
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-stale-executing-no-thread',
      'executing',
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-live-queued',
      'queued',
    );
    expect(queries.githubIssues.clearThread).not.toHaveBeenCalledWith('issue-failed-thread');
    expect(queries.githubIssues.linkThread).not.toHaveBeenCalledWith(
      'issue-failed-thread',
      'thread-failed',
    );
    await vi.waitFor(() => {
      expect(setIssueLabelPresenceMock).toHaveBeenCalledWith(
        50,
        'shipcode:pipeline:planning',
        false,
      );
      expect(setIssueLabelPresenceMock).toHaveBeenCalledWith(50, 'shipcode:pipeline:failed', true);
      expect(setIssueLabelPresenceMock).toHaveBeenCalledWith(62, 'shipcode:pipeline:queued', false);
    });
    expect(setIssueLabelPresenceMock).not.toHaveBeenCalledWith(
      60,
      'shipcode:pipeline:queued',
      false,
    );
    expect(setIssueLabelPresenceMock).not.toHaveBeenCalledWith(
      61,
      'shipcode:pipeline:queued',
      false,
    );
  });

  it('serializes new issue project board attachments during refresh', async () => {
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };
    const firstRecord = { ...baseIssue, id: 'issue-41', issueNumber: 41, threadId: null };
    const secondRecord = { ...baseIssue, id: 'issue-42', issueNumber: 42, threadId: null };
    const cachedAfterSync = [firstRecord, secondRecord];
    const firstAttach = deferred<{ alreadyPresent: boolean }>();
    const secondAttach = deferred<{ alreadyPresent: boolean }>();

    listAllIssuesMock.mockResolvedValue([
      {
        number: 41,
        title: 'First',
        body: 'First body',
        labels: [],
        assignee: null,
        state: 'open',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/41',
      },
      {
        number: 42,
        title: 'Second',
        body: 'Second body',
        labels: [],
        assignee: null,
        state: 'open',
        updatedAt: null,
        url: 'https://github.com/acme/repo/issues/42',
      },
    ]);
    addIssueToProjectMock
      .mockReturnValueOnce(firstAttach.promise)
      .mockReturnValueOnce(secondAttach.promise);

    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue(cachedAfterSync),
          getByNumber: vi.fn(() => null),
          upsert: vi.fn((input: { issueNumber: number }) =>
            input.issueNumber === 41 ? firstRecord : secondRecord,
          ),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
          archiveIssues: vi.fn(),
        },
        cachedAfterSync,
      ),
      issueEdges: {
        replaceBodyEdges: vi.fn(),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    const result = refresh(undefined, { projectId: 'project-1', force: true }) as Promise<unknown>;

    await vi.waitFor(() => expect(addIssueToProjectMock).toHaveBeenCalledTimes(2));
    firstAttach.resolve({ alreadyPresent: false });
    secondAttach.resolve({ alreadyPresent: false });
    await expect(result).resolves.toEqual(cachedAfterSync);
  });

  it('refresh maps GitHub board statuses for todo, deferred, done, and ignored columns', async () => {
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo', optionId: 'todo-id' },
        inProgress: { name: 'In Progress', optionId: 'progress-id' },
        humanReview: { name: 'Human Review', optionId: 'review-id' },
        deferred: { name: 'Deferred', optionId: 'deferred-id' },
        done: { name: 'Done', optionId: 'done-id' },
      },
    };
    const todoIssue = { ...baseIssue, id: 'todo', issueNumber: 10, pipelineStatus: 'closed' };
    const deferredIssue = { ...baseIssue, id: 'deferred', issueNumber: 11, pipelineStatus: 'todo' };
    const doneIssue = { ...baseIssue, id: 'done', issueNumber: 12, pipelineStatus: 'todo' };
    const reviewIssue = { ...baseIssue, id: 'review', issueNumber: 13, pipelineStatus: 'todo' };
    const activeIssue = {
      ...baseIssue,
      id: 'active',
      issueNumber: 14,
      pipelineStatus: 'executing',
    };
    const labeledIssue = {
      ...baseIssue,
      id: 'labeled',
      issueNumber: 15,
      labels: ['shipcode:pipeline:failed'],
      pipelineStatus: 'failed',
    };
    const quickIssue = {
      ...baseIssue,
      id: 'quick',
      issueNumber: -15,
      pipelineStatus: 'todo',
      isQuickMode: true,
    };
    const cachedAfterSync = [
      todoIssue,
      deferredIssue,
      doneIssue,
      reviewIssue,
      activeIssue,
      labeledIssue,
      quickIssue,
    ];
    listAllIssuesMock.mockResolvedValue([]);
    fetchProjectStatusesMock.mockResolvedValue(
      new Map([
        [10, { raw: 'Todo' }],
        [11, { raw: 'Deferred' }],
        [12, { raw: 'Done' }],
        [13, { raw: 'Human Review' }],
        [14, { raw: 'Done' }],
        [15, { raw: 'In Progress' }],
        [-15, { raw: 'Done' }],
      ]),
    );
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue(cachedAfterSync),
          getByNumber: vi.fn(() => null),
          upsert: vi.fn(),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
          archiveIssues: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
          updatePipelineStatus: vi.fn(),
        },
        cachedAfterSync,
      ),
      issueEdges: {
        replaceBodyEdges: vi.fn(),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await refresh(undefined, { projectId: 'project-1', force: true });

    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('todo', 'todo');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('deferred', 'deferred');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('done', 'closed');
    expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalledWith('review', null);
    expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalledWith('active', 'closed');
    expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalledWith('labeled', 'queued');
    expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalledWith('quick', 'closed');
  });

  it('rejects refresh when the project is missing or the repo path is gone', async () => {
    const queries = {
      projects: {
        getById: vi
          .fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce({ ...baseProject, path: '/tmp/shipcode-missing-path' }),
      },
      githubIssues: buildGithubIssuesQueries({}, []),
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await expect(refresh(undefined, { projectId: 'project-1', force: true })).rejects.toThrow(
      'Project project-1 not found',
    );
    await expect(refresh(undefined, { projectId: 'project-1', force: true })).rejects.toThrow(
      'Project path no longer exists: /tmp/shipcode-missing-path',
    );
  });

  it('dedupes concurrent issue refreshes and serves fresh cache hits', async () => {
    const freshIssue = { ...baseIssue, fetchedAt: new Date().toISOString() };
    const queries = {
      githubIssues: buildGithubIssuesQueries({}, [freshIssue]),
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await expect(refresh(undefined, { projectId: 'project-1' })).resolves.toEqual([freshIssue]);
    expect(listAllIssuesMock).not.toHaveBeenCalled();
  });

  it('uses the newest fetched timestamp when deciding refresh cache freshness', async () => {
    const olderIssue = {
      ...baseIssue,
      id: 'older',
      fetchedAt: new Date(Date.now() - 1_000).toISOString(),
    };
    const newerIssue = { ...baseIssue, id: 'newer', fetchedAt: new Date().toISOString() };
    const queries = {
      githubIssues: buildGithubIssuesQueries({}, [olderIssue, newerIssue, olderIssue]),
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await expect(refresh(undefined, { projectId: 'project-1' })).resolves.toEqual([
      olderIssue,
      newerIssue,
      olderIssue,
    ]);
    expect(listAllIssuesMock).not.toHaveBeenCalled();
  });

  it('dedupes in-flight issue refreshes for the same project', async () => {
    const listed = deferred<Array<unknown>>();
    const refreshedIssue = { ...baseIssue, fetchedAt: new Date().toISOString() };
    listAllIssuesMock.mockReturnValue(listed.promise);
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubRepoFullName: 'acme/repo' })),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([refreshedIssue]),
          upsert: vi.fn(),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
        },
        [refreshedIssue],
      ),
      issueEdges: {
        replaceBodyEdges: vi.fn(),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    const first = refresh(undefined, { projectId: 'project-1', force: true });
    const second = refresh(undefined, { projectId: 'project-1', force: true });
    listed.resolve([]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [refreshedIssue],
      [refreshedIssue],
    ]);
    expect(listAllIssuesMock).toHaveBeenCalledTimes(1);
  });

  it('continues refresh when repo identity, priority, and status sync helpers warn or fail', async () => {
    const issue = {
      ...baseIssue,
      id: 'issue-refresh-warning',
      fetchedAt: new Date().toISOString(),
      pipelineStatus: 'todo',
      threadId: null,
    };
    getRepoMetadataMock.mockRejectedValue(new Error('metadata failed'));
    fetchProjectPrioritiesMock.mockImplementation(async ({ onWarn }) => {
      onWarn?.('priority warning', new Error('priority warning'));
      return {
        priorities: new Map(),
        issueTypes: new Map(),
        archivedIssueNumbers: new Set(),
      };
    });
    fetchProjectStatusesMock.mockImplementation(async ({ onWarn }) => {
      onWarn?.('status warning', new Error('status warning'));
      throw new Error('status failed');
    });
    listAllIssuesMock.mockResolvedValue([]);
    const queries = {
      projects: {
        getById: vi.fn(() => ({
          ...baseProject,
          path: '/tmp',
          githubRepoFullName: null,
          githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
          githubStatusMapping: {
            todo: { name: 'Todo', optionId: 'todo-id' },
            inProgress: { name: 'In Progress', optionId: 'progress-id' },
            humanReview: { name: 'Human Review', optionId: 'review-id' },
            deferred: { name: 'Deferred', optionId: 'deferred-id' },
            done: { name: 'Done', optionId: 'done-id' },
          },
        })),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([issue]),
          upsert: vi.fn(),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
          resetStaleApproval: vi.fn(() => 0),
        },
        [issue],
      ),
      issueEdges: {
        replaceBodyEdges: vi.fn(),
      },
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const refresh = handlers.get('github:refresh-issues');
    if (!refresh) throw new Error('github:refresh-issues handler not registered');

    await expect(refresh(undefined, { projectId: 'project-1', force: true })).resolves.toEqual([
      issue,
    ]);
    expect(queries.projects.updateGithubRepoIdentity).not.toHaveBeenCalled();
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: issue.id, rank: null, raw: null }),
    );
  });

  it('reuses the existing issue thread and worktree on github:start-issue', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn(() => baseIssue),
        updatePipelineStatus: vi.fn(),
        linkThread: vi.fn(),
        list: vi.fn(() => [baseIssue]),
      },
      threads: {
        getById: vi.fn(() => reusableThread),
        getByProjectAndGithubIssue: vi.fn(() => reusableThread),
        create: vi.fn(),
        updateIssueContent: vi.fn(),
        setGithubIssue: vi.fn(),
        setPhaseModels: vi.fn(),
        resetFailureTracking: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({
          maxConcurrentPipelines: 2,
          plannerModel: 'claude',
          reviewerModel: 'claude',
          verifierModel: 'claude',
          executorModel: 'claude',
        })),
      },
      plans: {
        supersedeAll: vi.fn(),
        supersedeAllForIssue: vi.fn(),
      },
    };

    const pipeline = {
      listActive: vi.fn(() => []),
      startFromGitHubIssue: vi.fn(async () => undefined),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const startIssue = handlers.get('github:start-issue');
    if (!startIssue) throw new Error('github:start-issue handler not registered');
    await startIssue(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(queries.threads.create).not.toHaveBeenCalled();
    expect(queries.threads.updateIssueContent).toHaveBeenCalledWith(
      reusableThread.id,
      'Issue body',
      'Issue title',
    );
    expect(queries.plans.supersedeAll).toHaveBeenCalledWith(reusableThread.id);
    expect(pipeline.startFromGitHubIssue).toHaveBeenCalledWith(
      reusableThread.id,
      baseProject.path,
      expect.objectContaining({ number: 42, title: 'Issue title' }),
      expect.any(String),
      expect.objectContaining({
        worktreePath: reusableThread.worktreePath,
      }),
    );
  });

  it('routes quick tasks through the quick-task scheduler path', async () => {
    const { PipelineScheduler } = await import('../pipeline-scheduler');
    const startQuickTaskOrQueue = vi
      .spyOn(PipelineScheduler.prototype, 'startQuickTaskOrQueue')
      .mockResolvedValueOnce({ queued: false });
    const quickIssue = { ...baseIssue, issueNumber: -1, isQuickMode: true };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn(() => quickIssue),
      },
    };

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

    const startIssue = handlers.get('github:start-issue');
    if (!startIssue) throw new Error('github:start-issue handler not registered');

    await startIssue(undefined, { projectId: 'project-1', issueNumber: -1 });

    expect(startQuickTaskOrQueue).toHaveBeenCalledWith('project-1', -1);
    startQuickTaskOrQueue.mockRestore();
  });

  it('rejects start issue when the project or issue cache record is missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn(() => null),
      },
    };
    const pipeline = {
      listActive: vi.fn(() => []),
      listActiveInPhases: vi.fn(() => []),
      startFromGitHubIssue: vi.fn(),
      startFromQuickTask: vi.fn(),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const startIssue = handlers.get('github:start-issue');
    if (!startIssue) throw new Error('github:start-issue handler not registered');

    await expect(
      startIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      startIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Issue #42 not found in cache');
    expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
  });

  it('clears all issue phase overrides for a project and broadcasts fresh issue data', async () => {
    const refreshedIssues = [{ ...baseIssue, plannerModelOverride: null }];
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        clearAllPhaseOverridesForProject: vi.fn(() => 3),
        list: vi.fn(() => refreshedIssues),
      },
    };

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

    const clearOverrides = handlers.get('github:clear-all-phase-overrides-for-project');
    if (!clearOverrides) {
      throw new Error('github:clear-all-phase-overrides-for-project handler not registered');
    }

    expect(
      clearOverrides(undefined, {
        projectId: 'project-1',
      }),
    ).toEqual({ clearedCount: 3 });

    expect(queries.githubIssues.clearAllPhaseOverridesForProject).toHaveBeenCalledWith('project-1');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: refreshedIssues,
    });
  });

  it('rejects clearing all phase overrides when the project is missing', () => {
    const queries = {
      projects: {
        getById: vi.fn(() => null),
      },
      githubIssues: {
        clearAllPhaseOverridesForProject: vi.fn(),
        list: vi.fn(() => []),
      },
    };

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

    const clearOverrides = handlers.get('github:clear-all-phase-overrides-for-project');
    if (!clearOverrides) {
      throw new Error('github:clear-all-phase-overrides-for-project handler not registered');
    }

    expect(() => clearOverrides(undefined, { projectId: 'project-1' })).toThrow(
      'Project project-1 not found',
    );
    expect(queries.githubIssues.clearAllPhaseOverridesForProject).not.toHaveBeenCalled();
  });

  it('updates an issue-specific human approval override and returns the refreshed issue', () => {
    const refreshedIssue = { ...baseIssue, requireApprovalOverride: true };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn((_projectId: string, issueNumber: number) =>
          issueNumber === 42 ? refreshedIssue : null,
        ),
        updateRequireApprovalOverride: vi.fn(),
        list: vi.fn(() => [refreshedIssue]),
      },
    };

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

    const setApprovalOverride = handlers.get('github:set-require-approval-override');
    if (!setApprovalOverride) {
      throw new Error('github:set-require-approval-override handler not registered');
    }

    expect(
      setApprovalOverride(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        requireApproval: true,
      }),
    ).toEqual(refreshedIssue);

    expect(queries.githubIssues.updateRequireApprovalOverride).toHaveBeenCalledWith(
      'issue-1',
      true,
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [refreshedIssue],
    });
  });

  it('reopens a closed issue and restores approval from the linked thread state', async () => {
    const closedIssue = {
      ...baseIssue,
      state: 'closed',
      pipelineStatus: 'closed',
      threadId: reusableThread.id,
    };
    const restoredIssue = {
      ...closedIssue,
      state: 'open',
      pipelineStatus: 'approval',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn().mockReturnValueOnce(closedIssue).mockReturnValue(restoredIssue),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
        },
        [restoredIssue],
      ),
      threads: {
        getById: vi.fn(() => ({ ...reusableThread, status: 'approval' })),
        getByProjectAndGithubIssue: vi.fn(() => ({
          ...reusableThread,
          status: 'approval',
        })),
      },
    };

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

    const reopenIssue = handlers.get('github:reopen-issue');
    if (!reopenIssue) throw new Error('github:reopen-issue handler not registered');

    await reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(reopenIssueMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith(closedIssue.id, 'open');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      closedIssue.id,
      'approval',
    );
    expect(queries.githubIssues.clearArchivedAt).toHaveBeenCalledWith(closedIssue.id);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [restoredIssue],
    });
  });

  it('closes a quick/local issue without calling GitHub', async () => {
    const quickIssue = {
      ...baseIssue,
      id: 'quick-1',
      issueNumber: -236024417,
      isQuickMode: true,
      state: 'open',
      pipelineStatus: 'completed',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => [quickIssue]),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
        },
        [quickIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('issue:mark-done');
    if (!markDone) throw new Error('issue:mark-done handler not registered');

    await markDone(undefined, {
      projectId: 'project-1',
      issueId: quickIssue.id,
      issueNumber: quickIssue.issueNumber,
    });

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateState).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(quickIssue.id, 'closed');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [quickIssue],
    });
  });

  it('marks a GitHub issue completed without closing it when PR evidence exists', async () => {
    const issueWithPr = {
      ...baseIssue,
      linkedPrNumber: 123,
      state: 'open',
      pipelineStatus: 'todo',
      threadId: reusableThread.id,
    };
    const refreshedIssues = [
      {
        ...issueWithPr,
        pipelineStatus: 'completed',
      },
    ];
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => issueWithPr),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
        },
        refreshedIssues,
      ),
      threads: {
        getById: vi.fn(() => ({ ...reusableThread, status: 'completed' })),
        getByProjectAndGithubIssue: vi.fn(() => reusableThread),
      },
    };

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

    const markDone = handlers.get('github:mark-done');
    if (!markDone) throw new Error('github:mark-done handler not registered');

    await markDone(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith(issueWithPr.id, 'open');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      issueWithPr.id,
      'completed',
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: refreshedIssues,
    });
  });

  it('closes an automation issue by updating the backing thread only', async () => {
    const markDoneThread = vi.fn();
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
        },
        [],
      ),
      threads: {
        markDone: markDoneThread,
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('issue:mark-done');
    if (!markDone) throw new Error('issue:mark-done handler not registered');

    await markDone(undefined, {
      projectId: 'project-1',
      issueId: 'automation:thread-auto-1',
      issueNumber: -1_123_456,
    });

    expect(markDoneThread).toHaveBeenCalledWith('thread-auto-1');
    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.getByNumber).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateState).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [],
    });
  });

  it('marks a real issue done by closing it on GitHub and updating local status', async () => {
    const openIssue = {
      ...baseIssue,
      id: 'issue-open',
      state: 'open',
      pipelineStatus: 'todo',
    };
    const refreshedIssues = [{ ...openIssue, state: 'closed', pipelineStatus: 'closed' }];
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi
            .fn(() => [openIssue])
            .mockReturnValueOnce([openIssue])
            .mockReturnValue(refreshedIssues),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
        },
        refreshedIssues,
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('issue:mark-done');
    if (!markDone) throw new Error('issue:mark-done handler not registered');

    await markDone(undefined, {
      projectId: 'project-1',
      issueId: 'issue-open',
      issueNumber: 42,
    });

    expect(closeIssueMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-open', 'closed');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-open', 'closed');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: refreshedIssues,
    });
  });

  it('rejects stale mark-done requests when the issue id no longer matches the issue number', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries({}, [{ ...baseIssue, issueNumber: 43 }]),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('issue:mark-done');
    if (!markDone) throw new Error('issue:mark-done handler not registered');

    await expect(
      markDone(undefined, {
        projectId: 'project-1',
        issueId: 'issue-1',
        issueNumber: 42,
      }),
    ).rejects.toThrow('Issue issue-1 no longer matches #42');
    expect(closeIssueMock).not.toHaveBeenCalled();
  });

  it('rejects mark-done requests when project or issue records are missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => []),
          getByNumber: vi.fn(() => null),
        },
        [],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('issue:mark-done');
    const githubMarkDone = handlers.get('github:mark-done');
    if (!markDone || !githubMarkDone) throw new Error('mark-done handlers not registered');

    await expect(
      markDone(undefined, { projectId: 'project-1', issueId: 'issue-1', issueNumber: 42 }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      markDone(undefined, { projectId: 'project-1', issueId: 'missing', issueNumber: 42 }),
    ).rejects.toThrow('Issue missing not found in project project-1');
    await expect(
      githubMarkDone(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Issue #42 not found in project project-1');
    expect(closeIssueMock).not.toHaveBeenCalled();
  });

  it('rejects github mark-done immediately when the project is missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => null),
      },
      githubIssues: buildGithubIssuesQueries(),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('github:mark-done');
    if (!markDone) throw new Error('github:mark-done handler not registered');

    await expect(markDone(undefined, { projectId: 'project-1', issueNumber: 42 })).rejects.toThrow(
      'Project project-1 not found',
    );
    expect(closeIssueMock).not.toHaveBeenCalled();
  });

  it('marks already-closed issues closed locally without closing GitHub again', async () => {
    const closedIssue = {
      ...baseIssue,
      id: 'issue-already-closed',
      state: 'closed',
      pipelineStatus: 'completed',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => closedIssue),
          updateState: vi.fn(),
          updatePipelineStatus: vi.fn(),
        },
        [closedIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('github:mark-done');
    if (!markDone) throw new Error('github:mark-done handler not registered');

    await markDone(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-already-closed', 'closed');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-already-closed',
      'closed',
    );
  });

  it('closes open issues on GitHub when marking done without completion evidence', async () => {
    const openIssue = {
      ...baseIssue,
      id: 'issue-open-no-evidence',
      state: 'open',
      threadId: null,
      linkedPrNumber: null,
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => openIssue),
          updateState: vi.fn(),
          updatePipelineStatus: vi.fn(),
        },
        [openIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const markDone = handlers.get('github:mark-done');
    if (!markDone) throw new Error('github:mark-done handler not registered');

    await markDone(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(closeIssueMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith(
      'issue-open-no-evidence',
      'closed',
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-open-no-evidence',
      'closed',
    );
  });

  it('closes and reopens GitHub issues through explicit handlers', async () => {
    const closedIssue = {
      ...baseIssue,
      id: 'issue-closed',
      state: 'closed',
      pipelineStatus: 'closed',
    };
    const openIssue = { ...baseIssue, id: 'issue-open', state: 'open', pipelineStatus: 'todo' };
    const refreshedIssues = [openIssue];
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn().mockReturnValueOnce(openIssue).mockReturnValueOnce(closedIssue),
          list: vi.fn(() => refreshedIssues),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
        },
        refreshedIssues,
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const closeIssue = handlers.get('github:close-issue');
    const reopenIssue = handlers.get('github:reopen-issue');
    if (!closeIssue || !reopenIssue) throw new Error('close/reopen handlers not registered');

    await closeIssue(undefined, { projectId: 'project-1', issueNumber: 42 });
    await reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(closeIssueMock).toHaveBeenCalledWith(42);
    expect(reopenIssueMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-open', 'closed');
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-closed', 'open');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-open', 'closed');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-closed', 'todo');
    expect(queries.githubIssues.clearArchivedAt).toHaveBeenCalledWith('issue-closed');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: refreshedIssues,
    });
  });

  it('relinks stale issue threads and derives reopened status from canonical evidence', async () => {
    const staleLinkedIssue = {
      ...baseIssue,
      id: 'issue-stale-link',
      state: 'closed',
      threadId: 'missing-thread',
      linkedPrNumber: null,
    };
    const prLinkedIssue = {
      ...baseIssue,
      id: 'issue-pr-link',
      state: 'closed',
      threadId: null,
      linkedPrNumber: 123,
    };
    const canonicalThread = { ...reusableThread, id: 'canonical-thread', status: 'idle' };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi
            .fn()
            .mockReturnValueOnce(staleLinkedIssue)
            .mockReturnValueOnce(staleLinkedIssue)
            .mockReturnValueOnce(prLinkedIssue)
            .mockReturnValueOnce(prLinkedIssue),
          list: vi.fn(() => [staleLinkedIssue, prLinkedIssue]),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          linkThread: vi.fn(),
        },
        [staleLinkedIssue, prLinkedIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi
          .fn()
          .mockReturnValueOnce(canonicalThread)
          .mockReturnValue(null),
      },
    };

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

    const reopenIssue = handlers.get('github:reopen-issue');
    if (!reopenIssue) throw new Error('github:reopen-issue handler not registered');

    await reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 });
    await reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(queries.githubIssues.linkThread).toHaveBeenCalledWith(
      'issue-stale-link',
      'canonical-thread',
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-stale-link',
      'todo',
    );
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-pr-link',
      'completed',
    );
  });

  it('skips redundant GitHub close and reopen calls when issue state already matches', async () => {
    const closedIssue = {
      ...baseIssue,
      id: 'issue-closed',
      state: 'closed',
      pipelineStatus: 'closed',
    };
    const openIssue = { ...baseIssue, id: 'issue-open', state: 'open', pipelineStatus: 'todo' };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn().mockReturnValueOnce(closedIssue).mockReturnValueOnce(openIssue),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
        },
        [openIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const closeIssue = handlers.get('github:close-issue');
    const reopenIssue = handlers.get('github:reopen-issue');
    if (!closeIssue || !reopenIssue) throw new Error('close/reopen handlers not registered');

    await closeIssue(undefined, { projectId: 'project-1', issueNumber: 42 });
    await reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(reopenIssueMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-closed', 'closed');
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-open', 'open');
  });

  it('rejects close and reopen for missing records and quick tasks', async () => {
    const quickIssue = { ...baseIssue, issueNumber: -1_123, isQuickMode: true };
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(baseProject),
      },
      githubIssues: buildGithubIssuesQueries({
        getByNumber: vi.fn().mockReturnValueOnce(null).mockReturnValue(quickIssue),
      }),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const closeIssue = handlers.get('github:close-issue');
    const reopenIssue = handlers.get('github:reopen-issue');
    if (!closeIssue || !reopenIssue) throw new Error('close/reopen handlers not registered');

    await expect(
      closeIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      closeIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Issue #42 not found in project project-1');
    await expect(
      reopenIssue(undefined, { projectId: 'project-1', issueNumber: -1_123 }),
    ).rejects.toThrow('Quick tasks have no GitHub issue');
    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(reopenIssueMock).not.toHaveBeenCalled();
  });

  it('rejects reopen when project or issue records are missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(baseProject),
      },
      githubIssues: buildGithubIssuesQueries({
        getByNumber: vi.fn(() => null),
      }),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const reopenIssue = handlers.get('github:reopen-issue');
    if (!reopenIssue) throw new Error('github:reopen-issue handler not registered');

    await expect(
      reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      reopenIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Issue #42 not found in project project-1');
    expect(reopenIssueMock).not.toHaveBeenCalled();
  });

  it('archives an open GitHub issue by closing it, archiving its project item, and archiving locally', async () => {
    const openIssue = {
      ...baseIssue,
      id: 'issue-open',
      state: 'open',
      pipelineStatus: 'closed',
    };
    const refreshedIssues = [{ ...openIssue, archivedAt: new Date().toISOString() }];
    const archiveIssues = vi.fn();
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi
            .fn(() => [openIssue])
            .mockReturnValueOnce([openIssue])
            .mockReturnValue(refreshedIssues),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
          archiveIssues,
        },
        refreshedIssues,
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveIssue = handlers.get('github:archive-issue');
    if (!archiveIssue) throw new Error('github:archive-issue handler not registered');

    await expect(
      archiveIssue(undefined, {
        projectId: 'project-1',
        issueId: openIssue.id,
        issueNumber: 42,
      }),
    ).resolves.toEqual({ archivedCount: 1 });

    expect(closeIssueMock).toHaveBeenCalledWith(42);
    expect(archiveProjectItemsMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith(openIssue.id, 'closed');
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(openIssue.id, 'closed');
    expect(archiveIssues).toHaveBeenCalledWith([openIssue.id]);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: refreshedIssues,
    });
  });

  it('archives a quick task locally without GitHub calls', async () => {
    const quickIssue = {
      ...baseIssue,
      id: 'quick-1',
      issueNumber: -236024417,
      isQuickMode: true,
      state: 'open',
      pipelineStatus: 'closed',
    };
    const archiveIssues = vi.fn();
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => [quickIssue]),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
          archiveIssues,
        },
        [],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveIssue = handlers.get('github:archive-issue');
    if (!archiveIssue) throw new Error('github:archive-issue handler not registered');

    await archiveIssue(undefined, {
      projectId: 'project-1',
      issueId: quickIssue.id,
      issueNumber: quickIssue.issueNumber,
    });

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(archiveProjectItemsMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateState).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(quickIssue.id, 'closed');
    expect(archiveIssues).toHaveBeenCalledWith([quickIssue.id]);
  });

  it('reports project-board archive failures before local archive mutations', async () => {
    const openIssue = {
      ...baseIssue,
      id: 'issue-open',
      state: 'open',
      pipelineStatus: 'closed',
    };
    archiveProjectItemsMock.mockRejectedValue(new Error('project archive failed'));
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => [openIssue]),
          updatePipelineStatus: vi.fn(),
          updateState: vi.fn(),
          archiveIssues: vi.fn(),
        },
        [openIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveIssue = handlers.get('github:archive-issue');
    if (!archiveIssue) throw new Error('github:archive-issue handler not registered');

    await expect(
      archiveIssue(undefined, {
        projectId: 'project-1',
        issueId: openIssue.id,
        issueNumber: 42,
      }),
    ).rejects.toThrow(
      'Issue #42 was closed on GitHub but could not be archived from the GitHub project board.',
    );

    expect(closeIssueMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
    expect(queries.githubIssues.archiveIssues).not.toHaveBeenCalled();
  });

  it('reports local archive failures after successful GitHub archive work', async () => {
    const closedIssue = {
      ...baseIssue,
      id: 'issue-closed',
      state: 'closed',
      pipelineStatus: 'closed',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => [closedIssue]),
          updatePipelineStatus: vi.fn(() => {
            throw new Error('db failed');
          }),
          updateState: vi.fn(),
          archiveIssues: vi.fn(),
        },
        [closedIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveIssue = handlers.get('github:archive-issue');
    if (!archiveIssue) throw new Error('github:archive-issue handler not registered');

    await expect(
      archiveIssue(undefined, {
        projectId: 'project-1',
        issueId: closedIssue.id,
        issueNumber: 42,
      }),
    ).rejects.toThrow('Issue #42 could not be archived locally. Refresh the board to sync.');

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(archiveProjectItemsMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith(closedIssue.id, 'closed');
    expect(queries.githubIssues.archiveIssues).not.toHaveBeenCalled();
  });

  it('rejects archive requests when project or issue records are missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          list: vi.fn(() => []),
          archiveIssues: vi.fn(),
        },
        [],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveIssue = handlers.get('github:archive-issue');
    if (!archiveIssue) throw new Error('github:archive-issue handler not registered');

    await expect(
      archiveIssue(undefined, { projectId: 'project-1', issueId: 'issue-1', issueNumber: 42 }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      archiveIssue(undefined, { projectId: 'project-1', issueId: 'missing', issueNumber: 42 }),
    ).rejects.toThrow('Issue missing not found in project project-1');
    expect(queries.githubIssues.archiveIssues).not.toHaveBeenCalled();
  });

  it('archives closed automation runs locally when archiving all closed issues', async () => {
    const archiveClosedAutomationRuns = vi.fn(() => 3);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          listClosed: vi.fn(() => []),
          archiveIssues: vi.fn(),
        },
        [],
      ),
      threads: {
        archiveClosedAutomationRuns,
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveAllDone = handlers.get('github:archive-all-done');
    if (!archiveAllDone) throw new Error('github:archive-all-done handler not registered');

    const result = await archiveAllDone(undefined, { projectId: 'project-1' });

    expect(archiveClosedAutomationRuns).toHaveBeenCalledWith('project-1');
    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(archiveProjectItemsMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.archiveIssues).not.toHaveBeenCalled();
    expect(result).toEqual({ archivedCount: 3, failedCount: 0 });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [],
    });
  });

  it('rejects archive-all-done when the project is missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => null),
      },
      githubIssues: buildGithubIssuesQueries({
        listClosed: vi.fn(() => []),
        archiveIssues: vi.fn(),
      }),
      threads: {
        archiveClosedAutomationRuns: vi.fn(),
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveAllDone = handlers.get('github:archive-all-done');
    if (!archiveAllDone) throw new Error('github:archive-all-done handler not registered');

    await expect(archiveAllDone(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project project-1 not found',
    );
    expect(queries.githubIssues.listClosed).not.toHaveBeenCalled();
  });

  it('archives closed quick tasks locally when archiving all closed issues', async () => {
    const quickIssue = {
      ...baseIssue,
      id: 'quick-1',
      issueNumber: -236024417,
      isQuickMode: true,
      state: 'open',
      pipelineStatus: 'closed',
    };
    const archiveIssues = vi.fn();
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          listClosed: vi.fn(() => [quickIssue]),
          archiveIssues,
        },
        [],
      ),
      threads: {
        archiveClosedAutomationRuns: vi.fn(() => 0),
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveAllDone = handlers.get('github:archive-all-done');
    if (!archiveAllDone) throw new Error('github:archive-all-done handler not registered');

    const result = await archiveAllDone(undefined, { projectId: 'project-1' });

    expect(closeIssueMock).not.toHaveBeenCalled();
    expect(archiveProjectItemsMock).not.toHaveBeenCalled();
    expect(archiveIssues).toHaveBeenCalledWith([quickIssue.id]);
    expect(result).toEqual({ archivedCount: 1, failedCount: 0 });
  });

  it('archives GitHub closed issues and reports per-issue archive failures', async () => {
    const openIssue = { ...baseIssue, id: 'issue-open', issueNumber: 42, state: 'open' };
    const closedIssue = { ...baseIssue, id: 'issue-closed', issueNumber: 43, state: 'closed' };
    const failedIssue = { ...baseIssue, id: 'issue-failed', issueNumber: 44, state: 'open' };
    const archiveIssues = vi.fn();
    archiveProjectItemsMock.mockImplementation(async (...args: unknown[]) => {
      const issueNumber = args[0] as number;
      if (issueNumber === 44) throw new Error('archive failed');
    });
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          listClosed: vi.fn(() => [openIssue, closedIssue, failedIssue]),
          archiveIssues,
        },
        [],
      ),
      threads: {
        archiveClosedAutomationRuns: vi.fn(() => 1),
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const archiveAllDone = handlers.get('github:archive-all-done');
    if (!archiveAllDone) throw new Error('github:archive-all-done handler not registered');

    await expect(archiveAllDone(undefined, { projectId: 'project-1' })).resolves.toEqual({
      archivedCount: 3,
      failedCount: 1,
    });
    expect(closeIssueMock).toHaveBeenCalledWith(42);
    expect(closeIssueMock).toHaveBeenCalledWith(44);
    expect(archiveProjectItemsMock).toHaveBeenCalledWith(43);
    expect(archiveIssues).toHaveBeenCalledWith(['issue-open', 'issue-closed']);
  });

  it('lists and unarchives archived issues through local cache queries', () => {
    const archivedIssues = [{ ...baseIssue, archivedAt: '2026-05-08T00:00:00.000Z' }];
    const queries = {
      githubIssues: {
        listArchived: vi.fn(() => archivedIssues),
        clearArchivedAt: vi.fn(),
      },
    };

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

    const listArchived = handlers.get('github:list-archived');
    const unarchiveIssue = handlers.get('github:unarchive-issue');
    if (!listArchived || !unarchiveIssue) throw new Error('archive handlers not registered');

    expect(listArchived()).toEqual(archivedIssues);
    expect(unarchiveIssue(undefined, { issueId: 'issue-1' })).toBeUndefined();
    expect(queries.githubIssues.clearArchivedAt).toHaveBeenCalledWith('issue-1');
  });

  it('creates a GitHub issue, caches it, broadcasts the refreshed issue list, and returns the cached record', async () => {
    const createdRecord = {
      ...baseIssue,
      id: 'issue-77',
      issueNumber: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['bug'],
      assignee: 'octocat',
    };
    createIssueMock.mockResolvedValue({
      number: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['bug'],
      assignee: 'octocat',
      state: 'open',
      url: 'https://github.com/acme/repo/issues/77',
    });
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(() => [createdRecord]),
        getByNumber: vi.fn(() => createdRecord),
        setPriority: vi.fn(),
        setIssueType: vi.fn(),
      },
    };

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

    const createIssue = handlers.get('github:create-issue');
    if (!createIssue) throw new Error('github:create-issue handler not registered');

    await expect(
      createIssue(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        labels: ['bug'],
      }),
    ).resolves.toEqual({ issue: createdRecord, projectAttachWarning: null });

    expect(createIssueMock).toHaveBeenCalledWith({
      title: 'New issue',
      body: 'Body',
      labels: ['bug'],
    });
    expect(queries.githubIssues.upsert).toHaveBeenCalledWith({
      projectId: 'project-1',
      issueNumber: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['bug'],
      assignee: 'octocat',
      state: 'open',
    });
    expect(queries.githubIssues.list).toHaveBeenCalledWith('project-1');
    expect(queries.githubIssues.getByNumber).toHaveBeenCalledWith('project-1', 77);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [createdRecord],
    });
  });

  it('projects complexity + blast radius onto native labels even without a project board (#45)', async () => {
    const createdRecord = {
      ...baseIssue,
      id: 'issue-77',
      issueNumber: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['enhancement', 'complexity:medium', 'blast:contained'],
    };
    createIssueMock.mockResolvedValue({
      number: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['enhancement', 'complexity:medium', 'blast:contained'],
      assignee: null,
      state: 'open',
      url: 'https://github.com/acme/repo/issues/77',
    });
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(() => [createdRecord]),
        getByNumber: vi.fn(() => createdRecord),
        setIssueType: vi.fn(),
        setPriority: vi.fn(),
      },
    };

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

    const createIssue = handlers.get('github:create-issue');
    if (!createIssue) throw new Error('github:create-issue handler not registered');

    await createIssue(undefined, {
      projectId: 'project-1',
      title: 'New issue',
      body: 'Body',
      labels: ['enhancement'],
      prdMetadata: {
        estimatedComplexity: 'medium',
        blastRadius: 'contained',
      },
    });

    // complexity:* / blast:* are written as native issue labels regardless of
    // whether a Projects v2 board is configured.
    expect(ensureLabelsMock).toHaveBeenCalledWith([
      {
        name: 'complexity:medium',
        color: 'fbca04',
        description: 'PRD estimated complexity: medium.',
      },
      {
        name: 'blast:contained',
        color: '1f883d',
        description: 'PRD blast radius: contained.',
      },
    ]);
    expect(createIssueMock).toHaveBeenCalledWith({
      title: 'New issue',
      body: 'Body',
      labels: ['enhancement', 'complexity:medium', 'blast:contained'],
    });
    // baseProject has no board URL, so the project-field path never runs.
    expect(setIssueProjectMetadataMock).not.toHaveBeenCalled();
  });

  it('fails before creating a PRD issue when metadata labels cannot be ensured (#45)', async () => {
    ensureLabelsMock.mockResolvedValueOnce({
      created: [],
      alreadyPresent: ['complexity:medium'],
      failed: [{ name: 'blast:contained', error: 'missing permission' }],
    });
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(),
        getByNumber: vi.fn(),
        setIssueType: vi.fn(),
        setPriority: vi.fn(),
      },
    };

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

    const createIssue = handlers.get('github:create-issue');
    if (!createIssue) throw new Error('github:create-issue handler not registered');

    await expect(
      createIssue(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        labels: ['enhancement'],
        prdMetadata: PRD_METADATA_FIXTURE,
      }),
    ).rejects.toThrow('Failed to create PRD metadata labels: blast:contained: missing permission');

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(queries.githubIssues.upsert).not.toHaveBeenCalled();
  });

  it('creates a PRD issue on the configured project board and returns metadata warnings', async () => {
    const projectWithBoard = {
      ...baseProject,
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };
    const createdRecord = {
      ...baseIssue,
      id: 'issue-77',
      issueNumber: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['enhancement'],
    };
    createIssueMock.mockResolvedValue({
      number: 77,
      title: 'New issue',
      body: 'Body',
      labels: ['enhancement'],
      assignee: null,
      state: 'open',
      url: 'https://github.com/acme/repo/issues/77',
    });
    setIssueProjectMetadataMock.mockResolvedValue(['Priority field not found']);
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(() => [createdRecord]),
        getByNumber: vi.fn(() => createdRecord),
        setIssueType: vi.fn(),
        setPriority: vi.fn(),
      },
    };

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

    const createIssue = handlers.get('github:create-issue');
    if (!createIssue) throw new Error('github:create-issue handler not registered');

    await expect(
      createIssue(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        labels: ['enhancement'],
        prdMetadata: {
          estimatedComplexity: 'medium',
          blastRadius: 'contained',
        },
      }),
    ).resolves.toEqual({
      issue: createdRecord,
      projectAttachWarning: 'Priority field not found',
    });

    expect(addIssueToProjectMock).toHaveBeenCalledWith({
      issueUrl: 'https://github.com/acme/repo/issues/77',
      owner: 'acme',
      projectNumber: 1,
    });
    expect(setIssueProjectMetadataMock).toHaveBeenCalledWith({
      issueNumber: 77,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: {
        issueType: 'Feature',
        status: 'Backlog',
        priority: 'P3',
        complexity: 'medium',
        blastRadius: 'contained',
      },
    });
    expect(queries.githubIssues.setIssueType).toHaveBeenCalledWith({
      id: 'issue-77',
      issueType: 'Feature',
    });
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-77', rank: 'p3', raw: 'P3' }),
    );
  });

  it('throws when a newly created issue cannot be read back from the cache', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(() => []),
        getByNumber: vi.fn(() => null),
      },
    };

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

    const createIssue = handlers.get('github:create-issue');
    if (!createIssue) throw new Error('github:create-issue handler not registered');

    await expect(
      createIssue(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        labels: [],
      }),
    ).rejects.toThrow('Created issue #42 not found in cache after upsert');
  });

  it('rejects create issue when the project is missing and combines attach metadata warnings', async () => {
    const projectWithBoard = {
      ...baseProject,
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };
    const createdRecord = { ...baseIssue, id: 'issue-77', issueNumber: 77 };
    createIssueMock.mockResolvedValue({
      number: 77,
      title: 'New issue',
      body: 'Body',
      labels: [],
      assignee: null,
      state: 'open',
      url: 'https://github.com/acme/repo/issues/77',
    });
    addIssueToProjectMock.mockResolvedValue({ alreadyPresent: false });
    setIssueProjectMetadataMock.mockRejectedValue(new Error('Metadata field unavailable'));
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(projectWithBoard),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(() => [createdRecord]),
        getByNumber: vi.fn(() => createdRecord),
      },
    };

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

    const createIssue = handlers.get('github:create-issue');
    if (!createIssue) throw new Error('github:create-issue handler not registered');

    await expect(
      createIssue(undefined, { projectId: 'project-1', title: 'New issue', body: 'Body' }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      createIssue(undefined, {
        projectId: 'project-1',
        title: 'New issue',
        body: 'Body',
        labels: [],
        prdMetadata: {
          estimatedComplexity: 'medium',
          blastRadius: 'contained',
        },
      }),
    ).resolves.toEqual({
      issue: createdRecord,
      projectAttachWarning: 'Metadata field unavailable',
    });
  });

  it('edits a GitHub issue, refreshes it from GitHub, updates the cache, and returns the refreshed record', async () => {
    const updatedRecord = {
      ...baseIssue,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
      assignee: 'octocat',
    };
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
      assignee: 'octocat',
      state: 'open',
      author: null,
    });
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn().mockReturnValueOnce(baseIssue).mockReturnValueOnce(updatedRecord),
        upsert: vi.fn(),
        list: vi.fn(() => [updatedRecord]),
      },
    };

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

    const editIssue = handlers.get('github:edit-issue-body');
    if (!editIssue) throw new Error('github:edit-issue-body handler not registered');

    await expect(
      editIssue(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        title: 'Edited',
        body: 'Edited body',
        labels: ['enhancement'],
      }),
    ).resolves.toBe(updatedRecord);

    expect(editIssueMock).toHaveBeenCalledWith({
      issueNumber: 42,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
    });
    expect(getIssueMock).toHaveBeenCalledWith(42);
    expect(queries.githubIssues.upsert).toHaveBeenCalledWith({
      projectId: 'project-1',
      issueNumber: 42,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
      assignee: 'octocat',
      state: 'open',
    });
    expect(queries.githubIssues.list).toHaveBeenCalledWith('project-1');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [updatedRecord],
    });
  });

  it('refreshes the cached issue type after editing PRD metadata on the board (#45)', async () => {
    const projectWithBoard = {
      ...baseProject,
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };
    const editedRecord = {
      ...baseIssue,
      id: 'issue-42',
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement', 'complexity:high', 'blast:infra'],
    };
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement', 'complexity:high', 'blast:infra'],
      assignee: null,
      state: 'open',
      author: null,
    });
    setIssueProjectMetadataMock.mockResolvedValue([]);
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
      },
      githubIssues: {
        getByNumber: vi.fn(() => editedRecord),
        upsert: vi.fn(),
        list: vi.fn(() => [editedRecord]),
        setIssueType: vi.fn(),
      },
    };

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

    const editIssue = handlers.get('github:edit-issue-body');
    if (!editIssue) throw new Error('github:edit-issue-body handler not registered');

    await editIssue(undefined, {
      projectId: 'project-1',
      issueNumber: 42,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
      prdMetadata: {
        estimatedComplexity: 'high',
        blastRadius: 'infra',
      },
    });

    // native labels projected onto the edit too
    expect(editIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.arrayContaining(['enhancement', 'complexity:high', 'blast:infra']),
      }),
    );
    // local cache issue type refreshed so it isn't stale until next sync (AC4)
    expect(queries.githubIssues.setIssueType).toHaveBeenCalledWith({
      id: 'issue-42',
      issueType: 'Feature',
    });
  });

  it('updates project metadata while editing PRD issue content and tolerates metadata failures', async () => {
    const projectWithBoard = {
      ...baseProject,
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };
    const updatedRecord = {
      ...baseIssue,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
    };
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Edited',
      body: 'Edited body',
      labels: ['enhancement'],
      assignee: null,
      state: 'open',
      author: null,
    });
    setIssueProjectMetadataMock.mockRejectedValue(new Error('metadata failed'));
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
      },
      githubIssues: {
        getByNumber: vi.fn().mockReturnValueOnce(baseIssue).mockReturnValueOnce(updatedRecord),
        upsert: vi.fn(),
        list: vi.fn(() => [updatedRecord]),
      },
    };

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

    const editIssue = handlers.get('github:edit-issue-body');
    if (!editIssue) throw new Error('github:edit-issue-body handler not registered');

    await expect(
      editIssue(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        title: 'Edited',
        body: 'Edited body',
        labels: ['enhancement'],
        prdMetadata: {
          estimatedComplexity: 'high',
          blastRadius: 'broad',
        },
      }),
    ).resolves.toBe(updatedRecord);

    expect(addIssueToProjectMock).toHaveBeenCalledWith({
      issueUrl: 'https://github.com/acme/repo/issues/42',
      owner: 'acme',
      projectNumber: 1,
    });
    expect(setIssueProjectMetadataMock).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: {
        issueType: 'Feature',
        complexity: 'high',
        blastRadius: 'broad',
      },
    });
    expect(getIssueMock).toHaveBeenCalledWith(42);
  });

  it('rejects edit issue requests when project, issue, or issue kind is invalid', async () => {
    const quickIssue = { ...baseIssue, issueNumber: -42, isQuickMode: true };
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(null).mockReturnValue(baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn().mockReturnValueOnce(null).mockReturnValue(quickIssue),
        upsert: vi.fn(),
        list: vi.fn(() => []),
      },
    };

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

    const editIssue = handlers.get('github:edit-issue-body');
    if (!editIssue) throw new Error('github:edit-issue-body handler not registered');

    await expect(
      editIssue(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        title: 'Edited',
        body: 'Edited body',
      }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      editIssue(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        title: 'Edited',
        body: 'Edited body',
      }),
    ).rejects.toThrow('Issue #42 not found in project project-1');
    await expect(
      editIssue(undefined, {
        projectId: 'project-1',
        issueNumber: -42,
        title: 'Edited',
        body: 'Edited body',
      }),
    ).rejects.toThrow('Quick tasks have no GitHub issue');
    expect(editIssueMock).not.toHaveBeenCalled();
  });

  it('syncs cached real issues to the configured GitHub Projects board and refreshes priorities', async () => {
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };
    const issueA = { ...baseIssue, id: 'issue-42', issueNumber: 42, isQuickMode: false };
    const issueB = { ...baseIssue, id: 'issue-43', issueNumber: 43, isQuickMode: false };
    const quickIssue = { ...baseIssue, id: 'quick', issueNumber: -12, isQuickMode: true };
    addIssueToProjectMock
      .mockResolvedValueOnce({ alreadyPresent: false })
      .mockResolvedValueOnce({ alreadyPresent: true });
    fetchProjectPrioritiesMock.mockResolvedValue({
      priorities: new Map([[43, { rank: 'p2', raw: 'P2' }]]),
      issueTypes: new Map(),
      archivedIssueNumbers: new Set(),
    });
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: {
        list: vi.fn(() => [issueA, issueB, quickIssue]),
        setPriority: vi.fn(),
        setIssueType: vi.fn(),
      },
    };

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

    const syncToBoard = handlers.get('github:sync-to-project-board');
    if (!syncToBoard) throw new Error('github:sync-to-project-board handler not registered');

    await expect(syncToBoard(undefined, { projectId: 'project-1' })).resolves.toEqual({
      attached: 1,
      alreadyPresent: 1,
      failed: 0,
      errors: [],
    });

    expect(addIssueToProjectMock).toHaveBeenCalledTimes(2);
    expect(addIssueToProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectNumber: 1,
        owner: 'acme',
        issueUrl: 'https://github.com/acme/repo/issues/42',
      }),
    );
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-42', rank: null, raw: null }),
    );
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-43', rank: 'p2', raw: 'P2' }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [issueA, issueB, quickIssue],
    });
  });

  it('reports board sync configuration and per-issue attach failures', async () => {
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      gitRemote: null,
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubRepoFullName: 'acme/repo',
    };
    const issue = { ...baseIssue, id: 'issue-42', issueNumber: 42, isQuickMode: false };
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: {
        list: vi.fn(() => [issue]),
        setPriority: vi.fn(),
        setIssueType: vi.fn(),
      },
    };

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

    const syncToBoard = handlers.get('github:sync-to-project-board');
    if (!syncToBoard) throw new Error('github:sync-to-project-board handler not registered');

    await expect(syncToBoard(undefined, { projectId: 'project-1' })).resolves.toEqual({
      attached: 0,
      alreadyPresent: 0,
      failed: 1,
      errors: ['#42: could not derive issue URL from git remote'],
    });

    expect(addIssueToProjectMock).not.toHaveBeenCalled();
  });

  it('rejects board sync for missing projects and invalid board URLs', async () => {
    const queries = {
      projects: {
        getById: vi
          .fn()
          .mockReturnValueOnce(null)
          .mockReturnValue({
            ...baseProject,
            githubProjectUrl: 'https://github.com/acme/repo/issues/42',
          }),
      },
      githubIssues: {
        list: vi.fn(() => []),
        setPriority: vi.fn(),
        setIssueType: vi.fn(),
      },
    };

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

    const syncToBoard = handlers.get('github:sync-to-project-board');
    if (!syncToBoard) throw new Error('github:sync-to-project-board handler not registered');

    await expect(syncToBoard(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project project-1 not found',
    );
    await expect(syncToBoard(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'No GitHub Projects v2 URL set',
    );
    expect(addIssueToProjectMock).not.toHaveBeenCalled();
  });

  it('reports board sync attach failures and still refreshes priority metadata after warnings', async () => {
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubRepoFullName: null,
    };
    const issue = { ...baseIssue, id: 'issue-42', issueNumber: 42, isQuickMode: false };
    getRepoMetadataMock.mockRejectedValue(new Error('metadata failed'));
    addIssueToProjectMock.mockRejectedValue(new Error('attach failed'));
    fetchProjectPrioritiesMock.mockImplementation(async ({ onWarn }) => {
      onWarn?.('priority warning', new Error('priority warning'));
      return {
        priorities: new Map([[42, { rank: 'p1', raw: 'P1' }]]),
        issueTypes: new Map(),
        archivedIssueNumbers: new Set(),
      };
    });
    const queries = {
      projects: {
        getById: vi.fn(() => projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: {
        list: vi.fn(() => [issue]),
        setPriority: vi.fn(),
        setIssueType: vi.fn(),
      },
    };

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

    const syncToBoard = handlers.get('github:sync-to-project-board');
    if (!syncToBoard) throw new Error('github:sync-to-project-board handler not registered');

    await expect(syncToBoard(undefined, { projectId: 'project-1' })).resolves.toEqual({
      attached: 0,
      alreadyPresent: 0,
      failed: 1,
      errors: ['#42: attach failed'],
    });
    expect(queries.projects.updateGithubRepoIdentity).not.toHaveBeenCalled();
    expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-42', rank: 'p1', raw: 'P1' }),
    );
  });

  it('rejects board sync without a configured project URL and tolerates priority refresh failures', async () => {
    const projectWithoutBoard = { ...baseProject, githubProjectUrl: null };
    const projectWithBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubRepoFullName: 'acme/repo',
    };
    const issue = { ...baseIssue, id: 'issue-42', issueNumber: 42, isQuickMode: false };
    fetchProjectPrioritiesMock.mockRejectedValue(new Error('priority unavailable'));
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(projectWithoutBoard).mockReturnValue(projectWithBoard),
        updateGithubRepoIdentity: vi.fn(),
      },
      githubIssues: {
        list: vi.fn(() => [issue]),
        setPriority: vi.fn(),
        setIssueType: vi.fn(),
      },
    };

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

    const syncToBoard = handlers.get('github:sync-to-project-board');
    if (!syncToBoard) throw new Error('github:sync-to-project-board handler not registered');

    await expect(syncToBoard(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'No GitHub Projects v2 URL set',
    );
    await expect(syncToBoard(undefined, { projectId: 'project-1' })).resolves.toEqual({
      attached: 1,
      alreadyPresent: 0,
      failed: 0,
      errors: [],
    });
    expect(addIssueToProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueUrl: 'https://github.com/acme/repo/issues/42' }),
    );
    expect(queries.githubIssues.setPriority).not.toHaveBeenCalled();
  });

  it('caps auto-run count when a positive maxTasks limit is provided', () => {
    const queries = {
      githubIssues: {
        countEligibleTodo: vi.fn(() => 7),
      },
    };

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

    const autoRunCount = handlers.get('github:auto-run-count');
    if (!autoRunCount) throw new Error('github:auto-run-count handler not registered');

    expect(
      autoRunCount(undefined, { projectId: 'project-1', priorities: ['p0', 'p1'], maxTasks: 3 }),
    ).toEqual({ count: 3 });
    expect(
      autoRunCount(undefined, { projectId: 'project-1', priorities: ['p0'], maxTasks: 0 }),
    ).toEqual({ count: 7 });
    expect(queries.githubIssues.countEligibleTodo).toHaveBeenCalledWith('project-1', ['p0', 'p1']);
  });

  it('starts, queues, and counts failures during auto-run batches', async () => {
    const { PipelineScheduler } = await import('../pipeline-scheduler');
    const startOrQueue = vi
      .spyOn(PipelineScheduler.prototype, 'startOrQueue')
      .mockResolvedValueOnce({ queued: false })
      .mockResolvedValueOnce({ queued: true })
      .mockRejectedValueOnce(new Error('scheduler failed'));
    const issues = [
      { ...baseIssue, id: 'issue-1', issueNumber: 1 },
      { ...baseIssue, id: 'issue-2', issueNumber: 2 },
      { ...baseIssue, id: 'issue-3', issueNumber: 3 },
      { ...baseIssue, id: 'issue-4', issueNumber: 4 },
    ];
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, githubProjectUrl: null })),
      },
      githubIssues: {
        getEligibleTodoIssues: vi.fn(() => issues),
      },
    };

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

    const autoRun = handlers.get('github:auto-run');
    if (!autoRun) throw new Error('github:auto-run handler not registered');

    await expect(
      autoRun(undefined, { projectId: 'project-1', priorities: ['p0'], maxTasks: 3 }),
    ).resolves.toEqual({ started: 1, queued: 1 });
    expect(startOrQueue).toHaveBeenCalledTimes(3);
    expect(startOrQueue).toHaveBeenNthCalledWith(1, 'project-1', 1);
    expect(startOrQueue).toHaveBeenNthCalledWith(2, 'project-1', 2);
    expect(startOrQueue).toHaveBeenNthCalledWith(3, 'project-1', 3);
    startOrQueue.mockRestore();
  });

  it('rejects auto-run when the project is missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => null),
      },
      githubIssues: {
        getEligibleTodoIssues: vi.fn(() => []),
      },
    };

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

    const autoRun = handlers.get('github:auto-run');
    if (!autoRun) throw new Error('github:auto-run handler not registered');

    await expect(
      autoRun(undefined, { projectId: 'project-1', priorities: ['p0'], maxTasks: 0 }),
    ).rejects.toThrow('Project project-1 not found');
  });

  it('retry cancels an active canonical thread before resetting the issue to todo', () => {
    const activeThread = { ...reusableThread, status: 'executing' };
    const queries = {
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => ({ ...baseIssue, threadId: activeThread.id })),
          resetToTodo: vi.fn(() => true),
          reconcileCompletedFromEvidence: vi.fn(),
        },
        [baseIssue],
      ),
      threads: {
        getById: vi.fn(() => activeThread),
        getByProjectAndGithubIssue: vi.fn(() => null),
        updateStatus: vi.fn(),
      },
    };
    const pipeline = {
      cancel: vi.fn(),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const retryIssue = handlers.get('github:retry-issue');
    if (!retryIssue) throw new Error('github:retry-issue handler not registered');

    expect(retryIssue(undefined, { projectId: 'project-1', issueNumber: 42 })).toBeUndefined();
    expect(pipeline.cancel).toHaveBeenCalledWith(activeThread.id);
    expect(queries.threads.updateStatus).toHaveBeenCalledWith(activeThread.id, 'idle');
    expect(queries.githubIssues.resetToTodo).toHaveBeenCalledWith(baseIssue.id);
    expect(queries.githubIssues.reconcileCompletedFromEvidence).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [baseIssue],
    });
  });

  it('retry leaves completed threads running state untouched and reconciles when resetToTodo fails', () => {
    const completedThread = { ...reusableThread, status: 'completed' };
    const queries = {
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => ({ ...baseIssue, threadId: completedThread.id })),
          resetToTodo: vi.fn(() => false),
          reconcileCompletedFromEvidence: vi.fn(),
        },
        [baseIssue],
      ),
      threads: {
        getById: vi.fn(() => completedThread),
        getByProjectAndGithubIssue: vi.fn(() => null),
        updateStatus: vi.fn(),
      },
    };
    const pipeline = {
      cancel: vi.fn(),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const retryIssue = handlers.get('github:retry-issue');
    if (!retryIssue) throw new Error('github:retry-issue handler not registered');

    retryIssue(undefined, { projectId: 'project-1', issueNumber: 42 });

    expect(pipeline.cancel).not.toHaveBeenCalled();
    expect(queries.threads.updateStatus).not.toHaveBeenCalled();
    expect(queries.githubIssues.resetToTodo).toHaveBeenCalledWith(baseIssue.id);
    expect(queries.githubIssues.reconcileCompletedFromEvidence).toHaveBeenCalledWith(baseIssue.id);
  });

  it('rejects retry when the issue is missing from cache', () => {
    const queries = {
      githubIssues: buildGithubIssuesQueries({
        getByNumber: vi.fn(() => null),
        resetToTodo: vi.fn(),
        reconcileCompletedFromEvidence: vi.fn(),
      }),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
        updateStatus: vi.fn(),
      },
    };
    const pipeline = {
      cancel: vi.fn(),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const retryIssue = handlers.get('github:retry-issue');
    if (!retryIssue) throw new Error('github:retry-issue handler not registered');

    expect(() => retryIssue(undefined, { projectId: 'project-1', issueNumber: 42 })).toThrow(
      'Issue #42 not found in cache',
    );
    expect(pipeline.cancel).not.toHaveBeenCalled();
    expect(queries.githubIssues.resetToTodo).not.toHaveBeenCalled();
  });

  it('trims blank model id overrides to null and broadcasts the refreshed issue', () => {
    const refreshedIssue = { ...baseIssue, executorModelIdOverride: null };
    const queries = {
      githubIssues: buildGithubIssuesQueries({
        getByNumber: vi.fn(() => refreshedIssue),
        updatePhaseModelIdOverride: vi.fn(),
      }),
      projects: { getById: vi.fn(() => baseProject) },
      settings: { get: vi.fn(() => ({ executorModel: 'claude' })) },
    };

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

    const setModelId = handlers.get('github:set-phase-model-id-override');
    if (!setModelId) throw new Error('github:set-phase-model-id-override handler not registered');

    expect(
      setModelId(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
        modelId: '   ',
      }),
    ).toEqual(refreshedIssue);
    expect(queries.githubIssues.updatePhaseModelIdOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'executor',
      null,
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [baseIssue],
    });
  });

  it('updates and clears model override values for an issue', () => {
    const updatedIssue = { ...baseIssue, executorModelOverride: 'codex' };
    const clearedIssue = { ...baseIssue, executorModelOverride: null };
    const getByNumber = vi
      .fn()
      .mockReturnValueOnce(baseIssue)
      .mockReturnValueOnce(updatedIssue)
      .mockReturnValueOnce(baseIssue)
      .mockReturnValueOnce(clearedIssue);
    const queries = {
      githubIssues: buildGithubIssuesQueries({
        getByNumber,
        updatePhaseModelOverride: vi.fn(),
      }),
    };

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

    const setOverride = handlers.get('github:set-phase-model-override');
    const clearOverride = handlers.get('github:clear-phase-model-override');
    if (!setOverride || !clearOverride) throw new Error('model override handlers not registered');

    expect(
      setOverride(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
        model: 'codex',
      }),
    ).toEqual(updatedIssue);
    expect(queries.githubIssues.updatePhaseModelOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'executor',
      'codex',
    );

    expect(
      clearOverride(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
      }),
    ).toEqual(clearedIssue);
    expect(queries.githubIssues.updatePhaseModelOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'executor',
      null,
    );
  });

  it('updates and clears model id, revision, and reasoning override values', () => {
    const queries = {
      githubIssues: buildGithubIssuesQueries({
        updatePhaseModelIdOverride: vi.fn(),
        updateRevisionCountOverride: vi.fn(),
        updatePhaseReasoningEffortOverride: vi.fn(),
      }),
      projects: { getById: vi.fn(() => baseProject) },
      settings: { get: vi.fn(() => ({ plannerModel: 'claude' })) },
    };

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

    const setModelId = handlers.get('github:set-phase-model-id-override');
    const clearModelId = handlers.get('github:clear-phase-model-id-override');
    const setRevisionCount = handlers.get('github:set-revision-count-override');
    const setReasoningEffort = handlers.get('github:set-phase-reasoning-effort-override');
    const clearReasoningEffort = handlers.get('github:clear-phase-reasoning-effort-override');
    if (
      !setModelId ||
      !clearModelId ||
      !setRevisionCount ||
      !setReasoningEffort ||
      !clearReasoningEffort
    ) {
      throw new Error('override handlers not registered');
    }

    expect(
      setModelId(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        modelId: '  claude-opus-4-1  ',
      }),
    ).toEqual(baseIssue);
    expect(queries.githubIssues.updatePhaseModelIdOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'planner',
      'claude-opus-4-1',
    );
    expect(
      setModelId(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        modelId: '  OPUS  ',
      }),
    ).toEqual(baseIssue);
    expect(queries.githubIssues.updatePhaseModelIdOverride).toHaveBeenLastCalledWith(
      baseIssue.id,
      'planner',
      'opus',
    );

    expect(
      clearModelId(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
      }),
    ).toEqual(baseIssue);
    expect(queries.githubIssues.updatePhaseModelIdOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'planner',
      null,
    );

    expect(
      setRevisionCount(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        revisionCount: 3,
      }),
    ).toEqual(baseIssue);
    expect(queries.githubIssues.updateRevisionCountOverride).toHaveBeenCalledWith(baseIssue.id, 3);

    expect(
      setReasoningEffort(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'verifier',
        effort: 'xhigh',
      }),
    ).toEqual(baseIssue);
    expect(queries.githubIssues.updatePhaseReasoningEffortOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'verifier',
      'xhigh',
    );

    expect(
      clearReasoningEffort(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'verifier',
      }),
    ).toEqual(baseIssue);
    expect(queries.githubIssues.updatePhaseReasoningEffortOverride).toHaveBeenCalledWith(
      baseIssue.id,
      'verifier',
      null,
    );
  });

  it('rejects invalid override values before mutating issue overrides', () => {
    const queries = {
      githubIssues: buildGithubIssuesQueries({
        updatePhaseModelOverride: vi.fn(),
        updateRevisionCountOverride: vi.fn(),
        updateRequireApprovalOverride: vi.fn(),
        updatePhaseReasoningEffortOverride: vi.fn(),
      }),
    };

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

    const setPhaseModel = handlers.get('github:set-phase-model-override');
    const setRevisionCount = handlers.get('github:set-revision-count-override');
    const setRequireApproval = handlers.get('github:set-require-approval-override');
    const setReasoningEffort = handlers.get('github:set-phase-reasoning-effort-override');
    if (!setPhaseModel || !setRevisionCount || !setRequireApproval || !setReasoningEffort) {
      throw new Error('override handlers not registered');
    }

    expect(() =>
      setPhaseModel(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
        model: 'gpt',
      }),
    ).toThrow('Invalid executor model: gpt');
    expect(() =>
      setRevisionCount(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        revisionCount: 6,
      }),
    ).toThrow('Invalid revision count override: 6');
    expect(() =>
      setRequireApproval(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        requireApproval: 'yes',
      }),
    ).toThrow('Invalid requireApproval override: yes');
    expect(() =>
      setReasoningEffort(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        effort: 'extreme',
      }),
    ).toThrow('Invalid planner reasoning effort: extreme');

    expect(queries.githubIssues.updatePhaseModelOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateRevisionCountOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateRequireApprovalOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePhaseReasoningEffortOverride).not.toHaveBeenCalled();
  });

  it('rejects override updates when the issue is missing from cache', () => {
    const queries = {
      githubIssues: buildGithubIssuesQueries({
        getByNumber: vi.fn(() => null),
        updatePhaseModelOverride: vi.fn(),
        updatePhaseModelIdOverride: vi.fn(),
        updateRevisionCountOverride: vi.fn(),
        updateRequireApprovalOverride: vi.fn(),
        updatePhaseReasoningEffortOverride: vi.fn(),
      }),
    };

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

    const setPhaseModel = handlers.get('github:set-phase-model-override');
    const clearPhaseModel = handlers.get('github:clear-phase-model-override');
    const setModelId = handlers.get('github:set-phase-model-id-override');
    const clearModelId = handlers.get('github:clear-phase-model-id-override');
    const setRevisionCount = handlers.get('github:set-revision-count-override');
    const setApproval = handlers.get('github:set-require-approval-override');
    const setReasoning = handlers.get('github:set-phase-reasoning-effort-override');
    const clearReasoning = handlers.get('github:clear-phase-reasoning-effort-override');
    if (
      !setPhaseModel ||
      !clearPhaseModel ||
      !setModelId ||
      !clearModelId ||
      !setRevisionCount ||
      !setApproval ||
      !setReasoning ||
      !clearReasoning
    ) {
      throw new Error('override handlers not registered');
    }

    expect(() =>
      setPhaseModel(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
        model: 'codex',
      }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      clearPhaseModel(undefined, { projectId: 'project-1', issueNumber: 42, phase: 'executor' }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      setModelId(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'executor',
        modelId: 'codex/gpt-5',
      }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      clearModelId(undefined, { projectId: 'project-1', issueNumber: 42, phase: 'executor' }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      setRevisionCount(undefined, { projectId: 'project-1', issueNumber: 42, revisionCount: 2 }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      setApproval(undefined, { projectId: 'project-1', issueNumber: 42, requireApproval: true }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      setReasoning(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        phase: 'planner',
        effort: 'high',
      }),
    ).toThrow('Issue #42 not found in cache');
    expect(() =>
      clearReasoning(undefined, { projectId: 'project-1', issueNumber: 42, phase: 'planner' }),
    ).toThrow('Issue #42 not found in cache');

    expect(queries.githubIssues.updatePhaseModelOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePhaseModelIdOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateRevisionCountOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updateRequireApprovalOverride).not.toHaveBeenCalled();
    expect(queries.githubIssues.updatePhaseReasoningEffortOverride).not.toHaveBeenCalled();
  });

  it('lists repository labels and ensures default ShipCode labels', async () => {
    const labels = [{ name: 'shipcode', color: '111111', description: 'ShipCode' }];
    const labelSync = {
      created: ['agent:codex'],
      alreadyPresent: ['shipcode'],
      failed: [] as string[],
    };
    listRepoLabelsWithMetaMock.mockResolvedValue(labels);
    ensureLabelsMock.mockResolvedValue(labelSync as never);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
    };

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

    const listLabels = handlers.get('github:list-repo-labels');
    const ensureLabels = handlers.get('github:ensure-shipcode-labels');
    if (!listLabels || !ensureLabels) throw new Error('label handlers not registered');

    await expect(listLabels(undefined, { projectId: 'project-1' })).resolves.toEqual(labels);
    await expect(ensureLabels(undefined, { projectId: 'project-1' })).resolves.toEqual(labelSync);
    expect(listRepoLabelsWithMetaMock).toHaveBeenCalledTimes(1);
    expect(ensureLabelsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'shipcode:agent:codex',
        }),
      ]),
    );
  });

  it('rejects label and readiness checks when the project is missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => null),
        setGithubStatusMapping: vi.fn(),
        clearGithubStatusMapping: vi.fn(),
      },
    };

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

    const listLabels = handlers.get('github:list-repo-labels');
    const ensureLabels = handlers.get('github:ensure-shipcode-labels');
    const checkReadiness = handlers.get('github:check-project-readiness');
    if (!listLabels || !ensureLabels || !checkReadiness) {
      throw new Error('project validation handlers not registered');
    }

    await expect(listLabels(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project project-1 not found',
    );
    await expect(ensureLabels(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project project-1 not found',
    );
    await expect(checkReadiness(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project project-1 not found',
    );
    expect(listRepoLabelsWithMetaMock).not.toHaveBeenCalled();
    expect(ensureLabelsMock).not.toHaveBeenCalled();
    expect(checkProjectReadinessMock).not.toHaveBeenCalled();
  });

  it('rejects readiness checks when the project path is missing', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp/shipcode-missing-path' })),
        setGithubStatusMapping: vi.fn(),
        clearGithubStatusMapping: vi.fn(),
      },
    };

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

    const checkReadiness = handlers.get('github:check-project-readiness');
    if (!checkReadiness) throw new Error('github:check-project-readiness handler not registered');

    await expect(checkReadiness(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project path no longer exists: /tmp/shipcode-missing-path',
    );
    expect(checkProjectReadinessMock).not.toHaveBeenCalled();
  });

  it('stores detected GitHub project status mapping after readiness checks', async () => {
    const statusMapping = {
      todo: ['Todo'],
      inProgress: ['In Progress'],
      humanReview: ['Human Review'],
      deferred: ['Deferred'],
      done: ['Done'],
    };
    const report = {
      ok: true,
      items: [{ id: 'labels', ok: true, message: 'ready' }],
      labelSync: { created: [], alreadyPresent: ['shipcode'], failed: [] },
      statusMapping,
    };
    checkProjectReadinessMock.mockResolvedValue(report);
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp' })),
        setGithubStatusMapping: vi.fn(),
        clearGithubStatusMapping: vi.fn(),
      },
    };

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

    const checkReadiness = handlers.get('github:check-project-readiness');
    if (!checkReadiness) throw new Error('github:check-project-readiness handler not registered');

    await expect(checkReadiness(undefined, { projectId: 'project-1' })).resolves.toBe(report);
    expect(checkProjectReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp',
        repairLabels: true,
      }),
    );
    expect(queries.projects.setGithubStatusMapping).toHaveBeenCalledWith(
      'project-1',
      statusMapping,
    );
    expect(queries.projects.clearGithubStatusMapping).not.toHaveBeenCalled();
  });

  it('forwards readiness warnings while checking project configuration', async () => {
    const report = {
      ok: true,
      items: [],
      labelSync: { created: [], alreadyPresent: [], failed: [] },
      statusMapping: null,
    };
    checkProjectReadinessMock.mockImplementation(async ({ onWarn }) => {
      onWarn?.('readiness warning', new Error('readiness warning'));
      return report;
    });
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', githubProjectUrl: null })),
        setGithubStatusMapping: vi.fn(),
        clearGithubStatusMapping: vi.fn(),
      },
    };

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

    const checkReadiness = handlers.get('github:check-project-readiness');
    if (!checkReadiness) throw new Error('github:check-project-readiness handler not registered');

    await expect(checkReadiness(undefined, { projectId: 'project-1' })).resolves.toBe(report);
    expect(queries.projects.clearGithubStatusMapping).not.toHaveBeenCalled();
  });

  it('clears GitHub project status mapping when readiness no longer reports one', async () => {
    checkProjectReadinessMock.mockResolvedValue({
      ok: false,
      items: [],
      labelSync: { created: [], alreadyPresent: [], failed: [] },
      statusMapping: null,
    });
    const queries = {
      projects: {
        getById: vi.fn(() => ({
          ...baseProject,
          path: '/tmp',
          githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
        })),
        setGithubStatusMapping: vi.fn(),
        clearGithubStatusMapping: vi.fn(),
      },
    };

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

    const checkReadiness = handlers.get('github:check-project-readiness');
    if (!checkReadiness) throw new Error('github:check-project-readiness handler not registered');

    await checkReadiness(undefined, { projectId: 'project-1' });
    expect(queries.projects.clearGithubStatusMapping).toHaveBeenCalledWith('project-1');
    expect(queries.projects.setGithubStatusMapping).not.toHaveBeenCalled();
  });

  it('lists comments with cache reuse and clears the cache after posting', async () => {
    const comment = {
      id: 1,
      author: 'octocat',
      body: 'hello',
      createdAt: '2026-05-08T00:00:00.000Z',
      url: 'https://github.test/comment/1',
    };
    listIssueCommentsMock.mockResolvedValue([comment]);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => baseIssue),
        },
        [baseIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const listComments = handlers.get('github:list-comments');
    const addComment = handlers.get('github:add-comment');
    if (!listComments || !addComment) throw new Error('comment handlers not registered');

    await expect(
      listComments(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).resolves.toEqual([comment]);
    await expect(
      listComments(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).resolves.toEqual([comment]);
    expect(listIssueCommentsMock).toHaveBeenCalledTimes(1);

    await addComment(undefined, { projectId: 'project-1', issueNumber: 42, body: 'next' });
    expect(addIssueCommentMock).toHaveBeenCalledWith(42, 'next');

    await listComments(undefined, { projectId: 'project-1', issueNumber: 42 });
    expect(listIssueCommentsMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes in-flight GitHub comment list requests', async () => {
    const comment = {
      id: 1,
      author: 'octocat',
      body: 'hello',
      createdAt: '2026-05-08T00:00:00.000Z',
      url: 'https://github.test/comment/1',
    };
    const comments = deferred<Array<typeof comment>>();
    listIssueCommentsMock.mockReturnValue(comments.promise);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => baseIssue),
        },
        [baseIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const listComments = handlers.get('github:list-comments');
    if (!listComments) throw new Error('github:list-comments handler not registered');

    const first = listComments(undefined, { projectId: 'project-1', issueNumber: 42, force: true });
    const second = listComments(undefined, {
      projectId: 'project-1',
      issueNumber: 42,
      force: true,
    });
    comments.resolve([comment]);

    await expect(Promise.all([first, second])).resolves.toEqual([[comment], [comment]]);
    expect(listIssueCommentsMock).toHaveBeenCalledTimes(1);
  });

  it('triages eligible todo issues and applies high-confidence labels', async () => {
    const eligibleIssue = {
      ...baseIssue,
      issueNumber: 42,
      labels: ['bug', 'agent:claude', 'complexity:large'],
      pipelineStatus: 'todo',
      threadId: null,
      isQuickMode: false,
    };
    triageGitHubIssuesMock.mockResolvedValue({
      provider: 'openrouter',
      modelId: 'openrouter/anthropic/claude-sonnet-4.5',
      resolvedModel: 'anthropic/claude-sonnet-4.5',
      recommendations: [
        {
          issueNumber: 42,
          confidence: 0.91,
          suggestedLabels: ['complexity:small', 'blast:low'],
          suggestedAgent: 'codex',
          shouldStart: true,
          needsHuman: false,
          rationale: 'Small isolated code change.',
        },
        {
          issueNumber: 999,
          confidence: 0.99,
          suggestedLabels: ['complexity:large'],
          suggestedAgent: null,
          shouldStart: false,
          needsHuman: true,
          rationale: 'No matching local candidate.',
        },
      ],
    });
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Triaged issue',
      body: 'Body',
      labels: ['bug', 'complexity:small', 'blast:low', 'shipcode:agent:codex'],
      assignee: null,
      state: 'open',
      author: null,
    });
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp' })),
      },
      settings: {
        get: vi.fn(() => ({
          triageModel: 'openrouter',
          triageModelId: 'openrouter/anthropic/claude-sonnet-4.5',
          triageAutoApplyThreshold: 0.8,
        })),
      },
      githubIssues: {
        list: vi.fn(() => [
          eligibleIssue,
          { ...baseIssue, issueNumber: 43, pipelineStatus: 'executing' },
          { ...baseIssue, issueNumber: -44, isQuickMode: true },
        ]),
        upsert: vi.fn(),
      },
    };

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

    const triage = handlers.get('github:triage-issues');
    if (!triage) throw new Error('github:triage-issues handler not registered');

    await expect(triage(undefined, { projectId: 'project-1' })).resolves.toEqual({
      provider: 'openrouter',
      modelId: 'openrouter/anthropic/claude-sonnet-4.5',
      resolvedModel: 'anthropic/claude-sonnet-4.5',
      consideredCount: 1,
      appliedCount: 1,
      skippedCount: 0,
      threshold: 0.8,
      issues: [
        expect.objectContaining({
          issueNumber: 42,
          applied: true,
          suggestedAgent: 'codex',
        }),
      ],
    });

    expect(ensureLabelsMock).toHaveBeenCalled();
    expect(triageGitHubIssuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: [eligibleIssue],
      }),
    );
    expect(syncIssueLabelsMock).toHaveBeenCalledWith(
      42,
      ['bug', 'complexity:small', 'blast:low', 'shipcode:agent:codex'],
      { removeAgentLabels: true },
    );
    expect(queries.githubIssues.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 42, title: 'Triaged issue' }),
    );
  });

  it('returns an empty triage summary when no issues are eligible', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp' })),
      },
      settings: {
        get: vi.fn(() => ({
          triageModel: 'openrouter',
          triageModelId: 'openrouter/auto',
          triageAutoApplyThreshold: 0.75,
        })),
      },
      githubIssues: {
        list: vi.fn(() => [
          { ...baseIssue, pipelineStatus: 'executing' },
          { ...baseIssue, issueNumber: -44, isQuickMode: true },
        ]),
      },
    };

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

    const triage = handlers.get('github:triage-issues');
    if (!triage) throw new Error('github:triage-issues handler not registered');

    await expect(triage(undefined, { projectId: 'project-1' })).resolves.toEqual({
      provider: 'openrouter',
      modelId: 'openrouter/auto',
      resolvedModel: 'openrouter/auto',
      consideredCount: 0,
      appliedCount: 0,
      skippedCount: 0,
      threshold: 0.75,
      issues: [],
    });
    expect(triageGitHubIssuesMock).not.toHaveBeenCalled();
  });

  it('rejects triage when the project is missing or the repo path is gone', async () => {
    const queries = {
      projects: {
        getById: vi
          .fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce({ ...baseProject, path: '/tmp/shipcode-missing-path' }),
      },
      settings: {
        get: vi.fn(() => ({
          triageModel: 'openrouter',
          triageModelId: 'openrouter/auto',
          triageAutoApplyThreshold: 0.75,
        })),
      },
      githubIssues: {
        list: vi.fn(() => []),
      },
    };

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

    const triage = handlers.get('github:triage-issues');
    if (!triage) throw new Error('github:triage-issues handler not registered');

    await expect(triage(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project project-1 not found',
    );
    await expect(triage(undefined, { projectId: 'project-1' })).rejects.toThrow(
      'Project path no longer exists: /tmp/shipcode-missing-path',
    );
    expect(triageGitHubIssuesMock).not.toHaveBeenCalled();
  });

  it('rejects comment actions for quick tasks before calling GitHub', async () => {
    const quickIssue = { ...baseIssue, issueNumber: -1_123, isQuickMode: true };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries(
        {
          getByNumber: vi.fn(() => quickIssue),
        },
        [quickIssue],
      ),
      threads: {
        getById: vi.fn(() => null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    };

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

    const listComments = handlers.get('github:list-comments');
    const addComment = handlers.get('github:add-comment');
    if (!listComments || !addComment) throw new Error('comment handlers not registered');

    await expect(
      addComment(undefined, { projectId: 'project-1', issueNumber: -1_123, body: 'nope' }),
    ).rejects.toThrow('Quick tasks have no GitHub issue');
    await expect(
      listComments(undefined, { projectId: 'project-1', issueNumber: -1_123, force: true }),
    ).rejects.toThrow('Quick tasks have no GitHub issue');
    expect(addIssueCommentMock).not.toHaveBeenCalled();
    expect(listIssueCommentsMock).not.toHaveBeenCalled();
  });

  it('rejects comment actions when project or issue records are missing', async () => {
    const missingProjectQueries = {
      projects: {
        getById: vi.fn(() => null),
      },
      githubIssues: buildGithubIssuesQueries(),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: missingProjectQueries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const addCommentMissingProject = handlers.get('github:add-comment');
    const listCommentsMissingProject = handlers.get('github:list-comments');
    if (!addCommentMissingProject || !listCommentsMissingProject) {
      throw new Error('comment handlers not registered');
    }

    await expect(
      addCommentMissingProject(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        body: 'hello',
      }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      listCommentsMissingProject(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        force: true,
      }),
    ).rejects.toThrow('Project project-1 not found');

    handlers.clear();
    const missingIssueQueries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: buildGithubIssuesQueries({
        getByNumber: vi.fn(() => null),
      }),
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: missingIssueQueries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const addCommentMissingIssue = handlers.get('github:add-comment');
    const listCommentsMissingIssue = handlers.get('github:list-comments');
    if (!addCommentMissingIssue || !listCommentsMissingIssue) {
      throw new Error('comment handlers not registered');
    }

    await expect(
      addCommentMissingIssue(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        body: 'hello',
      }),
    ).rejects.toThrow('Issue #42 not found in project project-1');
    await expect(
      listCommentsMissingIssue(undefined, { projectId: 'project-1', issueNumber: 42, force: true }),
    ).rejects.toThrow('Issue #42 not found in project project-1');

    expect(addIssueCommentMock).not.toHaveBeenCalled();
    expect(listIssueCommentsMock).not.toHaveBeenCalled();
  });

  it('rewrites a real GitHub issue as a structured PRD and updates the local cache', async () => {
    const rewrittenIssue = {
      number: 42,
      title: 'Issue title',
      body: 'Enhanced PRD',
      labels: ['feature'],
      assignee: null,
      state: 'open',
      author: { login: 'octocat' },
    };
    getIssueMock
      .mockResolvedValueOnce({
        number: 42,
        title: 'Issue title',
        body: 'rough draft',
        labels: ['feature'],
        assignee: null,
        state: 'open',
        author: { login: 'octocat' },
      })
      .mockResolvedValueOnce(rewrittenIssue);
    enhancePrdDraftMock.mockResolvedValue({ body: 'Enhanced PRD' });
    const refreshedIssue = { ...baseIssue, body: 'Enhanced PRD', labels: ['feature'] };
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', notifyGithubUser: 'vincent' })),
      },
      settings: {
        get: vi.fn(() => ({
          prdRewriteCli: 'claude',
          prdRewriteClaudeModel: null,
          prdRewriteCodexModel: null,
          prdRewriteReasoningEffort: 'high',
        })),
      },
      githubIssues: {
        getByNumber: vi.fn().mockReturnValueOnce(baseIssue).mockReturnValue(refreshedIssue),
        upsert: vi.fn(),
        list: vi.fn(() => [refreshedIssue]),
      },
    };

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

    const rewriteIssue = handlers.get('github:rewrite-issue');
    if (!rewriteIssue) throw new Error('github:rewrite-issue handler not registered');

    await expect(
      rewriteIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).resolves.toBe(refreshedIssue);

    expect(checkCliModelCapabilitiesMock).toHaveBeenCalled();
    expect(enhancePrdDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftBody: 'rough draft',
        cwd: '/tmp',
        cli: 'claude',
        modelId: null,
        reasoningEffort: 'high',
      }),
    );
    expect(editIssueMock).toHaveBeenCalledWith({
      issueNumber: 42,
      title: 'Issue title',
      body: 'Enhanced PRD',
      labels: ['feature'],
    });
    expect(addIssueCommentMock).toHaveBeenCalledWith(
      42,
      expect.stringContaining('@octocat @vincent'),
    );
    expect(queries.githubIssues.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 42, body: 'Enhanced PRD' }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [refreshedIssue],
    });
  });

  it('rejects rewrite when records are missing or the cache is not refreshed', async () => {
    const missingProjectQueries = {
      projects: {
        getById: vi.fn(() => null),
      },
      githubIssues: {
        getByNumber: vi.fn(() => baseIssue),
      },
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: missingProjectQueries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const rewriteMissingProject = handlers.get('github:rewrite-issue');
    if (!rewriteMissingProject) throw new Error('github:rewrite-issue handler not registered');
    await expect(
      rewriteMissingProject(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Project project-1 not found');

    handlers.clear();
    const missingIssueQueries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn(() => null),
      },
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: missingIssueQueries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const rewriteMissingIssue = handlers.get('github:rewrite-issue');
    if (!rewriteMissingIssue) throw new Error('github:rewrite-issue handler not registered');
    await expect(
      rewriteMissingIssue(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Issue #42 not found in project project-1');

    handlers.clear();
    getIssueMock
      .mockResolvedValueOnce({
        number: 42,
        title: 'Issue title',
        body: null,
        labels: [],
        assignee: null,
        state: 'open',
        author: null,
      })
      .mockResolvedValueOnce({
        number: 42,
        title: 'Issue title',
        body: 'Enhanced PRD',
        labels: [],
        assignee: null,
        state: 'open',
        author: null,
      });
    const staleCacheQueries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: '/tmp', notifyGithubUser: null })),
      },
      settings: {
        get: vi.fn(() => ({
          prdRewriteCli: 'codex',
          prdRewriteClaudeModel: null,
          prdRewriteCodexModel: null,
          prdRewriteReasoningEffort: 'medium',
        })),
      },
      githubIssues: {
        getByNumber: vi.fn().mockReturnValueOnce(baseIssue).mockReturnValue(null),
        upsert: vi.fn(),
        list: vi.fn(() => []),
      },
    };

    registerGitHubHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: staleCacheQueries as never,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });

    const rewriteStaleCache = handlers.get('github:rewrite-issue');
    if (!rewriteStaleCache) throw new Error('github:rewrite-issue handler not registered');
    await expect(
      rewriteStaleCache(undefined, { projectId: 'project-1', issueNumber: 42 }),
    ).rejects.toThrow('Issue #42 not found in cache after rewrite');
    expect(enhancePrdDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftBody: '',
        cli: 'codex',
        modelId: null,
      }),
    );
    expect(addIssueCommentMock).toHaveBeenCalledWith(42, expect.not.stringContaining('@octocat'));
  });

  describe('github:refresh-issues priority sync', () => {
    const projectWithBoard = {
      ...baseProject,
      // os.tmpdir() always exists, satisfies fs.existsSync() check.
      path: '/tmp',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
    };

    const projectWithoutBoard = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: null,
      githubStatusMapping: null,
    };

    function buildQueries(project: typeof projectWithBoard | typeof projectWithoutBoard) {
      let currentProject = { ...project };
      const cachedAfterUpsert = [{ ...baseIssue, fetchedAt: new Date().toISOString() }];
      return {
        projects: {
          getById: vi.fn(() => currentProject),
          updateGithubRepoIdentity: vi.fn(),
          updateGithubProjectUrl: vi.fn((_projectId: string, githubProjectUrl: string | null) => {
            currentProject = { ...currentProject, githubProjectUrl } as typeof currentProject;
          }),
          setGithubStatusMapping: vi.fn((_projectId: string, githubStatusMapping: unknown) => {
            currentProject = {
              ...currentProject,
              githubStatusMapping: githubStatusMapping as never,
            };
          }),
          clearGithubStatusMapping: vi.fn(() => {
            currentProject = { ...currentProject, githubStatusMapping: null };
          }),
        },
        githubIssues: buildGithubIssuesQueries({
          list: vi
            .fn()
            // First call: cache check (empty so we proceed past TTL gate).
            .mockReturnValueOnce([])
            // Subsequent calls: post-upsert + final list-for-broadcast.
            .mockReturnValue(cachedAfterUpsert),
          upsert: vi.fn(() => baseIssue),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
        }),
        issueEdges: {
          replaceBodyEdges: vi.fn(),
        },
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
    }

    it('calls setPriority for each issue when githubProjectUrl is set', async () => {
      const queries = buildQueries(projectWithBoard);
      fetchProjectPrioritiesMock.mockResolvedValue({
        priorities: new Map([[42, { rank: 'p0' as const, raw: 'P0' }]]),
        issueTypes: new Map(),
        archivedIssueNumbers: new Set(),
      });
      listAllIssuesMock.mockResolvedValue([]);

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

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('github:refresh-issues handler not registered');
      await refresh(undefined, { projectId: 'project-1', force: true });

      expect(fetchProjectPrioritiesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp',
          projectUrl: projectWithBoard.githubProjectUrl,
        }),
      );
      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({
          id: baseIssue.id,
          rank: 'p0',
          raw: 'P0',
        }),
      );
    });

    it('does NOT call fetchProjectPriorities when githubProjectUrl is null', async () => {
      const queries = buildQueries(projectWithoutBoard);
      listAllIssuesMock.mockResolvedValue([]);

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

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('github:refresh-issues handler not registered');
      await refresh(undefined, { projectId: 'project-1', force: true });

      expect(fetchProjectPrioritiesMock).not.toHaveBeenCalled();
      expect(queries.githubIssues.setPriority).not.toHaveBeenCalled();
    });

    it('backfills the repository-associated GitHub Project before refreshing', async () => {
      const queries = buildQueries(projectWithoutBoard);
      const projectUrl = 'https://github.com/orgs/acme/projects/1';
      const mapping = {
        todo: { name: 'Backlog', color: 'GRAY' },
        inProgress: { name: 'In Progress', color: 'YELLOW' },
        humanReview: { name: 'Human Review', color: 'BLUE' },
        deferred: { name: 'Deferred', color: 'GRAY' },
        done: { name: 'Done', color: 'PURPLE' },
      };
      getRepoMetadataMock.mockResolvedValueOnce({
        githubRepoId: 'repo-1',
        githubRepoFullName: 'acme/repo',
        githubProjectUrl: projectUrl,
      });
      validateProjectStatusFieldMock.mockResolvedValueOnce({ ok: true, mapping });
      listAllIssuesMock.mockResolvedValue([]);

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

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('github:refresh-issues handler not registered');
      await refresh(undefined, { projectId: 'project-1', force: true });

      expect(queries.projects.updateGithubProjectUrl).toHaveBeenCalledWith(
        projectWithoutBoard.id,
        projectUrl,
      );
      expect(queries.projects.setGithubStatusMapping).toHaveBeenCalledWith(
        projectWithoutBoard.id,
        mapping,
      );
      expect(fetchProjectPrioritiesMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectUrl }),
      );
      expect(fetchProjectStatusesMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectUrl }),
      );
    });

    it('swallows fetchProjectPriorities errors so refresh still completes', async () => {
      const queries = buildQueries(projectWithBoard);
      fetchProjectPrioritiesMock.mockRejectedValue(new Error('boom'));
      listAllIssuesMock.mockResolvedValue([]);

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

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('github:refresh-issues handler not registered');

      // Should resolve without throwing despite the GraphQL failure.
      await expect(refresh(undefined, { projectId: 'project-1', force: true })).resolves.toEqual(
        expect.any(Array),
      );
      expect(queries.githubIssues.setPriority).not.toHaveBeenCalled();
    });

    it('writes null priority for issues missing from the priorities map', async () => {
      const queries = buildQueries(projectWithBoard);
      // Empty priority map — the issue is on the project but has no Priority field set.
      fetchProjectPrioritiesMock.mockResolvedValue({
        priorities: new Map(),
        issueTypes: new Map(),
        archivedIssueNumbers: new Set(),
      });
      listAllIssuesMock.mockResolvedValue([]);

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

      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('github:refresh-issues handler not registered');
      await refresh(undefined, { projectId: 'project-1', force: true });

      expect(queries.githubIssues.setPriority).toHaveBeenCalledWith(
        expect.objectContaining({
          id: baseIssue.id,
          rank: null,
          raw: null,
        }),
      );
      expect(queries.githubIssues.reconcileCompletedFromEvidence).toHaveBeenCalledWith(
        baseIssue.id,
      );
    });
  });

  describe('github:refresh-issues triage rules', () => {
    const project = {
      ...baseProject,
      path: '/tmp',
      githubProjectUrl: null,
      githubStatusMapping: null,
    };

    const matchingRule = {
      id: 'rule-1',
      projectId: 'project-1',
      orderIndex: 0,
      name: 'bug rule',
      enabled: true,
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'issue' }] },
      actions: { addLabels: ['agent:claude'], removeLabels: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const ghIssue = {
      number: 42,
      title: 'Issue title',
      body: 'Issue body',
      labels: [],
      assignee: null,
      state: 'open' as const,
      updatedAt: '2026-05-08T00:00:00.000Z',
      url: 'https://github.com/acme/repo/issues/42',
    };

    function buildTriageQueries(upsertRecord: Record<string, unknown>) {
      return {
        projects: {
          getById: vi.fn(() => project),
          updateGithubRepoIdentity: vi.fn(),
        },
        triageRules: { list: vi.fn(() => [matchingRule]) },
        githubIssues: buildGithubIssuesQueries({
          list: vi.fn().mockReturnValueOnce([]).mockReturnValue([upsertRecord]),
          // The issue is newly discovered: no existing cache row.
          getByNumber: vi.fn(() => null),
          upsert: vi.fn(() => upsertRecord),
          markClosedOnClose: vi.fn(),
          updateState: vi.fn(),
          clearArchivedAt: vi.fn(),
          setPriority: vi.fn(),
          setIssueType: vi.fn(),
        }),
        issueEdges: { replaceBodyEdges: vi.fn() },
        threads: {
          getById: vi.fn(() => null),
          getByProjectAndGithubIssue: vi.fn(() => null),
        },
      };
    }

    function registerWith(queries: ReturnType<typeof buildTriageQueries>) {
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
      const refresh = handlers.get('github:refresh-issues');
      if (!refresh) throw new Error('github:refresh-issues handler not registered');
      return refresh;
    }

    it('applies the first matching rule once and syncs refreshed labels back', async () => {
      const upsertRecord = { ...baseIssue, id: 'issue-1', issueNumber: 42, labels: [] };
      const queries = buildTriageQueries(upsertRecord);
      listAllIssuesMock.mockResolvedValue([ghIssue]);
      applyIssueLabelActionsMock.mockResolvedValueOnce({
        added: ['agent:claude'],
        removed: [],
        skipped: [],
      });
      getIssueMock.mockResolvedValueOnce({ ...ghIssue, labels: ['agent:claude'] });

      const refresh = registerWith(queries);
      await expect(refresh(undefined, { projectId: 'project-1', force: true })).resolves.toEqual([
        upsertRecord,
      ]);

      expect(applyIssueLabelActionsMock).toHaveBeenCalledWith(42, matchingRule.actions);
      expect(queries.githubIssues.markTriageRulesApplied).toHaveBeenCalledWith('issue-1');
      expect(queries.githubIssues.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ issueNumber: 42, labels: ['agent:claude'] }),
      );
    });

    it('records a triage failure without rejecting the refresh', async () => {
      const upsertRecord = { ...baseIssue, id: 'issue-1', issueNumber: 42, labels: [] };
      const queries = buildTriageQueries(upsertRecord);
      listAllIssuesMock.mockResolvedValue([ghIssue]);
      applyIssueLabelActionsMock.mockRejectedValueOnce(new Error('gh: label not found'));

      const refresh = registerWith(queries);
      await expect(
        refresh(undefined, { projectId: 'project-1', force: true }),
      ).resolves.toBeDefined();

      expect(queries.githubIssues.recordTriageRulesFailure).toHaveBeenCalledTimes(1);
      expect(queries.githubIssues.recordTriageRulesFailure).toHaveBeenCalledWith(
        'issue-1',
        expect.stringContaining('label not found'),
      );
      expect(queries.githubIssues.markTriageRulesApplied).not.toHaveBeenCalled();
    });

    it('records an outer triage sync failure after rules were marked applied', async () => {
      const upsertRecord = { ...baseIssue, id: 'issue-1', issueNumber: 42, labels: [] };
      const queries = buildTriageQueries(upsertRecord);
      queries.githubIssues.upsert = vi
        .fn()
        .mockReturnValueOnce(upsertRecord)
        .mockImplementationOnce(() => {
          throw new Error('sqlite write failed');
        });
      listAllIssuesMock.mockResolvedValue([ghIssue]);
      applyIssueLabelActionsMock.mockResolvedValueOnce({
        added: ['agent:claude'],
        removed: [],
        skipped: [],
      });
      getIssueMock.mockResolvedValueOnce({ ...ghIssue, labels: ['agent:claude'] });

      const refresh = registerWith(queries);
      await expect(
        refresh(undefined, { projectId: 'project-1', force: true }),
      ).resolves.toBeDefined();

      expect(queries.githubIssues.markTriageRulesApplied).toHaveBeenCalledWith('issue-1');
      expect(queries.githubIssues.recordTriageRulesFailure).toHaveBeenCalledWith(
        'issue-1',
        expect.stringContaining('sqlite write failed'),
      );
    });

    it('skips issues whose rules were already applied', async () => {
      const upsertRecord = {
        ...baseIssue,
        id: 'issue-1',
        issueNumber: 42,
        rulesAppliedAt: '2026-05-01T00:00:00.000Z',
      };
      const queries = buildTriageQueries(upsertRecord);
      listAllIssuesMock.mockResolvedValue([ghIssue]);

      const refresh = registerWith(queries);
      await refresh(undefined, { projectId: 'project-1', force: true });

      expect(applyIssueLabelActionsMock).not.toHaveBeenCalled();
      expect(queries.githubIssues.markTriageRulesApplied).not.toHaveBeenCalled();
    });

    it('does not reject the refresh when a triage DB write throws', async () => {
      const upsertRecord = { ...baseIssue, id: 'issue-1', issueNumber: 42, labels: [] };
      const queries = buildTriageQueries(upsertRecord);
      // Non-matching rule drives the no-match path, where markTriageRulesApplied
      // is called outside applyTriageRulesOnce's try/catch.
      queries.triageRules.list = vi.fn(() => [
        {
          ...matchingRule,
          conditions: {
            operator: 'any' as const,
            items: [{ kind: 'title_contains' as const, value: 'zzz-no-match' }],
          },
        },
      ]);
      queries.githubIssues.markTriageRulesApplied = vi.fn(() => {
        throw new Error('database is locked');
      });
      listAllIssuesMock.mockResolvedValue([ghIssue]);

      const refresh = registerWith(queries);
      await expect(
        refresh(undefined, { projectId: 'project-1', force: true }),
      ).resolves.toBeDefined();
      expect(queries.githubIssues.markTriageRulesApplied).toHaveBeenCalled();
    });
  });
});
