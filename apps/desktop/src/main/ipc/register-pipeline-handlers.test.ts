import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPipelineHandlers } from './register-pipeline-handlers';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('../logger.service', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logEvent: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    default: {
      ...actual,
      execFile: execFileMock,
    },
    execFile: execFileMock,
  };
});

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
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'acme/repo',
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
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
    doneAt: null,
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
      clearDoneAt: ReturnType<typeof vi.fn>;
      resetFailureTracking: ReturnType<typeof vi.fn>;
      resolveClarification: ReturnType<typeof vi.fn>;
      clearClarification: ReturnType<typeof vi.fn>;
      clearPendingClarification: ReturnType<typeof vi.fn>;
      setPhaseModels: ReturnType<typeof vi.fn>;
      setGithubPr: ReturnType<typeof vi.fn>;
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
      getByThreadId: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
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
      listByIssue: ReturnType<typeof vi.fn>;
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
      listTasksForIssue: ReturnType<typeof vi.fn>;
    };
    checkpoints: {
      list: ReturnType<typeof vi.fn>;
      getLatest: ReturnType<typeof vi.fn>;
    };
  };

  let pipeline: {
    listActive: ReturnType<typeof vi.fn>;
    startReview: ReturnType<typeof vi.fn>;
    startRevision: ReturnType<typeof vi.fn>;
    startExecution: ReturnType<typeof vi.fn>;
    startTesting: ReturnType<typeof vi.fn>;
    startVerification: ReturnType<typeof vi.fn>;
    startCommitAndPush: ReturnType<typeof vi.fn>;
    startStabilization: ReturnType<typeof vi.fn>;
    rehydrateContext: ReturnType<typeof vi.fn>;
    startPlanGeneration: ReturnType<typeof vi.fn>;
    getContext: ReturnType<typeof vi.fn>;
    initializeContext: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };

  let notificationService: {
    dismissByThread: ReturnType<typeof vi.fn>;
  };
  let emitter: {
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '', '');
      },
    );

    queries = {
      threads: {
        getById: vi.fn(() => makeThread()),
        updateStatus: vi.fn(),
        clearDoneAt: vi.fn(),
        resetFailureTracking: vi.fn(),
        resolveClarification: vi.fn(),
        clearClarification: vi.fn(),
        clearPendingClarification: vi.fn(),
        setPhaseModels: vi.fn(),
        setGithubPr: vi.fn(),
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
        getByThreadId: vi.fn(() => null),
        list: vi.fn(() => []),
      },
      settings: {
        get: vi.fn(() => ({
          requireApproval: false,
          revisionCount: 2,
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
        listByIssue: vi.fn(() => []),
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
        listTasksForIssue: vi.fn(() => []),
      },
      checkpoints: {
        list: vi.fn(() => []),
        getLatest: vi.fn(() => ({
          id: 'checkpoint-1',
          threadId: 'thread-1',
          projectId: 'project-1',
          phase: 'execute',
          reason: 'before retry',
          label: 'Before execute',
          branch: 'shipcode/thread-1',
          commitSha: 'abc123def456',
          createdAt: new Date().toISOString(),
        })),
      },
    };

    pipeline = {
      listActive: vi.fn(() => []),
      startReview: vi.fn(async () => undefined),
      startRevision: vi.fn(async () => undefined),
      startExecution: vi.fn(async () => undefined),
      startTesting: vi.fn(async () => undefined),
      startVerification: vi.fn(async () => undefined),
      startCommitAndPush: vi.fn(async () => undefined),
      startStabilization: vi.fn(async () => undefined),
      rehydrateContext: vi.fn(),
      startPlanGeneration: vi.fn(async () => undefined),
      getContext: vi.fn(() => ({})),
      initializeContext: vi.fn(),
      pause: vi.fn(),
    };

    notificationService = {
      dismissByThread: vi.fn(),
    };

    emitter = {
      emit: vi.fn(),
    };

    registerPipelineHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      emitter: emitter as never,
      notificationService: notificationService as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      resourceMonitor: {} as never,
    });
  });

  describe('terminal:list', () => {
    it('returns persisted terminal events without building fallbacks', () => {
      const persisted = [
        {
          id: 'event-1',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          event: { kind: 'raw' as const, content: 'persisted output' },
        },
      ];
      queries.terminalEvents.listByThread.mockReturnValue(persisted);

      const handler = handlers.get('terminal:list');
      if (!handler) throw new Error('terminal:list handler not registered');

      expect(handler(undefined, { threadId: 'thread-1', limit: 25 })).toBe(persisted);
      expect(queries.plans.getLatest).not.toHaveBeenCalled();
      expect(queries.reviews.getByPlanId).not.toHaveBeenCalled();
      expect(queries.verifications.getLatest).not.toHaveBeenCalled();
    });

    it('builds a sorted limited fallback transcript from plan, review, and verification output', () => {
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-1',
        threadId: 'thread-1',
        version: 1,
        rawOutput: 'plan output',
        structured: JSON.parse(PLAN_JSON),
        status: 'awaiting_approval',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      queries.reviews.getByPlanId.mockReturnValue({
        id: 'review-1',
        planId: 'plan-1',
        rawOutput: 'review output',
        structured: null,
        decision: 'approve',
        createdAt: '2026-01-03T00:00:00.000Z',
      });
      queries.verifications.getLatest.mockReturnValue({
        id: 'verification-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        rawOutput: 'verification output',
        structured: null,
        result: 'failed',
        retryCount: 0,
        createdAt: '2026-01-02T00:00:00.000Z',
      });

      const handler = handlers.get('terminal:list');
      if (!handler) throw new Error('terminal:list handler not registered');

      const result = handler(undefined, { threadId: 'thread-1', limit: 2 }) as Array<{
        id: string;
        event: { kind: string; content: string };
      }>;

      expect(result.map((record) => record.id)).toEqual([
        'fallback-verification-verification-1',
        'fallback-review-review-1',
      ]);
      expect(result.map((record) => record.event.content)).toEqual([
        'verification output',
        'review output',
      ]);
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

    it('throws for a thread not in awaiting_approval', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'executing' }));

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'This task is no longer awaiting approval. Current status: executing.',
      );
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('throws when thread is not found', async () => {
      queries.threads.getById.mockReturnValue(null);

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-missing' })).rejects.toThrow(
        'Thread thread-missing not found',
      );

      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('throws when approval is already confirmed and waiting for execution', async () => {
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-1',
        threadId: 'thread-1',
        version: 1,
        rawOutput: `\`\`\`shipcode-plan\n${PLAN_JSON}\n\`\`\``,
        structured: JSON.parse(PLAN_JSON),
        status: 'approved',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Approval is already confirmed. Waiting for an execution slot.',
      );

      expect(pipeline.startExecution).not.toHaveBeenCalled();
      expect(queries.plans.updateStatus).not.toHaveBeenCalledWith('plan-1', 'approved');
    });
  });

  describe('pipeline:answer-clarification', () => {
    it('stores answers, emits a transcript event, and resumes planning', async () => {
      const clarificationRequest = {
        id: 'clarify-1',
        threadId: 'thread-1',
        phase: 'plan' as const,
        summary: 'Need one choice before planning.',
        questions: [
          {
            id: 'scope',
            title: 'Scope',
            prompt: 'Which scope should the plan target?',
            description: null,
            choices: [
              { id: 'narrow', label: 'Narrow', description: 'Ship the smallest version.' },
              { id: 'wide', label: 'Wide', description: 'Include extra cleanup.' },
            ],
            allowFreeform: false,
            freeformPlaceholder: null,
          },
        ],
      };
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'clarifying',
          clarificationRequest,
          worktreePath: '/tmp/worktree',
        }),
      );

      const handler = handlers.get('pipeline:answer-clarification');
      if (!handler) throw new Error('pipeline:answer-clarification handler not registered');

      await handler(undefined, {
        threadId: 'thread-1',
        answers: [{ questionId: 'scope', selectedChoiceId: 'wide', freeformText: null }],
      });

      expect(queries.threads.resolveClarification).toHaveBeenCalledWith(
        'thread-1',
        clarificationRequest,
        [{ questionId: 'scope', selectedChoiceId: 'wide', freeformText: null }],
      );
      expect(emitter.emit).toHaveBeenCalledWith({
        type: 'terminal:event',
        threadId: 'thread-1',
        event: {
          kind: 'clarification_answered',
          questionCount: 1,
        },
      });
      expect(pipeline.rehydrateContext).toHaveBeenCalledWith('thread-1', '/tmp/project', undefined);
      expect(pipeline.startPlanGeneration).toHaveBeenCalledWith(
        'thread-1',
        'Fix it',
        '/tmp/project',
        '/tmp/worktree',
      );
    });

    it('rejects invalid selected options before resolving the clarification', async () => {
      const clarificationRequest = {
        id: 'clarify-1',
        threadId: 'thread-1',
        phase: 'plan' as const,
        summary: 'Need one choice before planning.',
        questions: [
          {
            id: 'scope',
            title: 'Scope',
            prompt: 'Which scope should the plan target?',
            description: null,
            choices: [{ id: 'narrow', label: 'Narrow', description: 'Ship the smallest version.' }],
            allowFreeform: false,
            freeformPlaceholder: null,
          },
        ],
      };
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'clarifying',
          clarificationRequest,
        }),
      );

      const handler = handlers.get('pipeline:answer-clarification');
      if (!handler) throw new Error('pipeline:answer-clarification handler not registered');

      await expect(
        handler(undefined, {
          threadId: 'thread-1',
          answers: [{ questionId: 'scope', selectedChoiceId: 'wide', freeformText: null }],
        }),
      ).rejects.toThrow('Invalid option selected for "Scope"');

      expect(queries.threads.resolveClarification).not.toHaveBeenCalled();
      expect(pipeline.startPlanGeneration).not.toHaveBeenCalled();
    });
  });

  describe('pipeline:reject', () => {
    it('supersedes the current plan and restarts planning with reviewer feedback', async () => {
      const handler = handlers.get('pipeline:reject');
      if (!handler) throw new Error('pipeline:reject handler not registered');

      await handler(undefined, { threadId: 'thread-1', feedback: 'tighten the scope' });

      expect(pipeline.rehydrateContext).toHaveBeenCalledWith('thread-1', '/tmp/project', undefined);
      expect(queries.plans.supersedeAll).toHaveBeenCalledWith('thread-1');
      expect(notificationService.dismissByThread).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startPlanGeneration).toHaveBeenCalledWith(
        'thread-1',
        'Fix it\n\nFeedback from review:\ntighten the scope',
        '/tmp/project',
        '/tmp/worktree',
      );
    });
  });

  describe('pipeline:pause', () => {
    it('stops an active task and leaves persistent pause metadata to the phase transition', () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'executing' }));

      const handler = handlers.get('pipeline:pause');
      if (!handler) throw new Error('pipeline:pause handler not registered');

      handler(undefined, { threadId: 'thread-1' });

      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'lifecycle',
          message: expect.stringContaining('Paused by user during executing'),
        }),
      );
      expect(pipeline.pause).toHaveBeenCalledWith('thread-1');
    });

    it('rejects phases that cannot be paused', () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'completed' }));

      const handler = handlers.get('pipeline:pause');
      if (!handler) throw new Error('pipeline:pause handler not registered');

      expect(() => handler(undefined, { threadId: 'thread-1' })).toThrow(
        'Cannot pause task while in completed phase',
      );
      expect(pipeline.pause).not.toHaveBeenCalled();
      expect(queries.terminalEvents.create).not.toHaveBeenCalled();
    });
  });

  describe('pipeline:resume', () => {
    it('resumes paused execution with worktree context', async () => {
      const context: { executionResumeContext?: string } = {};
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'executing',
          lastError: 'Paused by user',
        }),
      );
      pipeline.getContext.mockReturnValue(context);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.rehydrateContext).toHaveBeenCalledWith('thread-1', '/tmp/project', undefined);
      expect(notificationService.dismissByThread).toHaveBeenCalledWith('thread-1');
      expect(context.executionResumeContext).toContain('previous execution was paused by the user');
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('continues paused testing from the testing phase', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'testing',
        }),
      );

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startTesting).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('resumes paused planning without requiring a structured plan', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'planning',
          worktreePath: null,
        }),
      );
      queries.plans.getLatest.mockReturnValue(null);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startPlanGeneration).toHaveBeenCalledWith(
        'thread-1',
        'Fix it',
        '/tmp/project',
        null,
      );
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('resumes paused review with the latest structured plan', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'reviewing',
        }),
      );

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startReview).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('resumes paused revision with structured reviewer feedback', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'revising',
        }),
      );
      queries.reviews.getByPlanId.mockReturnValue({
        id: 'review-1',
        planId: 'plan-1',
        rawOutput: 'raw review',
        structured: {
          decision: 'request_changes',
          summary: 'Needs revision',
          suggestedChanges: ['Keep the diff smaller'],
          findings: [
            {
              severity: 'major',
              description: 'Missing regression test',
              suggestion: 'Add a focused Vitest case',
            },
          ],
        },
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startRevision).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.stringContaining('Keep the diff smaller'),
      );
      expect(pipeline.startRevision).toHaveBeenCalledWith(
        'thread-1',
        expect.any(Object),
        expect.stringContaining('[major] Missing regression test - Add a focused Vitest case'),
      );
    });

    it('resumes paused verification and shipping phases directly', async () => {
      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'verifying',
        }),
      );
      await handler(undefined, { threadId: 'thread-1' });
      expect(pipeline.startVerification).toHaveBeenCalledWith('thread-1');

      vi.clearAllMocks();
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'shipping',
        }),
      );
      await handler(undefined, { threadId: 'thread-1' });
      expect(pipeline.startCommitAndPush).toHaveBeenCalledWith('thread-1');
    });

    it('rejects resume when the task is already active', async () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: 'proc-1',
        },
      ]);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Task is already running',
      );
      expect(queries.threads.getById).not.toHaveBeenCalled();
    });

    it('resumes paused revision with raw reviewer output when structured feedback is unavailable', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'revising',
        }),
      );
      queries.reviews.getByPlanId.mockReturnValue({
        id: 'review-1',
        planId: 'plan-1',
        rawOutput: '  raw reviewer feedback  ',
        structured: null,
        decision: 'request_changes',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startRevision).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        'raw reviewer feedback',
      );
    });
  });

  describe('pipeline:stabilize-pr', () => {
    it('starts stabilization for a linked PR with CI or review blockers', async () => {
      queries.githubIssues.getByNumber.mockReturnValue({
        id: 'issue-42',
        projectId: 'project-1',
        number: 42,
        title: 'Fix bug',
        linkedPrNumber: 17,
        linkedPrUrl: 'https://github.com/acme/repo/pull/17',
        ciBlocked: true,
        failingChecks: [{ name: 'test', conclusion: 'failure' }],
        unresolvedReviewCommentCount: 1,
        unresolvedReviewComments: [{ body: 'Please add a regression test' }],
      });

      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.rehydrateContext).toHaveBeenCalledWith('thread-1', '/tmp/project', 'Fix bug');
      expect(notificationService.dismissByThread).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startStabilization).toHaveBeenCalledWith('thread-1', {
        prNumber: 17,
        prUrl: 'https://github.com/acme/repo/pull/17',
        failingChecks: [{ name: 'test', conclusion: 'failure' }],
        unresolvedReviewComments: [{ body: 'Please add a regression test' }],
      });
    });

    it('rejects stabilization when the linked PR has no blockers', async () => {
      queries.githubIssues.getByNumber.mockReturnValue({
        id: 'issue-42',
        projectId: 'project-1',
        number: 42,
        title: 'Fix bug',
        linkedPrNumber: 17,
        linkedPrUrl: 'https://github.com/acme/repo/pull/17',
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewCommentCount: 0,
        unresolvedReviewComments: [],
      });

      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'The linked pull request has no unresolved CI or review blockers',
      );
      expect(pipeline.startStabilization).not.toHaveBeenCalled();
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

    it('marks approved awaiting_approval threads as waiting for execution', () => {
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-1',
        threadId: 'thread-1',
        version: 3,
        rawOutput: '',
        structured: null,
        status: 'approved',
        createdAt: new Date().toISOString(),
      });
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

      const result = handler(undefined, undefined) as Array<{
        approvedAwaitingExecution?: boolean;
      }>;
      expect(result[0].approvedAwaitingExecution).toBe(true);
    });
  });

  describe('pipeline:retry', () => {
    it('resumes from execution when the latest verification failed with structured findings', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.verifications.getLatest.mockReturnValue({
        id: 'verification-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        rawOutput: 'raw',
        structured: {
          threadId: 'thread-1',
          planId: 'plan-1',
          result: 'failed',
          summary: 'Needs changes',
          criteriaResults: [],
          issues: [],
        },
        result: 'failed',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
      expect(pipeline.startVerification).not.toHaveBeenCalled();
    });

    it('re-activates a superseded latest plan before retrying execution', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-1',
        threadId: 'thread-1',
        version: 1,
        rawOutput: `\`\`\`shipcode-plan\n${PLAN_JSON}\n\`\`\``,
        structured: JSON.parse(PLAN_JSON),
        status: 'superseded',
        createdAt: new Date().toISOString(),
      });
      queries.verifications.getLatest.mockReturnValue({
        id: 'verification-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        rawOutput: 'raw',
        structured: {
          threadId: 'thread-1',
          planId: 'plan-1',
          result: 'failed',
          summary: 'Needs changes',
          criteriaResults: [],
          issues: [],
        },
        result: 'failed',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
      expect(queries.plans.updateStatus.mock.invocationCallOrder[0]).toBeLessThan(
        pipeline.startExecution.mock.invocationCallOrder[0],
      );
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('re-runs verification when the latest verification failed without structured findings', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.verifications.getLatest.mockReturnValue({
        id: 'verification-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        rawOutput: 'raw',
        structured: null,
        result: 'failed',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startVerification).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('clears doneAt and continues to commit when the latest verification passed', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({ status: 'failed', doneAt: '2026-01-01T00:00:00.000Z' }),
      );
      queries.verifications.getLatest.mockReturnValue({
        id: 'verification-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        rawOutput: 'raw',
        structured: {
          threadId: 'thread-1',
          planId: 'plan-1',
          result: 'passed',
          summary: 'Looks good',
          criteriaResults: [],
          issues: [],
        },
        result: 'passed',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.threads.clearDoneAt).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startCommitAndPush).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('clones a borrowed structured plan and sends it back through review', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-failed',
        threadId: 'thread-1',
        version: 1,
        rawOutput: 'unparseable plan',
        structured: null,
        status: 'failed',
        createdAt: new Date().toISOString(),
      });
      queries.plans.getLatestStructured.mockReturnValue({
        id: 'plan-borrowed',
        threadId: 'thread-old',
        version: 2,
        rawOutput: 'borrowed raw output',
        structured: {
          ...JSON.parse(PLAN_JSON),
          threadId: 'thread-old',
          version: 2,
        },
        status: 'approved',
        createdAt: new Date().toISOString(),
      });
      queries.plans.getMaxVersion.mockReturnValue(4);
      queries.plans.create.mockReturnValue({
        id: 'plan-clone',
        threadId: 'thread-1',
        version: 5,
        rawOutput: 'borrowed raw output',
        structured: {
          ...JSON.parse(PLAN_JSON),
          threadId: 'thread-1',
          version: 5,
        },
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.supersedeAll).toHaveBeenCalledWith('thread-1');
      expect(queries.plans.create).toHaveBeenCalledWith(
        'thread-1',
        'borrowed raw output',
        expect.objectContaining({ threadId: 'thread-1', version: 5 }),
        5,
      );
      expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-clone', 'pending_review');
      expect(pipeline.startReview).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ threadId: 'thread-1', version: 5 }),
      );
    });
  });

  describe('pipeline:auto-fix', () => {
    it('restores the latest checkpoint, records failure output, and resumes retry routing', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await handler(undefined, {
        threadId: 'thread-1',
        failureOutput: 'ERROR codex_core::session: failed to record rollout items',
      });

      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['reset', '--hard', 'abc123def456'],
        expect.objectContaining({ cwd: '/tmp/worktree' }),
        expect.any(Function),
      );
      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['clean', '-fd'],
        expect.objectContaining({ cwd: '/tmp/worktree' }),
        expect.any(Function),
      );
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'raw',
          content: expect.stringContaining(
            'ERROR codex_core::session: failed to record rollout items',
          ),
        }),
      );
      expect(queries.threads.updateStatus).toHaveBeenCalledWith(
        'thread-1',
        'failed',
        expect.stringContaining('Auto Fix requested from terminal failure output.'),
      );
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('rejects blank failure output before touching the worktree', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await expect(
        handler(undefined, {
          threadId: 'thread-1',
          failureOutput: '  \n\t  ',
        }),
      ).rejects.toThrow('No failure output available for Auto Fix');

      expect(execFileMock).not.toHaveBeenCalled();
      expect(queries.terminalEvents.create).not.toHaveBeenCalled();
      expect(pipeline.startExecution).not.toHaveBeenCalled();
    });

    it('falls back to retry routing when no worktree exists yet', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed', worktreePath: null }));

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await handler(undefined, {
        threadId: 'thread-1',
        failureOutput: 'ERROR codex_core::session: failed to record rollout items',
      });

      expect(execFileMock).not.toHaveBeenCalled();
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'lifecycle',
          message: expect.stringContaining('No worktree exists yet'),
        }),
      );
      expect(queries.threads.updateStatus).toHaveBeenCalledWith(
        'thread-1',
        'failed',
        expect.stringContaining('No worktree exists yet'),
      );
      expect(pipeline.startReview).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('falls back to retry routing when no checkpoint exists yet', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.checkpoints.getLatest.mockReturnValue(null);

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await handler(undefined, {
        threadId: 'thread-1',
        failureOutput: 'vitest failed',
      });

      expect(execFileMock).not.toHaveBeenCalled();
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'lifecycle',
          message: expect.stringContaining('No checkpoint exists yet'),
        }),
      );
      expect(queries.threads.updateStatus).toHaveBeenCalledWith(
        'thread-1',
        'failed',
        expect.stringContaining('No checkpoint exists yet'),
      );
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('emits a clamped terminal error when checkpoint restore fails', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      execFileMock.mockImplementationOnce(
        (
          _command: string,
          _args: string[],
          _options: Record<string, unknown>,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(new Error('fatal: could not reset worktree\nfull git trace'), '', '');
        },
      );

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await expect(
        handler(undefined, {
          threadId: 'thread-1',
          failureOutput: 'vitest failed',
        }),
      ).rejects.toThrow('fatal: could not reset worktree');

      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'error',
          message: 'Auto Fix checkpoint restore failed: fatal: could not reset worktree',
        }),
      );
      expect(queries.threads.updateStatus).not.toHaveBeenCalledWith(
        'thread-1',
        'failed',
        expect.any(String),
      );
    });
  });

  describe('pipeline:create-pr', () => {
    it('returns an existing pull request for the run branch without creating a new one', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'completed',
          worktreeBranch: 'shipcode/thread-1',
          githubPrNumber: null,
        }),
      );
      execFileMock.mockImplementationOnce(
        (
          _command: string,
          _args: string[],
          _options: Record<string, unknown>,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(
            null,
            {
              stdout: JSON.stringify([{ number: 17, url: 'https://github.com/acme/repo/pull/17' }]),
              stderr: '',
            } as unknown as string,
            '',
          );
        },
      );

      const handler = handlers.get('pipeline:create-pr');
      if (!handler) throw new Error('pipeline:create-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).resolves.toEqual({
        prNumber: 17,
        prUrl: 'https://github.com/acme/repo/pull/17',
      });

      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(execFileMock).toHaveBeenCalledWith(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'all',
          '--head',
          'shipcode/thread-1',
          '--json',
          'number,url',
          '--limit',
          '1',
        ],
        expect.objectContaining({ cwd: '/tmp/worktree' }),
        expect.any(Function),
      );
      expect(queries.threads.setGithubPr).toHaveBeenCalledWith('thread-1', 17);
    });

    it('creates a draft pull request when no existing branch PR is found', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'completed',
          worktreeBranch: 'shipcode/thread-1',
          githubPrNumber: null,
        }),
      );
      execFileMock
        .mockImplementationOnce(
          (
            _command: string,
            _args: string[],
            _options: Record<string, unknown>,
            callback: (error: Error | null, stdout: string, stderr: string) => void,
          ) => {
            callback(null, { stdout: '[]', stderr: '' } as unknown as string, '');
          },
        )
        .mockImplementationOnce(
          (
            _command: string,
            _args: string[],
            _options: Record<string, unknown>,
            callback: (error: Error | null, stdout: string, stderr: string) => void,
          ) => {
            callback(
              null,
              {
                stdout: 'https://github.com/acme/repo/pull/18\n',
                stderr: '',
              } as unknown as string,
              '',
            );
          },
        );

      const handler = handlers.get('pipeline:create-pr');
      if (!handler) throw new Error('pipeline:create-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).resolves.toEqual({
        prNumber: 18,
        prUrl: 'https://github.com/acme/repo/pull/18',
      });

      expect(execFileMock).toHaveBeenNthCalledWith(
        2,
        'gh',
        expect.arrayContaining([
          'pr',
          'create',
          '--draft',
          '--head',
          'shipcode/thread-1',
          '--base',
          'main',
        ]),
        expect.objectContaining({ cwd: '/tmp/worktree' }),
        expect.any(Function),
      );
      expect(queries.threads.setGithubPr).toHaveBeenCalledWith('thread-1', 18);
    });
  });
});
