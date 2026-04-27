import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitHubHandlers } from './register-github-handlers';

const { closeIssueMock, reopenIssueMock, listAllIssuesMock, fetchProjectPrioritiesMock } =
  vi.hoisted(() => ({
    closeIssueMock: vi.fn(),
    reopenIssueMock: vi.fn(),
    listAllIssuesMock: vi.fn(async () => [] as Array<unknown>),
    fetchProjectPrioritiesMock: vi.fn(),
  }));

vi.mock('@shipcode/agents', async () => {
  const actual = await vi.importActual<typeof import('@shipcode/agents')>('@shipcode/agents');
  class MockGhCli {
    closeIssue = closeIssueMock;
    reopenIssue = reopenIssueMock;
    listAllIssues = listAllIssuesMock;
    archiveProjectItems = vi.fn(async () => undefined);
  }
  return {
    ...actual,
    GhCli: MockGhCli,
    fetchProjectPriorities: fetchProjectPrioritiesMock,
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
    reopenIssueMock.mockReset();
    listAllIssuesMock.mockReset();
    listAllIssuesMock.mockImplementation(async () => []);
    fetchProjectPrioritiesMock.mockReset();
    fetchProjectPrioritiesMock.mockResolvedValue(new Map());
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

  it('reopens a closed issue and restores awaiting approval from the linked thread state', async () => {
    const closedIssue = {
      ...baseIssue,
      state: 'closed',
      pipelineStatus: 'done',
      threadId: reusableThread.id,
    };
    const restoredIssue = {
      ...closedIssue,
      state: 'open',
      pipelineStatus: 'awaiting_approval',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      githubIssues: {
        getByNumber: vi.fn().mockReturnValueOnce(closedIssue).mockReturnValue(restoredIssue),
        updateState: vi.fn(),
        updatePipelineStatus: vi.fn(),
        clearArchivedAt: vi.fn(),
        linkThread: vi.fn(),
        list: vi.fn(() => [restoredIssue]),
      },
      threads: {
        getById: vi.fn(() => ({ ...reusableThread, status: 'awaiting_approval' })),
        getByProjectAndGithubIssue: vi.fn(() => ({
          ...reusableThread,
          status: 'awaiting_approval',
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
      'awaiting_approval',
    );
    expect(queries.githubIssues.clearArchivedAt).toHaveBeenCalledWith(closedIssue.id);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [restoredIssue],
    });
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
    };

    function buildQueries(project: typeof projectWithBoard | typeof projectWithoutBoard) {
      const cachedAfterUpsert = [{ ...baseIssue, fetchedAt: new Date().toISOString() }];
      return {
        projects: { getById: vi.fn(() => project) },
        githubIssues: {
          list: vi
            .fn()
            // First call: cache check (empty so we proceed past TTL gate).
            .mockReturnValueOnce([])
            // Subsequent calls: post-upsert + final list-for-broadcast.
            .mockReturnValue(cachedAfterUpsert),
          getByNumber: vi.fn(() => baseIssue),
          upsert: vi.fn(() => baseIssue),
          markDoneOnClose: vi.fn(),
          updateState: vi.fn(),
          updatePipelineStatus: vi.fn(),
          clearArchivedAt: vi.fn(),
          linkThread: vi.fn(),
          setPriority: vi.fn(),
        },
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
      fetchProjectPrioritiesMock.mockResolvedValue(
        new Map([[42, { rank: 'p0' as const, raw: 'P0' }]]),
      );
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
      fetchProjectPrioritiesMock.mockResolvedValue(new Map());
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
    });
  });
});
