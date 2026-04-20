import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPipelineHandlers } from './register-pipeline-handlers';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}));

const PLAN_JSON = JSON.stringify({
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Test plan',
  files: [],
  steps: [{ order: 1, description: 'step', files: [], rationale: 'r' }],
  acceptanceCriteria: ['works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
});

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Fix bug',
    prompt: 'Fix it',
    status: 'awaiting_approval',
    kind: 'pipeline' as const,
    worktreeBranch: null,
    worktreePath: '/tmp/worktree',
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'acme/repo',
    lastError: null,
    failurePhase: null,
    failureCount: 0,
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
    ...overrides,
  };
}

describe('registerPipelineHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };

  let queries: {
    threads: {
      getById: ReturnType<typeof vi.fn>;
      updateStatus: ReturnType<typeof vi.fn>;
      resetFailureTracking: ReturnType<typeof vi.fn>;
    };
    plans: {
      getLatest: ReturnType<typeof vi.fn>;
      getLatestStructured: ReturnType<typeof vi.fn>;
      getLatestStructuredForIssue: ReturnType<typeof vi.fn>;
      getMaxVersion: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateStructured: ReturnType<typeof vi.fn>;
      updateStatus: ReturnType<typeof vi.fn>;
      supersedeAll: ReturnType<typeof vi.fn>;
    };
    projects: {
      getById: ReturnType<typeof vi.fn>;
    };
    githubIssues: {
      getByNumber: ReturnType<typeof vi.fn>;
    };
    settings: {
      get: ReturnType<typeof vi.fn>;
    };
    terminalEvents: {
      listByThread: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    verifications: {
      getLatest: ReturnType<typeof vi.fn>;
    };
    reviews: {
      getByPlanId: ReturnType<typeof vi.fn>;
    };
    activity: {
      listRecent: ReturnType<typeof vi.fn>;
      countRecent: ReturnType<typeof vi.fn>;
    };
    dashboard: {
      getStats: ReturnType<typeof vi.fn>;
      getRecentTasks: ReturnType<typeof vi.fn>;
      countRecentTasks: ReturnType<typeof vi.fn>;
    };
    costs: {
      getSummary: ReturnType<typeof vi.fn>;
      listTasks: ReturnType<typeof vi.fn>;
      countTasks: ReturnType<typeof vi.fn>;
    };
    checkpoints: {
      list: ReturnType<typeof vi.fn>;
    };
  };

  let pipeline: {
    listActive: ReturnType<typeof vi.fn>;
    startExecution: ReturnType<typeof vi.fn>;
    rehydrateContext: ReturnType<typeof vi.fn>;
  };

  let notificationService: {
    dismissByThread: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();

    queries = {
      threads: {
        getById: vi.fn(() => makeThread()),
        updateStatus: vi.fn(),
        resetFailureTracking: vi.fn(),
      },
      plans: {
        getLatest: vi.fn(() => ({
          id: 'plan-1',
          threadId: 'thread-1',
          version: 1,
          rawOutput: `\`\`\`shipcode-plan\n${PLAN_JSON}\n\`\`\``,
          structured: JSON.parse(PLAN_JSON),
          status: 'awaiting_approval',
          createdAt: new Date().toISOString(),
        })),
        getLatestStructured: vi.fn(() => null),
        getLatestStructuredForIssue: vi.fn(() => null),
        getMaxVersion: vi.fn(() => 0),
        create: vi.fn(),
        updateStructured: vi.fn(),
        updateStatus: vi.fn(),
        supersedeAll: vi.fn(),
      },
      projects: {
        getById: vi.fn(() => ({
          id: 'project-1',
          name: 'Test Repo',
          path: '/tmp/project',
          gitRemote: 'https://github.com/acme/repo.git',
          defaultBranch: 'main',
        })),
      },
      githubIssues: {
        getByNumber: vi.fn(() => null),
      },
      settings: {
        get: vi.fn(() => ({
          requireApproval: false,
          maxReviewRounds: 2,
          maxConcurrentPipelines: 3,
        })),
      },
      terminalEvents: {
        listByThread: vi.fn(() => []),
        create: vi.fn(),
      },
      verifications: {
        getLatest: vi.fn(() => null),
      },
      reviews: {
        getByPlanId: vi.fn(() => null),
      },
      activity: {
        listRecent: vi.fn(() => []),
        countRecent: vi.fn(() => 0),
      },
      dashboard: {
        getStats: vi.fn(() => ({
          agentsRunning: 0,
          runningByPhase: {},
          agentsRunningByProject: {},
          tasksInProgress: 0,
          tasksOpen: 0,
          tasksBlocked: 0,
          pendingApprovals: 0,
          staleApprovals: 0,
          shippedLast7d: 0,
          failedLast7d: 0,
        })),
        getRecentTasks: vi.fn(() => []),
        countRecentTasks: vi.fn(() => 0),
      },
      costs: {
        getSummary: vi.fn(() => ({})),
        listTasks: vi.fn(() => []),
        countTasks: vi.fn(() => 0),
      },
      checkpoints: {
        list: vi.fn(() => []),
      },
    };

    pipeline = {
      listActive: vi.fn(() => []),
      startExecution: vi.fn(async () => undefined),
      rehydrateContext: vi.fn(),
    };

    notificationService = {
      dismissByThread: vi.fn(),
    };

    registerPipelineHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: { emit: vi.fn() } as never,
      notificationService: notificationService as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
    });
  });

  describe('pipeline:approve', () => {
    it('calls startExecution with the structured plan', async () => {
      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('marks the plan as approved', async () => {
      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
    });

    it('dismisses notifications on approval', async () => {
      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(notificationService.dismissByThread).toHaveBeenCalledWith('thread-1');
    });

    it('does nothing for a thread not in awaiting_approval', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'executing' }));

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('does nothing when thread is not found', async () => {
      queries.threads.getById.mockReturnValue(null);

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await handler(undefined, { threadId: 'thread-missing' });

      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });
  });

  describe('pipeline:list-active', () => {
    it('returns mapped pipeline summaries', () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: 'proc-1',
        },
      ]);

      const handler = handlers.get('pipeline:list-active');
      if (!handler) throw new Error('pipeline:list-active handler not registered');

      const result = handler(undefined, undefined) as unknown[];
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        threadId: 'thread-1',
        projectId: 'project-1',
        phase: 'executing',
      });
    });

    it('includes awaiting_approval threads in the active list', () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'awaiting_approval',
          startedAt: Date.now(),
          activeProcessId: null,
        },
      ]);

      const handler = handlers.get('pipeline:list-active');
      if (!handler) throw new Error('pipeline:list-active handler not registered');

      const result = handler(undefined, undefined) as Array<{ phase: string }>;
      expect(result[0].phase).toBe('awaiting_approval');
    });
  });
});
