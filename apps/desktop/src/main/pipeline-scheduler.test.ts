import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineScheduler } from './pipeline-scheduler';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/shipcode') },
  BrowserWindow: class {},
}));

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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBaseSettings(overrides: Record<string, unknown> = {}) {
  return {
    maxConcurrentPipelines: 3,
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
    startFromGitHubIssue: ReturnType<typeof vi.fn>;
  };
  let mainWindow: ReturnType<typeof makeMainWindow>;
  let scheduler: PipelineScheduler;

  function makeQueries(settingsOverrides: Record<string, unknown> = {}) {
    return {
      projects: {
        getById: vi.fn(() => makeProject() as ReturnType<typeof makeProject> | null),
      },
      threads: {
        getById: vi.fn(() => null),
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
        supersedeAll: vi.fn(),
        supersedeAllForIssue: vi.fn(),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    queries = makeQueries();
    pipeline = {
      listActive: vi.fn(() => []),
      startFromGitHubIssue: vi.fn(async () => undefined),
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
      pipeline.listActive.mockReturnValue([]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(false);
      expect(pipeline.startFromGitHubIssue).toHaveBeenCalled();
      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'planning');
    });

    it('queues the issue when all slots are full', async () => {
      pipeline.listActive.mockReturnValue([
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
      pipeline.listActive.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 1 }));

      const result = await scheduler.startOrQueue('project-1', 42);

      expect(result.queued).toBe(true);
    });
  });

  describe('onSlotFreed', () => {
    it('does nothing when no queued issues exist', () => {
      pipeline.listActive.mockReturnValue([]);
      queries.githubIssues.getNextQueued.mockReturnValue(null);

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('does nothing when all slots are still occupied', () => {
      pipeline.listActive.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'planning', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'c', phase: 'reviewing', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('promotes the next queued issue when a slot is free', () => {
      pipeline.listActive.mockReturnValue([
        { threadId: 'a', phase: 'executing', startedAt: Date.now(), activeProcessId: null },
        { threadId: 'b', phase: 'awaiting_approval', startedAt: Date.now(), activeProcessId: null },
      ]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(
        makeIssue({ id: 'issue-2', issueNumber: 99, title: 'Next task' }),
      );

      scheduler.onSlotFreed();

      expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-2', 'planning');
      expect(queries.threads.create).toHaveBeenCalled();
      expect(pipeline.startFromGitHubIssue).toHaveBeenCalled();
    });

    it('skips promotion if the project for the queued issue no longer exists', () => {
      pipeline.listActive.mockReturnValue([]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue());
      queries.projects.getById.mockReturnValue(null);

      scheduler.onSlotFreed();

      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
    });

    it('links the new thread to the queued issue', () => {
      pipeline.listActive.mockReturnValue([]);
      queries.settings.get.mockReturnValue(makeBaseSettings({ maxConcurrentPipelines: 3 }));
      queries.githubIssues.getNextQueued.mockReturnValue(makeIssue({ id: 'issue-queued' }));

      scheduler.onSlotFreed();

      expect(queries.githubIssues.linkThread).toHaveBeenCalledWith('issue-queued', 'thread-new');
    });
  });
});
