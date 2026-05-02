import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const makeMainWindow = () =>
  ({
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  }) as never;

describe('PipelineScheduler', () => {
  let queries: ReturnType<typeof makeQueries>;
  let pipeline: {
    listActive: ReturnType<typeof vi.fn>;
    listActiveInPhases: ReturnType<typeof vi.fn>;
    rehydrateContext: ReturnType<typeof vi.fn>;
    startExecution: ReturnType<typeof vi.fn>;
    startFromGitHubIssue: ReturnType<typeof vi.fn>;
    startFromAutomation: ReturnType<typeof vi.fn>;
    initializeContext: ReturnType<typeof vi.fn>;
  };
  let mainWindow: ReturnType<typeof makeMainWindow>;
  let scheduler: PipelineScheduler;

  function makeQueries(settingsOverrides: Record<string, unknown> = {}) {
    return {
      projects: {
        getById: vi.fn((_id?: string) => makeProject() as ReturnType<typeof makeProject> | null),
      },
      threads: {
        getById: vi.fn(() => null),
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
    pipeline = {
      listActive: vi.fn(() => []),
      listActiveInPhases: vi.fn(() => []),
      rehydrateContext: vi.fn(),
      startExecution: vi.fn(async () => undefined),
      startFromGitHubIssue: vi.fn(async () => undefined),
      startFromAutomation: vi.fn(async () => undefined),
      initializeContext: vi.fn(),
    };
    mainWindow = makeMainWindow();
    scheduler = new PipelineScheduler({
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      getMainWindow: () => mainWindow,
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
  });

  describe('onSlotFreed', () => {
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
        { threadId: 'b', phase: 'awaiting_approval', startedAt: Date.now(), activeProcessId: null },
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
  });

  describe('onExecutionSlotFreed', () => {
    const makeThread = (overrides: Record<string, unknown> = {}) => ({
      id: 'thread-1',
      projectId: 'project-1',
      title: 'Approved waiter',
      prompt: 'prompt',
      status: 'awaiting_approval',
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

      const result = await scheduler.startOrQueueAutomation('auto-1');

      expect(result.queued).toBe(false);
      expect(pipeline.startFromAutomation).toHaveBeenCalledWith(
        'thread-new',
        automation.prompt,
        '/tmp/project',
        automation.name,
      );
      expect(queries.automations.recordRunStarted).toHaveBeenCalledWith('auto-1', 'thread-new');
    });

    it('queues the automation in-memory when at capacity', async () => {
      pipeline.listActiveInPhases.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.automations.getById.mockReturnValue(automation);

      const result = await scheduler.startOrQueueAutomation('auto-1');

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

      const r1 = await scheduler.startOrQueueAutomation('auto-1');
      const r2 = await scheduler.startOrQueueAutomation('auto-1');

      expect(r1.queued).toBe(true);
      expect(r2.queued).toBe(true);
    });
  });
});
