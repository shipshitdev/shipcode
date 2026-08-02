import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCliPhaseModelsSupported, transitionThreadPhase } from './ipc/helpers';
import { PipelineScheduler } from './pipeline-scheduler';

const { loadWorkflowPolicyMock } = vi.hoisted(() => ({
  loadWorkflowPolicyMock: vi.fn(() => ({
    agent: { maxConcurrentAgents: 10, maxRetryBackoffMs: 300_000, maxConcurrentAgentsByState: {} },
  })),
}));

vi.mock('@shipcode/pipeline', async (importActual) => {
  const actual = (await importActual()) as typeof import('@shipcode/pipeline');
  return {
    ...actual,
    loadWorkflowPolicy: loadWorkflowPolicyMock,
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/shipcode') },
  BrowserWindow: class {},
}));

vi.mock('./logger.service', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('node:fs', async (importActual) => {
  const actual = (await importActual()) as typeof import('node:fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => true) },
    existsSync: vi.fn(() => true),
  };
});

vi.mock('./ipc/helpers', async (importActual) => {
  const actual = (await importActual()) as typeof import('./ipc/helpers');
  return {
    ...actual,
    resolveProjectPhaseModels: vi.fn(() => ({
      plannerModel: 'claude',
      reviewerModel: 'codex',
      verifierModel: 'claude',
      executorModel: 'claude',
      plannerModelId: null,
      reviewerModelId: null,
      executorModelId: null,
      verifierModelId: null,
      plannerReasoningEffort: 'high',
      reviewerReasoningEffort: 'high',
      executorReasoningEffort: 'high',
      verifierReasoningEffort: 'high',
    })),
    assertCliPhaseModelsSupported: vi.fn(async () => undefined),
    transitionThreadPhase: vi.fn(),
  };
});

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Fix bug',
    body: 'Fix the bug in the system',
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
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    name: 'Test Repo',
    path: '/tmp/project',
    gitRemote: 'https://github.com/acme/repo.git',
    githubProjectUrl: null,
    githubStatusMapping: null,
    defaultBranch: 'main',
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
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBaseSettings(overrides: Record<string, unknown> = {}) {
  return {
    maxConcurrentPipelines: 3,
    maxConcurrentExecutions: 3,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'claude',
    executorModel: 'claude',
    plannerReasoningEffort: 'high',
    reviewerReasoningEffort: 'high',
    executorReasoningEffort: 'high',
    verifierReasoningEffort: 'high',
    openrouterPlannerModel: null,
    openrouterReviewerModel: null,
    openrouterVerifierModel: null,
    openrouterExecutorModel: null,
    openrouterDefaultPaidModel: 'openrouter/auto',
    openrouterDefaultFreeModel: 'openrouter/free',
    openrouterExplicitFallback: 'qwen/qwen3.6-plus',
    ...overrides,
  };
}

const makeMainWindow = () => ({
  isDestroyed: vi.fn(() => false),
  webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() },
});

describe('PipelineScheduler', () => {
  let queries: ReturnType<typeof makeQueries>;
  let pipeline: {
    listActive: ReturnType<typeof vi.fn>;
    listActiveInPhases: ReturnType<typeof vi.fn>;
    rehydrateContext: ReturnType<typeof vi.fn>;
    startExecution: ReturnType<typeof vi.fn>;
    startFromGitHubIssue: ReturnType<typeof vi.fn>;
    startFromQuickTask: ReturnType<typeof vi.fn>;
    startFromAutomation: ReturnType<typeof vi.fn>;
    initializeContext: ReturnType<typeof vi.fn>;
    reserveLaunch: ReturnType<typeof vi.fn>;
    releaseLaunch: ReturnType<typeof vi.fn>;
  };
  let mainWindow: ReturnType<typeof makeMainWindow>;
  let scheduler: PipelineScheduler;

  function makeQueries(settingsOverrides: Record<string, unknown> = {}) {
    const wakeQueue: Array<{
      id: string;
      kind: string;
      targetId: string;
      projectId: string | null;
      status: string;
      coalescedCount: number;
      idempotencyKey: string | null;
    }> = [];
    return {
      projects: {
        getById: vi.fn((_id?: string) => makeProject() as ReturnType<typeof makeProject> | null),
      },
      threads: {
        getById: vi.fn(() => null as unknown),
        listAwaitingWithApprovedPlans: vi.fn(() => [] as unknown[]),
        getByProjectAndGithubIssue: vi.fn(() => null),
        create: vi.fn(() => ({
          id: 'thread-new',
          projectId: 'project-1',
          title: 'Fix bug',
          prompt: 'Fix the bug in the system',
          status: 'idle',
          worktreePath: null,
          worktreeBranch: null,
        })),
        updateIssueContent: vi.fn(),
        setGithubIssue: vi.fn(),
        setGithubIssueNumber: vi.fn(),
        setPhaseModels: vi.fn(),
        setAutomationId: vi.fn(),
        resetFailureTracking: vi.fn(),
        hasActiveForAutomation: vi.fn(() => false),
      },
      automations: {
        getById: vi.fn(() => null as unknown),
        recordRunStarted: vi.fn(),
        recordRunFinished: vi.fn(),
      },
      githubIssues: {
        getByNumber: vi.fn(() => makeIssue() as ReturnType<typeof makeIssue> | null),
        updatePipelineStatus: vi.fn(),
        linkThread: vi.fn(),
        list: vi.fn(() => []),
        getNextQueued: vi.fn(() => null as ReturnType<typeof makeIssue> | null),
      },
      wakeRequests: {
        enqueue: vi.fn(
          (input: {
            kind: string;
            targetId: string;
            projectId?: string | null;
            idempotencyKey?: string | null;
          }) => {
            const existing = input.idempotencyKey
              ? wakeQueue.find(
                  (wake) =>
                    wake.idempotencyKey === input.idempotencyKey &&
                    (wake.status === 'pending' || wake.status === 'claimed'),
                )
              : null;
            if (existing) {
              existing.coalescedCount += 1;
              return existing;
            }
            const wake = {
              id: `wake-${wakeQueue.length + 1}`,
              kind: input.kind,
              targetId: input.targetId,
              projectId: input.projectId ?? null,
              status: 'pending',
              coalescedCount: 0,
              idempotencyKey: input.idempotencyKey ?? null,
            };
            wakeQueue.push(wake);
            return wake;
          },
        ),
        peekNextPending: vi.fn((filter?: { kind?: string }) => {
          return (
            wakeQueue.find(
              (wake) => wake.status === 'pending' && (!filter?.kind || wake.kind === filter.kind),
            ) ?? null
          );
        }),
        claim: vi.fn((id: string) => {
          const wake = wakeQueue.find((entry) => entry.id === id && entry.status === 'pending');
          if (!wake) return null;
          wake.status = 'claimed';
          return wake;
        }),
        complete: vi.fn((id: string) => {
          const wake = wakeQueue.find((entry) => entry.id === id);
          if (wake) wake.status = 'completed';
          return wake ?? null;
        }),
        fail: vi.fn((id: string) => {
          const wake = wakeQueue.find((entry) => entry.id === id);
          if (wake) wake.status = 'failed';
          return wake ?? null;
        }),
      },
      settings: {
        get: vi.fn(() => makeBaseSettings(settingsOverrides)),
      },
      plans: {
        getLatest: vi.fn(() => null as unknown),
        supersedeAll: vi.fn(),
        supersedeAllForIssue: vi.fn(),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    loadWorkflowPolicyMock.mockReturnValue({
      agent: {
        maxConcurrentAgents: 10,
        maxRetryBackoffMs: 300_000,
        maxConcurrentAgentsByState: {},
      },
    });
    queries = makeQueries();
    // Backed by a real per-test set, matching `createPipeline` — a stub that
    // always grants would hide a launcher that leaks or double-claims a thread.
    const launchReservations = new Set<string>();
    pipeline = {
      listActive: vi.fn(() => []),
      listActiveInPhases: vi.fn(() => []),
      rehydrateContext: vi.fn(),
      startExecution: vi.fn(async () => undefined),
      startFromGitHubIssue: vi.fn(async () => undefined),
      startFromQuickTask: vi.fn(async () => undefined),
      startFromAutomation: vi.fn(async () => undefined),
      initializeContext: vi.fn(),
      reserveLaunch: vi.fn((threadId: string) => {
        if (launchReservations.has(threadId)) return false;
        launchReservations.add(threadId);
        return true;
      }),
      releaseLaunch: vi.fn((threadId: string) => {
        launchReservations.delete(threadId);
      }),
    };
    mainWindow = makeMainWindow();
    scheduler = new PipelineScheduler({
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      getMainWindow: () => mainWindow as never,
    });
  });

  describe('startOrQueue', () => {
    it('starts the pipeline immediately when a slot is free', async () => {
      pipeline.listActiveInPhases.mockReturnValue([]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(false);
      expect(pipeline.startFromGitHubIssue).toHaveBeenCalled();
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'planning');
    });

    it('queues the issue when all slots are full', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'queued');
    });

    it('throws when project is not found', async () => {
      queries.projects.getById.mockReturnValue(null);

      await expect(scheduler.startOrQueue('project-1', 42)).rejects.toThrow(
        'Project project-1 not found',
      );
    });

    it('throws when issue is not found', async () => {
      queries.githubIssues.getByNumber.mockReturnValue(null);

      await expect(scheduler.startOrQueue('project-1', 42)).rejects.toThrow(
        'Issue #42 not found in cache',
      );
    });

    it('respects a maxConcurrentPipelines of 1', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
    });

    it('falls back to listActive when phase-filtered active summaries are unavailable', async () => {
      pipeline.listActive.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      (pipeline as { listActiveInPhases?: unknown }).listActiveInPhases = undefined;
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('queues when WORKFLOW.md agent.max_concurrent_agents lowers the dispatch cap', async () => {
      loadWorkflowPolicyMock.mockReturnValue({
        agent: {
          maxConcurrentAgents: 1,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: {},
        },
      });
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
      expect(loadWorkflowPolicyMock).toHaveBeenCalledWith('/tmp/project');
    });

    it('rejects issues that already have an active linked thread', async () => {
      queries.githubIssues.getByNumber.mockReturnValue(makeIssue({ threadId: 'thread-active' }));
      queries.threads.getById.mockReturnValue({
        id: 'thread-active',
        projectId: 'project-1',
        title: 'Active thread',
        prompt: 'prompt',
        status: 'planning',
        worktreePath: null,
        worktreeBranch: null,
      });

      await expect(scheduler.startOrQueue('project-1', 42)).rejects.toThrow(
        'Issue #42 already has active thread',
      );
    });

    it('reuses completed linked threads and updates their issue content', async () => {
      const reusableThread = {
        id: 'thread-reusable',
        projectId: 'project-1',
        title: 'Reusable thread',
        prompt: 'old prompt',
        status: 'completed',
        worktreePath: '/tmp/worktree',
        worktreeBranch: 'shipcode/thread-reusable',
      };
      queries.githubIssues.getByNumber.mockReturnValue(
        makeIssue({ body: null, threadId: 'thread-reusable' }),
      );
      queries.threads.getById.mockReturnValue(reusableThread as never);

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(false);
      expect(queries.threads.updateIssueContent).toHaveBeenCalledWith(
        'thread-reusable',
        'Fix bug',
        'Fix bug',
      );
      expect(queries.threads.create).not.toHaveBeenCalled();
    });

    it('does not resurrect an unlinked failed thread when starting a requeued issue', async () => {
      queries.githubIssues.getByNumber.mockReturnValue(makeIssue({ threadId: null }));
      queries.threads.getByProjectAndGithubIssue.mockReturnValue({
        id: 'thread-old-failed',
        projectId: 'project-1',
        title: 'Old failed thread',
        prompt: 'old prompt',
        status: 'failed',
        worktreePath: '/tmp/old-worktree',
        worktreeBranch: 'shipcode/thread-old-failed',
      } as never);

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(false);
      expect(queries.threads.getByProjectAndGithubIssue).not.toHaveBeenCalled();
      expect(queries.threads.create).toHaveBeenCalledWith(
        'project-1',
        'Fix the bug in the system',
        'Fix bug',
      );
      expect(queries.githubIssues.linkThread).toHaveBeenCalledWith('issue-1', 'thread-new');
    });

    it('uses the issue title when creating a thread for an issue with no body', async () => {
      queries.githubIssues.getByNumber.mockReturnValue(makeIssue({ body: null }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(false);
      expect(queries.threads.create).toHaveBeenCalledWith('project-1', 'Fix bug', 'Fix bug');
    });

    it('does not send issue updates when the main window is destroyed', async () => {
      mainWindow.isDestroyed.mockReturnValue(true);
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
      expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('_syncPipelineLabel (ghSync routing)', () => {
    it('routes the GitHub label/status sync through the injected ghSync service', async () => {
      const ghSync = {
        getProject: vi.fn(),
        syncToGithub: vi.fn(async () => undefined),
      };
      scheduler = new PipelineScheduler({
        queries: queries as never,
        pipeline: pipeline as never,
        emitter: { emit: vi.fn() } as never,
        getMainWindow: () => mainWindow as never,
        ghSync,
      });
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
      expect(ghSync.syncToGithub).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: '/tmp/project',
          issueNumber: 42,
          pipelineStatus: 'queued',
        }),
      );
    });

    it('is a no-op when no ghSync service is configured', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      await expect(scheduler.startOrQueue('project-1', 42)).resolves.toEqual(
        expect.objectContaining({ queued: true }),
      );
    });
  });

  describe('startQuickTaskOrQueue', () => {
    const quickIssue = () =>
      makeIssue({
        id: 'quick-issue',
        issueNumber: -1,
        title: 'Local fix',
        body: 'Fix it locally',
        isQuickMode: true,
        threadId: 'thread-quick',
      });

    const quickThread = {
      id: 'thread-quick',
      projectId: 'project-1',
      title: 'Local fix',
      prompt: 'Fix it locally',
      status: 'idle',
      worktreePath: '/tmp/worktree',
      worktreeBranch: 'shipcode/thread-quick',
    };

    beforeEach(() => {
      queries.githubIssues.getByNumber.mockReturnValue(quickIssue());
      queries.threads.getById.mockReturnValue(quickThread);
    });

    it('starts a quick task immediately when a planning slot is free', async () => {
      const result = await scheduler.startQuickTaskOrQueue('project-1', -1);

      expect(result.queued).toBe(false);
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
        'quick-issue',
        'planning',
      );
      expect(queries.threads.setPhaseModels).toHaveBeenCalledWith(
        'thread-quick',
        expect.objectContaining({ executorModel: 'claude' }),
      );
      expect(queries.plans.supersedeAll).toHaveBeenCalledWith('thread-quick');
      expect(pipeline.startFromQuickTask).toHaveBeenCalledWith(
        'thread-quick',
        '/tmp/project',
        { issueNumber: -1, title: 'Local fix', text: 'Fix it locally' },
        'claude',
        expect.objectContaining({
          baseBranch: 'main',
          worktreePath: '/tmp/worktree',
        }),
      );
    });

    it('queues a quick task when all pipeline slots are occupied', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      const result = await scheduler.startQuickTaskOrQueue('project-1', -1);

      expect(result.queued).toBe(true);
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
        'quick-issue',
        'queued',
      );
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('queues a quick task when the planning state cap is full', async () => {
      loadWorkflowPolicyMock.mockReturnValue({
        agent: {
          maxConcurrentAgents: 10,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: { planning: 1 },
        },
      });
      pipeline.listActiveInPhases.mockImplementation((phases: readonly string[]) => {
        const phaseSet = new Set(phases);
        return [
          { threadId: 'a', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        ].filter((summary) => phaseSet.has(summary.phase));
      });

      const result = await scheduler.startQuickTaskOrQueue('project-1', -1);

      expect(result.queued).toBe(true);
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('rejects invalid quick task launch requests before dispatch', async () => {
      queries.projects.getById.mockReturnValueOnce(null);
      await expect(scheduler.startQuickTaskOrQueue('missing-project', -1)).rejects.toThrow(
        'Project missing-project not found',
      );

      queries.projects.getById.mockReturnValue(makeProject());
      queries.githubIssues.getByNumber.mockReturnValueOnce(null);
      await expect(scheduler.startQuickTaskOrQueue('project-1', -1)).rejects.toThrow(
        'Quick task -1 not found in cache',
      );

      queries.githubIssues.getByNumber.mockReturnValueOnce(makeIssue({ isQuickMode: false }));
      await expect(scheduler.startQuickTaskOrQueue('project-1', 42)).rejects.toThrow(
        'Issue #42 is not a quick task',
      );

      queries.githubIssues.getByNumber.mockReturnValueOnce(
        makeIssue({ issueNumber: -1, isQuickMode: true, threadId: null }),
      );
      await expect(scheduler.startQuickTaskOrQueue('project-1', -1)).rejects.toThrow(
        'Quick task -1 has no linked thread',
      );

      queries.githubIssues.getByNumber.mockReturnValueOnce(quickIssue());
      queries.threads.getById.mockReturnValueOnce(null);
      await expect(scheduler.startQuickTaskOrQueue('project-1', -1)).rejects.toThrow(
        'Quick task -1: thread thread-quick missing',
      );

      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('marks the quick task thread failed when quick dispatch rejects', async () => {
      pipeline.startFromQuickTask.mockRejectedValueOnce(new Error('quick failed'));

      await expect(scheduler.startQuickTaskOrQueue('project-1', -1)).rejects.toThrow(
        'quick failed',
      );

      expect(transitionThreadPhase).toHaveBeenCalledWith(
        mainWindow,
        queries,
        expect.anything(),
        expect.objectContaining({
          threadId: 'thread-quick',
          phase: 'failed',
          errorMessage: 'quick failed',
        }),
        undefined,
      );
    });

    it('stamps the sentinel issue number without a github repo association', async () => {
      await scheduler.startQuickTaskOrQueue('project-1', -1);

      expect(queries.threads.setGithubIssueNumber).toHaveBeenCalledWith('thread-quick', -1);
      expect(queries.threads.setGithubIssue).not.toHaveBeenCalled();
    });

    it('marks the quick task thread failed when phase-model validation rejects', async () => {
      vi.mocked(assertCliPhaseModelsSupported).mockRejectedValueOnce(
        new Error('codex CLI not installed'),
      );

      await expect(scheduler.startQuickTaskOrQueue('project-1', -1)).rejects.toThrow(
        'codex CLI not installed',
      );

      // Validation runs inside the shared launcher's try, so the thread is not
      // stranded in `planning` the way the forked quick-task path left it.
      expect(transitionThreadPhase).toHaveBeenCalledWith(
        mainWindow,
        queries,
        expect.anything(),
        expect.objectContaining({
          threadId: 'thread-quick',
          phase: 'failed',
          errorMessage: 'codex CLI not installed',
        }),
        undefined,
      );
      expect(queries.threads.setPhaseModels).not.toHaveBeenCalled();
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('refuses to relaunch a quick task onto an already-running thread', async () => {
      queries.threads.getById.mockReturnValue({ ...quickThread, status: 'executing' });

      await expect(scheduler.startQuickTaskOrQueue('project-1', -1)).rejects.toThrow(
        'Quick task -1 already has active thread',
      );

      expect(queries.githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });
  });

  describe('onSlotFreed', () => {
    const automation = {
      id: 'auto-1',
      projectId: 'project-1',
      targets: ['project-1'],
      name: 'Hourly smoke',
      prompt: 'List 3 files',
      cronExpr: '0 * * * *',
      enabled: true,
      executorProvider: null,
      executorModelId: null,
      executorReasoningEffort: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: null,
      nextRunAt: null,
      runCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('does nothing when no queued issues exist', () => {
      pipeline.listActiveInPhases.mockReturnValue([]);
      queries.githubIssues.getNextQueued.mockReturnValue(null);

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('does nothing when all slots are still occupied', () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('promotes the next queued issue when a slot is free', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'approval', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(
        makeIssue({ id: 'issue-2', issueNumber: 99, title: 'Next task' }),
      );

      scheduler.onSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-2', 'planning');
      expect(queries.threads.create).toHaveBeenCalled();
      expect(pipeline.startFromGitHubIssue).toHaveBeenCalled();
    });

    it('skips promotion if the project for the queued issue no longer exists', () => {
      pipeline.listActiveInPhases.mockReturnValue([]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());
      queries.projects.getById.mockReturnValue(null);

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('links the new thread to the queued issue', () => {
      pipeline.listActiveInPhases.mockReturnValue([]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue({ id: 'issue-queued' }));

      scheduler.onSlotFreed();

      expect(queries.githubIssues.linkThread).toHaveBeenCalledWith('issue-queued', 'thread-new');
    });

    it('promotes a queued automation before queued issues', async () => {
      pipeline.listActiveInPhases.mockReturnValueOnce([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));
      queries.automations.getById.mockReturnValue(automation);

      await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      pipeline.listActiveInPhases.mockReturnValue([]);
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());
      scheduler.onSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(pipeline.startFromAutomation).toHaveBeenCalledWith(
        'thread-new',
        automation.prompt,
        '/tmp/project',
        automation.name,
      );
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('drops queued automation ids when the automation record no longer exists', async () => {
      pipeline.listActiveInPhases.mockReturnValueOnce([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));
      queries.automations.getById.mockReturnValue(null);

      await scheduler.startOrQueueAutomation('missing-auto', 'project-1');

      pipeline.listActiveInPhases.mockReturnValue([]);
      scheduler.onSlotFreed();

      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
      expect(queries.githubIssues.getNextQueued).not.toHaveBeenCalled();
    });

    it('promotes queued quick tasks through the quick-task launcher', async () => {
      const queuedQuickIssue = makeIssue({
        id: 'quick-queued',
        issueNumber: -2,
        title: 'Queued quick',
        body: null,
        isQuickMode: true,
        threadId: 'thread-quick-queued',
      });
      queries.githubIssues.getNextQueued.mockReturnValue(queuedQuickIssue);
      queries.threads.getById.mockReturnValue({
        id: 'thread-quick-queued',
        projectId: 'project-1',
        title: 'Queued quick',
        prompt: 'Queued quick',
        status: 'idle',
        worktreePath: '/tmp/worktree',
        worktreeBranch: 'shipcode/thread-quick-queued',
      });

      scheduler.onSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(pipeline.startFromQuickTask).toHaveBeenCalledWith(
        'thread-quick-queued',
        '/tmp/project',
        { issueNumber: -2, title: 'Queued quick', text: 'Queued quick' },
        'claude',
        expect.objectContaining({ worktreePath: '/tmp/worktree' }),
      );
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('keeps queued automation pending when capacity is still unavailable', async () => {
      const active = [
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ];
      pipeline.listActiveInPhases.mockReturnValue(active);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));
      queries.automations.getById.mockReturnValue(automation);

      await scheduler.startOrQueueAutomation('auto-1', 'project-1');
      scheduler.onSlotFreed();

      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();

      pipeline.listActiveInPhases.mockReturnValue([]);
      scheduler.onSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(pipeline.startFromAutomation).toHaveBeenCalledTimes(1);
    });

    it('logs queued automation promotion failures without throwing', async () => {
      pipeline.listActiveInPhases.mockReturnValueOnce([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));
      queries.automations.getById.mockReturnValue(automation);
      pipeline.startFromAutomation.mockRejectedValueOnce(new Error('automation failed'));

      await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      pipeline.listActiveInPhases.mockReturnValue([]);
      scheduler.onSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(pipeline.startFromAutomation).toHaveBeenCalled();
    });

    it('logs launch errors while promoting queued issues', async () => {
      pipeline.listActiveInPhases.mockReturnValue([]);
      pipeline.startFromGitHubIssue.mockRejectedValueOnce(new Error('launch failed'));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());

      scheduler.onSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(transitionThreadPhase).toHaveBeenCalledWith(
        mainWindow,
        queries,
        expect.anything(),
        expect.objectContaining({
          threadId: 'thread-new',
          phase: 'failed',
          errorMessage: 'launch failed',
        }),
        undefined,
      );
    });

    it('logs unexpected promotion errors without throwing', () => {
      pipeline.listActiveInPhases.mockImplementationOnce(() => {
        throw new Error('count failed');
      });

      expect(() => scheduler.onSlotFreed()).not.toThrow();
      expect(queries.githubIssues.getNextQueued).not.toHaveBeenCalled();
    });
  });

  describe('onExecutionSlotFreed', () => {
    const makeThread = (overrides: Record<string, unknown> = {}) => ({
      id: 'thread-1',
      projectId: 'project-1',
      title: 'Approved waiter',
      prompt: 'prompt',
      status: 'approval',
      worktreePath: null,
      worktreeBranch: null,
      githubIssueNumber: 42,
      githubRepo: 'acme/repo',
      automationId: null,
      autonomous: true,
      reviewRound: 0,
      clarificationRound: 0,
      clarificationRequest: null,
      clarificationAnswers: [],
      verificationRetries: 0,
      baseBranch: 'main',
      forkPointSha: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    const approvedPlan = {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      rawOutput: '',
      structured: { steps: [] },
      status: 'approved',
      createdAt: new Date().toISOString(),
    };

    it('promotes an approved waiter when the project has execution capacity', () => {
      queries.threads.listAwaitingWithApprovedPlans.mockReturnValue([makeThread()]);
      queries.plans.getLatest.mockReturnValue(approvedPlan);

      const promoted = scheduler.onExecutionSlotFreed();

      expect(promoted).toBe(true);
      expect(pipeline.rehydrateContext).toHaveBeenCalledWith('thread-1', '/tmp/project');
      expect(pipeline.startExecution).toHaveBeenCalledWith('thread-1', approvedPlan.structured);
    });

    it('does not promote when that project is already at its execution cap', () => {
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentExecutions: 3 }));
      queries.threads.listAwaitingWithApprovedPlans.mockReturnValue([makeThread()]);
      queries.plans.getLatest.mockReturnValue(approvedPlan);
      pipeline.listActiveInPhases.mockReturnValue([
        {
          threadId: 'a',
          projectId: 'project-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: null,
        },
        {
          threadId: 'b',
          projectId: 'project-1',
          projectPath: '/tmp/project',
          phase: 'testing',
          startedAt: Date.now(),
          activeProcessId: null,
        },
        {
          threadId: 'c',
          projectId: 'project-1',
          projectPath: '/tmp/project',
          phase: 'verifying',
          startedAt: Date.now(),
          activeProcessId: null,
        },
      ]);

      const promoted = scheduler.onExecutionSlotFreed();

      expect(promoted).toBe(false);
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('counts execution capacity by project path when active summaries do not include project ids', () => {
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentExecutions: 1 }));
      queries.threads.listAwaitingWithApprovedPlans.mockReturnValue([makeThread()]);
      queries.plans.getLatest.mockReturnValue(approvedPlan);
      pipeline.listActiveInPhases.mockReturnValue([
        {
          threadId: 'a',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: null,
        },
      ]);

      const promoted = scheduler.onExecutionSlotFreed();

      expect(promoted).toBe(false);
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('skips a full project and promotes the next project with capacity', () => {
      const fullProjectThread = makeThread({ id: 'thread-full', projectId: 'project-1' });
      const openProjectThread = makeThread({
        id: 'thread-open',
        projectId: 'project-2',
        title: 'Open project waiter',
      });
      queries.threads.listAwaitingWithApprovedPlans.mockReturnValue([
        fullProjectThread,
        openProjectThread,
      ]);
      queries.projects.getById.mockImplementation((id?: string) =>
        id === 'project-2'
          ? makeProject({ id: 'project-2', path: '/tmp/project-2' })
          : makeProject(),
      );
      queries.plans.getLatest.mockReturnValue({
        ...approvedPlan,
        threadId: 'thread-open',
      });
      pipeline.listActiveInPhases.mockReturnValue([
        {
          threadId: 'a',
          projectId: 'project-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: null,
        },
        {
          threadId: 'b',
          projectId: 'project-1',
          projectPath: '/tmp/project',
          phase: 'testing',
          startedAt: Date.now(),
          activeProcessId: null,
        },
        {
          threadId: 'c',
          projectId: 'project-1',
          projectPath: '/tmp/project',
          phase: 'verifying',
          startedAt: Date.now(),
          activeProcessId: null,
        },
      ]);

      const promoted = scheduler.onExecutionSlotFreed();

      expect(promoted).toBe(true);
      expect(pipeline.rehydrateContext).toHaveBeenCalledWith('thread-open', '/tmp/project-2');
      expect(pipeline.startExecution).toHaveBeenCalledWith('thread-open', approvedPlan.structured);
    });

    it('skips candidates whose project or latest structured plan is missing', () => {
      queries.threads.listAwaitingWithApprovedPlans.mockReturnValue([
        makeThread({ id: 'missing-project', projectId: 'project-missing' }),
        makeThread({ id: 'missing-plan', projectId: 'project-1' }),
      ]);
      queries.projects.getById.mockImplementation((id?: string) =>
        id === 'project-missing' ? null : makeProject(),
      );
      queries.plans.getLatest.mockReturnValue(null);

      const promoted = scheduler.onExecutionSlotFreed();

      expect(promoted).toBe(false);
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('marks the awaiting thread failed when execution promotion rejects', async () => {
      queries.threads.listAwaitingWithApprovedPlans.mockReturnValue([makeThread()]);
      queries.plans.getLatest.mockReturnValue(approvedPlan);
      pipeline.startExecution.mockRejectedValueOnce(new Error('execute failed'));

      const promoted = scheduler.onExecutionSlotFreed();
      await new Promise((resolve) => setImmediate(resolve));

      expect(promoted).toBe(true);
      expect(transitionThreadPhase).toHaveBeenCalledWith(
        mainWindow,
        queries,
        expect.anything(),
        expect.objectContaining({
          threadId: 'thread-1',
          phase: 'failed',
          errorMessage: 'execute failed',
        }),
        undefined,
      );
    });

    it('returns false when draining awaiting execution candidates throws', () => {
      queries.threads.listAwaitingWithApprovedPlans.mockImplementationOnce(() => {
        throw new Error('db failed');
      });

      expect(scheduler.onExecutionSlotFreed()).toBe(false);
    });

    it('drains one execution slot for each startup candidate until none promote', () => {
      const first = makeThread({ id: 'thread-1' });
      const second = makeThread({ id: 'thread-2' });
      queries.threads.listAwaitingWithApprovedPlans
        .mockReturnValueOnce([first, second])
        .mockReturnValueOnce([first])
        .mockReturnValueOnce([second]);
      queries.plans.getLatest.mockReturnValue(approvedPlan);

      scheduler.drainExecutionQueue();

      expect(pipeline.startExecution).toHaveBeenCalledTimes(2);
    });

    it('stops startup execution draining when a candidate cannot promote', () => {
      const first = makeThread({ id: 'thread-1' });
      queries.threads.listAwaitingWithApprovedPlans
        .mockReturnValueOnce([first])
        .mockReturnValueOnce([first]);
      queries.plans.getLatest.mockReturnValue(null);

      scheduler.drainExecutionQueue();

      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('swallows startup drain errors', () => {
      queries.threads.listAwaitingWithApprovedPlans.mockImplementationOnce(() => {
        throw new Error('startup drain failed');
      });

      expect(() => scheduler.drainExecutionQueue()).not.toThrow();
    });
  });

  describe('per-state concurrency caps', () => {
    it('queues when per-state cap for planning is reached even if global cap has room', async () => {
      loadWorkflowPolicyMock.mockReturnValue({
        agent: {
          maxConcurrentAgents: 10,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: { planning: 1 },
        },
      });
      pipeline.listActiveInPhases.mockImplementation((phases: readonly string[]) => {
        const phaseSet = new Set(phases);
        const all = [
          { threadId: 'a', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
          { threadId: 'b', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        ];
        return all.filter((s) => phaseSet.has(s.phase));
      });
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 10 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('dispatches when per-state cap has room', async () => {
      loadWorkflowPolicyMock.mockReturnValue({
        agent: {
          maxConcurrentAgents: 10,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: { planning: 3 },
        },
      });
      pipeline.listActiveInPhases.mockImplementation((phases: readonly string[]) => {
        const phaseSet = new Set(phases);
        const all = [
          { threadId: 'a', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
          { threadId: 'b', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        ];
        return all.filter((s) => phaseSet.has(s.phase));
      });
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 10 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(false);
      expect(pipeline.startFromGitHubIssue).toHaveBeenCalled();
    });

    it('uses global cap when no per-state cap exists for the phase', async () => {
      loadWorkflowPolicyMock.mockReturnValue({
        agent: {
          maxConcurrentAgents: 10,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: { verify: 1 }, // no cap on planning
        },
      });
      pipeline.listActiveInPhases.mockImplementation((phases: readonly string[]) => {
        const phaseSet = new Set(phases);
        const all = [
          { threadId: 'a', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
          { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
          { threadId: 'c', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        ];
        return all.filter((s) => phaseSet.has(s.phase));
      });
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 10 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      // No per-state cap for planning → global cap (10) governs → dispatch allowed
      expect(result.queued).toBe(false);
    });

    it('onSlotFreed respects per-state cap when promoting queued issues', () => {
      loadWorkflowPolicyMock.mockReturnValue({
        agent: {
          maxConcurrentAgents: 10,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: { planning: 1 },
        },
      });
      pipeline.listActiveInPhases.mockImplementation((phases: readonly string[]) => {
        const phaseSet = new Set(phases);
        const all = [
          { threadId: 'a', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        ];
        return all.filter((s) => phaseSet.has(s.phase));
      });
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 10 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });
  });

  describe('startOrQueueAutomation', () => {
    const automation = {
      id: 'auto-1',
      projectId: 'project-1',
      targets: ['project-1'],
      name: 'Hourly smoke',
      prompt: 'List 3 files',
      cronExpr: '0 * * * *',
      enabled: true,
      executorProvider: null,
      executorModelId: null,
      executorReasoningEffort: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: null,
      nextRunAt: null,
      runCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('launches the automation when capacity is available', async () => {
      pipeline.listActiveInPhases.mockReturnValue([]);
      queries.automations.getById.mockReturnValue(automation);

      const result = await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(result.queued).toBe(false);
      expect(pipeline.startFromAutomation).toHaveBeenCalledWith(
        'thread-new',
        automation.prompt,
        '/tmp/project',
        automation.name,
      );
      expect(queries.automations.recordRunStarted).toHaveBeenCalledWith(
        'auto-1',
        'project-1',
        'thread-new',
      );
    });

    it('queues the automation durably when at capacity', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.automations.getById.mockReturnValue(automation);

      const result = await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(result.queued).toBe(true);
      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
      expect(queries.automations.recordRunStarted).not.toHaveBeenCalled();
    });

    it('does not enqueue duplicates of the same automation id', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.automations.getById.mockReturnValue(automation);

      const [r1, r2] = await Promise.all([
        scheduler.startOrQueueAutomation('auto-1', 'project-1'),
        scheduler.startOrQueueAutomation('auto-1', 'project-1'),
      ]);

      expect(r1.queued).toBe(true);
      expect(r2.queued).toBe(true);
    });

    it('skips an automation that already has an active pipeline', async () => {
      queries.automations.getById.mockReturnValue(automation);
      queries.threads.hasActiveForAutomation.mockReturnValue(true);

      const result = await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(result.queued).toBe(false);
      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
    });

    it('returns without launching when the automation is missing or disabled', async () => {
      queries.automations.getById.mockReturnValueOnce(null);
      await expect(scheduler.startOrQueueAutomation('missing-auto', 'project-1')).resolves.toEqual({
        queued: false,
      });

      queries.automations.getById.mockReturnValueOnce({ ...automation, enabled: false });
      await expect(scheduler.startOrQueueAutomation('auto-1', 'project-1')).resolves.toEqual({
        queued: false,
      });

      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
    });

    it('skips disabled automations after dispatch capacity is available', async () => {
      queries.automations.getById.mockReturnValue({ ...automation, enabled: false });

      const result = await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(result.queued).toBe(false);
      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
      expect(queries.automations.recordRunStarted).not.toHaveBeenCalled();
    });

    it('marks automation failed when its project or project path is missing', async () => {
      queries.automations.getById.mockReturnValue(automation);
      queries.projects.getById.mockReturnValue(null);

      await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(queries.automations.recordRunFinished).toHaveBeenCalledWith(
        'auto-1',
        'project-1',
        'failed',
      );

      queries.automations.recordRunFinished.mockClear();
      queries.projects.getById.mockReturnValue(makeProject());
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);

      await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(queries.automations.recordRunFinished).toHaveBeenCalledWith(
        'auto-1',
        'project-1',
        'failed',
      );
      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
    });

    it('marks automation failed when its selected CLI model is unsupported', async () => {
      queries.automations.getById.mockReturnValue(automation);
      vi.mocked(assertCliPhaseModelsSupported).mockRejectedValueOnce(new Error('unsupported'));

      await scheduler.startOrQueueAutomation('auto-1', 'project-1');

      expect(queries.automations.recordRunFinished).toHaveBeenCalledWith(
        'auto-1',
        'project-1',
        'failed',
      );
      expect(pipeline.startFromAutomation).not.toHaveBeenCalled();
    });

    it('marks the automation thread failed when automation dispatch rejects', async () => {
      queries.automations.getById.mockReturnValue(automation);
      pipeline.startFromAutomation.mockRejectedValueOnce(new Error('automation dispatch failed'));

      await expect(scheduler.startOrQueueAutomation('auto-1', 'project-1')).rejects.toThrow(
        'automation dispatch failed',
      );

      expect(transitionThreadPhase).toHaveBeenCalledWith(
        mainWindow,
        queries,
        expect.anything(),
        expect.objectContaining({
          threadId: 'thread-new',
          phase: 'failed',
          errorMessage: 'automation dispatch failed',
        }),
        undefined,
      );
      expect(queries.automations.recordRunFinished).toHaveBeenCalledWith(
        'auto-1',
        'project-1',
        'failed',
      );
    });
  });
});
