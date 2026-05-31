import { DEFAULT_SETTINGS } from '@shipcode/shared';
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
    status: 'approval',
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

function mockExecFileStdoutOnce(stdout: string) {
  execFileMock.mockImplementationOnce(
    (
      _command: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, { stdout, stderr: '' } as unknown as string, '');
    },
  );
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
      listByRun: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    verifications: {
      getLatest: ReturnType<typeof vi.fn>;
    };
    reviews: {
      getByPlanId: ReturnType<typeof vi.fn>;
    };
    reviewFindings: {
      listByThread: ReturnType<typeof vi.fn>;
      listOpenByThread: ReturnType<typeof vi.fn>;
      updateStatus: ReturnType<typeof vi.fn>;
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
    pipelineSteps: {
      listByThread: ReturnType<typeof vi.fn>;
    };
    phaseLogs: {
      listByThread: ReturnType<typeof vi.fn>;
    };
    pipelineRuns: {
      listByThread: ReturnType<typeof vi.fn>;
    };
    promptTelemetry: {
      listByThread: ReturnType<typeof vi.fn>;
    };
    pipelineAnalytics: {
      getOverview: ReturnType<typeof vi.fn>;
      getThread: ReturnType<typeof vi.fn>;
    };
    heatmap: {
      byScope: ReturnType<typeof vi.fn>;
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
    cancel: ReturnType<typeof vi.fn>;
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
          status: 'approval',
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
          ...DEFAULT_SETTINGS,
          requireApproval: false,
          revisionCount: 2,
          maxConcurrentPipelines: 3,
        })),
      },
      terminalEvents: {
        listByThread: vi.fn(() => []),
        listByRun: vi.fn(() => []),
        create: vi.fn(),
      },
      verifications: {
        getLatest: vi.fn(() => null),
      },
      reviews: {
        getByPlanId: vi.fn(() => null),
      },
      reviewFindings: {
        listByThread: vi.fn(() => []),
        listOpenByThread: vi.fn(() => []),
        updateStatus: vi.fn(() => null),
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
      pipelineSteps: {
        listByThread: vi.fn(() => []),
      },
      phaseLogs: {
        listByThread: vi.fn(() => []),
      },
      pipelineRuns: {
        listByThread: vi.fn(() => []),
      },
      promptTelemetry: {
        listByThread: vi.fn(() => []),
      },
      pipelineAnalytics: {
        getOverview: vi.fn(() => ({ totalRuns: 0 })),
        getThread: vi.fn(() => ({ threadId: 'thread-1' })),
      },
      heatmap: {
        byScope: vi.fn(() => []),
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
      cancel: vi.fn(),
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

  // Resume/retry context now rides the typed start-call carry, not a mutated
  // PipelineContext. These read the last start call's carry argument.
  const lastExecutionResumeContext = (): string => {
    const calls = vi.mocked(pipeline.startExecution).mock.calls as unknown as Array<
      [string, unknown, { executionResumeContext?: string } | undefined]
    >;
    return calls.at(-1)?.[2]?.executionResumeContext ?? '';
  };
  const lastPlanPreviousRawOutput = (): string | null => {
    const calls = vi.mocked(pipeline.startPlanGeneration).mock.calls as unknown as Array<
      [string, string, string, string | null, { previousPlanRawOutput?: string | null } | undefined]
    >;
    return calls.at(-1)?.[4]?.previousPlanRawOutput ?? null;
  };

  describe('terminal:list', () => {
    it('returns verification and latest task graph records through simple read handlers', () => {
      const verification = { id: 'verification-1', threadId: 'thread-1' };
      const taskGraph = { id: 'graph-1', threadId: 'thread-1' };
      const finding = { id: 'finding-1', threadId: 'thread-1', status: 'open' };
      queries.verifications.getLatest.mockReturnValue(verification);
      queries.reviewFindings.listByThread.mockReturnValue([finding]);
      queries.reviewFindings.listOpenByThread.mockReturnValue([finding]);
      queries.reviewFindings.updateStatus.mockReturnValue({ ...finding, status: 'ignored' });
      (
        queries as typeof queries & {
          taskGraphs: { getLatestByThread: ReturnType<typeof vi.fn> };
        }
      ).taskGraphs = {
        getLatestByThread: vi.fn(() => taskGraph),
      };

      const verificationHandler = handlers.get('verification:get');
      const findingsHandler = handlers.get('review-findings:list-thread');
      const openFindingsHandler = handlers.get('review-findings:list-open');
      const updateFindingHandler = handlers.get('review-findings:update-status');
      const taskGraphHandler = handlers.get('task-graph:get-latest');
      if (
        !verificationHandler ||
        !findingsHandler ||
        !openFindingsHandler ||
        !updateFindingHandler ||
        !taskGraphHandler
      ) {
        throw new Error('read handlers not registered');
      }

      expect(verificationHandler(undefined, { threadId: 'thread-1' })).toBe(verification);
      expect(findingsHandler(undefined, { threadId: 'thread-1', includeClosed: true })).toEqual([
        finding,
      ]);
      expect(openFindingsHandler(undefined, { threadId: 'thread-1' })).toEqual([finding]);
      expect(
        updateFindingHandler(undefined, { findingId: 'finding-1', status: 'ignored' }),
      ).toEqual({ ...finding, status: 'ignored' });
      expect(taskGraphHandler(undefined, { threadId: 'thread-1' })).toBe(taskGraph);
      expect(queries.verifications.getLatest).toHaveBeenCalledWith('thread-1');
      expect(queries.reviewFindings.listByThread).toHaveBeenCalledWith('thread-1', {
        includeClosed: true,
      });
      expect(queries.reviewFindings.listOpenByThread).toHaveBeenCalledWith('thread-1');
      expect(queries.reviewFindings.updateStatus).toHaveBeenCalledWith('finding-1', 'ignored');
      expect(
        (
          queries as typeof queries & {
            taskGraphs: { getLatestByThread: ReturnType<typeof vi.fn> };
          }
        ).taskGraphs.getLatestByThread,
      ).toHaveBeenCalledWith('thread-1');
    });

    it('returns null for latest task graph when the optional query surface is absent', () => {
      const taskGraphHandler = handlers.get('task-graph:get-latest');
      if (!taskGraphHandler) throw new Error('task-graph:get-latest handler not registered');

      expect(taskGraphHandler(undefined, { threadId: 'thread-1' })).toBeNull();
    });

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
        status: 'approval',
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

  describe('pipeline-runs:list-by-thread', () => {
    it('returns run ledger entries with scoped phases, steps, terminal output, and retry depth', () => {
      queries.threads.getById.mockReturnValue(makeThread({ currentRunId: 'run-2' }));
      queries.pipelineRuns.listByThread.mockReturnValue([
        {
          id: 'run-2',
          threadId: 'thread-1',
          projectId: 'project-1',
          source: 'pipeline:resume',
          triggerDetail: null,
          status: 'running',
          currentPhase: 'executing',
          startedAt: '2026-05-12T10:00:00.000Z',
          finishedAt: null,
          errorMessage: null,
          errorKind: null,
          context: null,
          retryOfRunId: 'run-1',
          createdAt: '2026-05-12T10:00:00.000Z',
          updatedAt: '2026-05-12T10:01:00.000Z',
        },
        {
          id: 'run-1',
          threadId: 'thread-1',
          projectId: 'project-1',
          source: 'github:start-issue',
          triggerDetail: 'issue:42',
          status: 'failed',
          currentPhase: 'failed',
          startedAt: '2026-05-12T09:00:00.000Z',
          finishedAt: '2026-05-12T09:30:00.000Z',
          errorMessage: 'failed',
          errorKind: 'phase_error',
          context: null,
          retryOfRunId: null,
          createdAt: '2026-05-12T09:00:00.000Z',
          updatedAt: '2026-05-12T09:30:00.000Z',
        },
      ]);
      queries.phaseLogs.listByThread.mockReturnValue([
        { id: 'phase-1', runId: 'run-2', phase: 'executing' },
        { id: 'phase-old', runId: 'run-1', phase: 'failed' },
      ]);
      queries.pipelineSteps.listByThread.mockReturnValue([
        { id: 'step-1', runId: 'run-2', phase: 'execute' },
        { id: 'step-old', runId: 'run-1', phase: 'plan' },
      ]);
      queries.terminalEvents.listByRun.mockImplementation((runId: string) => [
        {
          id: `terminal-${runId}`,
          threadId: 'thread-1',
          runId,
          createdAt: '2026-05-12T10:00:00.000Z',
          event: { kind: 'raw', content: runId },
        },
      ]);

      const handler = handlers.get('pipeline-runs:list-by-thread');
      if (!handler) throw new Error('pipeline-runs:list-by-thread handler not registered');

      const result = handler(undefined, { threadId: 'thread-1', terminalLimit: 500 }) as Array<{
        run: { id: string };
        isCurrent: boolean;
        retryDepth: number;
        phaseTimeline: Array<{ id: string }>;
        steps: Array<{ id: string }>;
        terminalEvents: Array<{ id: string }>;
      }>;

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        run: { id: 'run-2' },
        isCurrent: true,
        retryDepth: 1,
        phaseTimeline: [{ id: 'phase-1' }],
        steps: [{ id: 'step-1' }],
        terminalEvents: [{ id: 'terminal-run-2' }],
      });
      expect(queries.terminalEvents.listByRun).toHaveBeenCalledWith('run-2', 120);
    });
  });

  describe('pipeline:start', () => {
    it('initializes a context and starts plan generation for an existing thread', async () => {
      const handler = handlers.get('pipeline:start');
      if (!handler) throw new Error('pipeline:start handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.threads.setPhaseModels).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          plannerModel: DEFAULT_SETTINGS.plannerModel,
          executorModel: DEFAULT_SETTINGS.executorModel,
        }),
      );
      expect(pipeline.initializeContext).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          projectPath: '/tmp/project',
          worktreePath: null,
          baseBranch: 'main',
        }),
      );
      expect(queries.threads.resetFailureTracking).toHaveBeenCalledWith('thread-1');
      expect(queries.plans.supersedeAll).toHaveBeenCalledWith('thread-1');
      expect(queries.threads.clearClarification).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startPlanGeneration).toHaveBeenCalledWith(
        'thread-1',
        'Fix it',
        '/tmp/project',
        null,
      );
    });

    it('throws when the thread or project is missing', async () => {
      const handler = handlers.get('pipeline:start');
      if (!handler) throw new Error('pipeline:start handler not registered');

      queries.threads.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'missing-thread' })).rejects.toThrow(
        'Thread missing-thread not found',
      );

      queries.projects.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Project project-1 not found',
      );
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

    it('throws for a thread not in approval', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'executing' }));

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'This task is no longer in approval. Current status: executing.',
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

    it('throws when no plan is available for approval', async () => {
      queries.plans.getLatest.mockReturnValue(null);

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'No plan available to approve',
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

    it('parses raw plan output when approving a plan without stored structured data', async () => {
      const parseablePlan = {
        ...JSON.parse(PLAN_JSON),
        files: [{ path: 'src/foo.ts', action: 'modify', description: 'Update foo' }],
        steps: [
          { order: 1, description: 'review', files: ['src/foo.ts'], rationale: 'r' },
          { order: 2, description: 'change', files: ['src/foo.ts'], rationale: 'r' },
          { order: 3, description: 'verify', files: ['src/foo.ts'], rationale: 'r' },
        ],
        outOfScope: ['unrelated work'],
      };
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-raw',
        threadId: 'thread-1',
        version: 1,
        rawOutput: `\`\`\`shipcode-plan\n${JSON.stringify(parseablePlan)}\n\`\`\``,
        structured: null,
        status: 'approval',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.updateStructured).toHaveBeenCalledWith(
        'plan-raw',
        expect.objectContaining({ objective: 'Test plan' }),
      );
      expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-raw', 'approved');
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('transitions to failed when approval cannot parse a structured plan', async () => {
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-bad',
        threadId: 'thread-1',
        version: 1,
        rawOutput: 'not a plan',
        structured: null,
        status: 'approval',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'No plan available to approve',
      );
      expect(notificationService.dismissByThread).toHaveBeenCalledWith('thread-1');
      expect(queries.threads.updateStatus).toHaveBeenCalledWith(
        'thread-1',
        'failed',
        'No plan available to approve',
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pipeline:phase',
          threadId: 'thread-1',
          phase: 'failed',
        }),
      );
    });

    it('throws when plan status has moved out of approval', async () => {
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-1',
        threadId: 'thread-1',
        version: 1,
        rawOutput: `\`\`\`shipcode-plan\n${PLAN_JSON}\n\`\`\``,
        structured: JSON.parse(PLAN_JSON),
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:approve');
      if (!handler) throw new Error('pipeline:approve handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'This plan is no longer in approval. Current plan status: pending_review.',
      );
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

    it('ignores clarification answers when the thread is missing or no longer clarifying', async () => {
      const handler = handlers.get('pipeline:answer-clarification');
      if (!handler) throw new Error('pipeline:answer-clarification handler not registered');

      queries.threads.getById.mockReturnValueOnce(null);
      await expect(
        handler(undefined, { threadId: 'missing', answers: [] }),
      ).resolves.toBeUndefined();

      queries.threads.getById.mockReturnValueOnce(makeThread({ status: 'approval' }));
      await expect(
        handler(undefined, { threadId: 'thread-1', answers: [] }),
      ).resolves.toBeUndefined();

      expect(queries.threads.resolveClarification).not.toHaveBeenCalled();
      expect(pipeline.startPlanGeneration).not.toHaveBeenCalled();
    });

    it('rejects incomplete or disallowed clarification answers', async () => {
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
            choices: [{ id: 'narrow', label: 'Narrow', description: 'Smallest version.' }],
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
          answers: [],
        }),
      ).rejects.toThrow('Missing answer for "Scope"');

      await expect(
        handler(undefined, {
          threadId: 'thread-1',
          answers: [{ questionId: 'scope', selectedChoiceId: null, freeformText: 'custom' }],
        }),
      ).rejects.toThrow('"Scope" does not accept freeform notes');

      await expect(
        handler(undefined, {
          threadId: 'thread-1',
          answers: [{ questionId: 'scope', selectedChoiceId: null, freeformText: '   ' }],
        }),
      ).rejects.toThrow('Provide a selection or note for "Scope"');
    });

    it('throws when a clarifying thread has no pending clarification request or project', async () => {
      const handler = handlers.get('pipeline:answer-clarification');
      if (!handler) throw new Error('pipeline:answer-clarification handler not registered');

      queries.threads.getById.mockReturnValueOnce(
        makeThread({ status: 'clarifying', clarificationRequest: null }),
      );
      await expect(handler(undefined, { threadId: 'thread-1', answers: [] })).rejects.toThrow(
        'No pending clarification request found for this task',
      );

      queries.threads.getById.mockReturnValueOnce(
        makeThread({
          status: 'clarifying',
          clarificationRequest: {
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
                choices: [{ id: 'narrow', label: 'Narrow', description: 'Smallest version.' }],
                allowFreeform: false,
                freeformPlaceholder: null,
              },
            ],
          },
        }),
      );
      queries.projects.getById.mockReturnValueOnce(null);
      await expect(
        handler(undefined, {
          threadId: 'thread-1',
          answers: [{ questionId: 'scope', selectedChoiceId: 'narrow', freeformText: null }],
        }),
      ).rejects.toThrow('Project project-1 not found');
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

    it('does nothing when the thread no longer exists', async () => {
      queries.threads.getById.mockReturnValue(null);

      const handler = handlers.get('pipeline:reject');
      if (!handler) throw new Error('pipeline:reject handler not registered');

      await handler(undefined, { threadId: 'thread-1', feedback: 'tighten the scope' });

      expect(queries.projects.getById).not.toHaveBeenCalled();
      expect(pipeline.startPlanGeneration).not.toHaveBeenCalled();
    });

    it('does nothing when the project no longer exists', async () => {
      queries.projects.getById.mockReturnValue(null);

      const handler = handlers.get('pipeline:reject');
      if (!handler) throw new Error('pipeline:reject handler not registered');

      await handler(undefined, { threadId: 'thread-1', feedback: 'tighten the scope' });

      expect(queries.plans.supersedeAll).not.toHaveBeenCalled();
      expect(pipeline.startPlanGeneration).not.toHaveBeenCalled();
    });
  });

  describe('pipeline:cancel', () => {
    it('forwards cancellation to the pipeline runtime', () => {
      const handler = handlers.get('pipeline:cancel');
      if (!handler) throw new Error('pipeline:cancel handler not registered');

      handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.cancel).toHaveBeenCalledWith('thread-1');
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

    it('rejects missing threads before emitting pause events', () => {
      queries.threads.getById.mockReturnValue(null);

      const handler = handlers.get('pipeline:pause');
      if (!handler) throw new Error('pipeline:pause handler not registered');

      expect(() => handler(undefined, { threadId: 'thread-1' })).toThrow(
        'Thread thread-1 not found',
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
      expect(lastExecutionResumeContext()).toContain('previous execution was paused by the user');
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.objectContaining({ executionResumeContext: expect.any(String) }),
      );
    });

    it('builds resume context from checkpoint, git state, and terminal tail', async () => {
      const context: { executionResumeContext?: string } = {};
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'executing',
          lastError: 'Paused by user',
          worktreePath: '/tmp/worktree',
        }),
      );
      queries.terminalEvents.listByThread.mockReturnValue([
        {
          id: 'event-thinking',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          event: { kind: 'thinking' as const, content: 'considering the fix' },
        },
        {
          id: 'event-1',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          event: { kind: 'raw' as const, content: 'agent stopped after editing the renderer' },
        },
        {
          id: 'event-error',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:30.000Z',
          event: { kind: 'error' as const, message: 'command failed' },
        },
        {
          id: 'event-lifecycle',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:35.000Z',
          event: { kind: 'lifecycle' as const, message: 'process exited' },
        },
        {
          id: 'event-tool-start',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:40.000Z',
          event: { kind: 'tool_start' as const, name: 'vitest', summary: 'running tests' },
        },
        {
          id: 'event-2',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:01:00.000Z',
          event: {
            kind: 'tool_end' as const,
            name: 'vitest',
            exitCode: 1,
            outputSummary: '1 failed',
          },
        },
        {
          id: 'event-tool-end-no-output',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:01:10.000Z',
          event: {
            kind: 'tool_end' as const,
            name: 'tsc',
            exitCode: undefined,
            outputSummary: undefined,
          },
        },
        {
          id: 'event-turn-start',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:01:20.000Z',
          event: { kind: 'turn_start' as const, turn: 2 },
        },
        {
          id: 'event-turn-end',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:01:30.000Z',
          event: { kind: 'turn_end' as const, turn: 2 },
        },
        {
          id: 'event-action',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:01:40.000Z',
          event: { kind: 'action' as const, label: 'Edit App.tsx' },
        },
        {
          id: 'event-clarification-requested',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:01:50.000Z',
          event: { kind: 'clarification_requested' as const, summary: 'Need env var' },
        },
        {
          id: 'event-clarification-answered',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:02:00.000Z',
          event: { kind: 'clarification_answered' as const, questionCount: 2 },
        },
        {
          id: 'event-done',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:02:10.000Z',
          event: { kind: 'done' as const, totalTokens: { prompt: 1, completion: 2 } },
        },
        {
          id: 'event-unknown',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:02:20.000Z',
          event: { kind: 'unknown' as never },
        },
      ]);
      mockExecFileStdoutOnce(' M apps/desktop/src/renderer/App.tsx\n');
      mockExecFileStdoutOnce('apps/desktop/src/renderer/App.tsx\n');
      mockExecFileStdoutOnce(' 1 file changed, 4 insertions(+)\n');
      mockExecFileStdoutOnce(
        'diff --git a/apps/desktop/src/renderer/App.tsx b/apps/desktop/src/renderer/App.tsx\n',
      );
      pipeline.getContext.mockReturnValue(context);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-only', 'abc123def456', '--'],
        expect.objectContaining({ cwd: '/tmp/worktree' }),
        expect.any(Function),
      );
      expect(lastExecutionResumeContext()).toContain(
        'The previous execution was paused by the user',
      );
      expect(lastExecutionResumeContext()).toContain('Checkpoint before execution: Before execute');
      expect(lastExecutionResumeContext()).toContain('apps/desktop/src/renderer/App.tsx');
      expect(lastExecutionResumeContext()).toContain('considering the fix');
      expect(lastExecutionResumeContext()).toContain('[error] command failed');
      expect(lastExecutionResumeContext()).toContain('[lifecycle] process exited');
      expect(lastExecutionResumeContext()).toContain('[tool:start] vitest: running tests');
      expect(lastExecutionResumeContext()).toContain('[tool:end] vitest exit=1 1 failed');
      expect(lastExecutionResumeContext()).toContain('[tool:end] tsc');
      expect(lastExecutionResumeContext()).toContain('[turn:start] 2');
      expect(lastExecutionResumeContext()).toContain('[turn:end] 2');
      expect(lastExecutionResumeContext()).toContain('[action] Edit App.tsx');
      expect(lastExecutionResumeContext()).toContain('[clarification_requested] Need env var');
      expect(lastExecutionResumeContext()).toContain('[clarification_answered] 2 answers');
      expect(lastExecutionResumeContext()).toContain('[done]');
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.objectContaining({ executionResumeContext: expect.any(String) }),
      );
    });

    it('truncates oversized paused execution resume context', async () => {
      const context: { executionResumeContext?: string } = {};
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'executing',
          worktreePath: '/tmp/worktree',
        }),
      );
      queries.terminalEvents.listByThread.mockReturnValue([
        {
          id: 'event-big',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          event: { kind: 'raw' as const, content: 'x'.repeat(25_000) },
        },
      ]);
      mockExecFileStdoutOnce(`status-${'s'.repeat(6_000)}`);
      mockExecFileStdoutOnce(`files-${'f'.repeat(6_000)}`);
      mockExecFileStdoutOnce(`stat-${'t'.repeat(6_000)}`);
      mockExecFileStdoutOnce(`diff-${'d'.repeat(6_000)}`);
      pipeline.getContext.mockReturnValue(context);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(lastExecutionResumeContext()).toContain(
        '[resume context truncated after 24000 chars]',
      );
      expect(lastExecutionResumeContext().length).toBeLessThan(24_200);
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.objectContaining({ executionResumeContext: expect.any(String) }),
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

    it('rejects unsupported paused phases after validation', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'approval',
        }),
      );

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Paused task is missing a resumable phase',
      );
      expect(pipeline.startExecution).not.toHaveBeenCalled();
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

    it('rejects resume when thread or project state is invalid', async () => {
      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      queries.threads.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Thread thread-1 not found',
      );

      queries.threads.getById.mockReturnValueOnce(makeThread({ status: 'executing' }));
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Cannot resume task while in executing phase',
      );

      queries.threads.getById.mockReturnValueOnce(
        makeThread({ status: 'paused', pausedPhase: 'executing' }),
      );
      queries.projects.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Project project-1 not found',
      );
    });

    it('rejects paused execution when no structured plan is available', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'executing',
        }),
      );
      queries.plans.getLatest.mockReturnValue(null);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'No structured plan found for paused task',
      );
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

    it('resumes paused revision with fallback feedback when review output is unavailable', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'paused',
          pausedPhase: 'revising',
        }),
      );
      queries.reviews.getByPlanId.mockReturnValue(null);

      const handler = handlers.get('pipeline:resume');
      if (!handler) throw new Error('pipeline:resume handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startRevision).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        'Resume the interrupted revision pass using the latest plan and reviewer context.',
      );
    });
  });

  describe('pipeline:skip-review', () => {
    it('moves the latest plan to approval and emits the phase transition', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          githubIssueNumber: null,
          autonomous: true,
          reviewRound: 1,
        }),
      );

      const handler = handlers.get('pipeline:skip-review');
      if (!handler) throw new Error('pipeline:skip-review handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(queries.threads.updateStatus).toHaveBeenCalledWith('thread-1', 'approval');
      expect(emitter.emit).toHaveBeenCalledWith({
        type: 'pipeline:phase',
        threadId: 'thread-1',
        phase: 'approval',
      });
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

    it('rejects stabilization while the task is already active', async () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: 'proc-1',
        },
      ]);

      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Stop the active pipeline before starting a stabilization pass',
      );
      expect(queries.threads.getById).not.toHaveBeenCalled();
    });

    it('rejects stabilization when thread or project records are missing', async () => {
      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      queries.threads.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Thread thread-1 not found',
      );

      queries.projects.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Project project-1 not found',
      );
      expect(pipeline.startStabilization).not.toHaveBeenCalled();
    });

    it('rejects stabilization when no linked PR exists', async () => {
      queries.githubIssues.getByNumber.mockReturnValue({
        id: 'issue-42',
        projectId: 'project-1',
        number: 42,
        title: 'Fix bug',
        linkedPrNumber: null,
        ciBlocked: true,
        failingChecks: [{ name: 'test', conclusion: 'failure' }],
        unresolvedReviewCommentCount: 0,
        unresolvedReviewComments: [],
      });

      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'No linked pull request found for this task',
      );
      expect(pipeline.startStabilization).not.toHaveBeenCalled();
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

    it('parses and persists a raw latest plan before stabilization', async () => {
      const parseablePlan = {
        ...JSON.parse(PLAN_JSON),
        files: [{ path: 'src/foo.ts', action: 'modify', description: 'Update foo' }],
        steps: [
          { order: 1, description: 'review', files: ['src/foo.ts'], rationale: 'r' },
          { order: 2, description: 'change', files: ['src/foo.ts'], rationale: 'r' },
          { order: 3, description: 'verify', files: ['src/foo.ts'], rationale: 'r' },
        ],
        outOfScope: ['unrelated work'],
      };
      queries.githubIssues.getByNumber.mockReturnValue({
        id: 'issue-42',
        projectId: 'project-1',
        number: 42,
        title: 'Fix bug',
        linkedPrNumber: 17,
        linkedPrUrl: 'https://github.com/acme/repo/pull/17',
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewCommentCount: 1,
        unresolvedReviewComments: [{ body: 'Please add a regression test' }],
      });
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-raw',
        threadId: 'thread-1',
        version: 1,
        rawOutput: `\`\`\`shipcode-plan\n${JSON.stringify(parseablePlan)}\n\`\`\``,
        structured: null,
        status: 'approved',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.updateStructured).toHaveBeenCalledWith(
        'plan-raw',
        expect.objectContaining({ objective: 'Test plan' }),
      );
      expect(pipeline.startStabilization).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ prNumber: 17 }),
      );
    });

    it('rejects stabilization when no structured or parseable plan exists', async () => {
      queries.githubIssues.getByNumber.mockReturnValue({
        id: 'issue-42',
        projectId: 'project-1',
        number: 42,
        title: 'Fix bug',
        linkedPrNumber: 17,
        linkedPrUrl: 'https://github.com/acme/repo/pull/17',
        ciBlocked: true,
        failingChecks: [{ name: 'test', conclusion: 'failure' }],
        unresolvedReviewCommentCount: 0,
        unresolvedReviewComments: [],
      });
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-raw',
        threadId: 'thread-1',
        version: 1,
        rawOutput: 'not json',
        structured: null,
        status: 'approved',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:stabilize-pr');
      if (!handler) throw new Error('pipeline:stabilize-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'No approved plan found for stabilization',
      );
      expect(pipeline.startStabilization).not.toHaveBeenCalled();
    });
  });

  describe('pipeline:list-active', () => {
    it('returns an empty list without reading settings when no pipelines are active', () => {
      const handler = handlers.get('pipeline:list-active');
      if (!handler) throw new Error('pipeline:list-active handler not registered');

      expect(handler(undefined, undefined)).toEqual([]);
      expect(queries.settings.get).not.toHaveBeenCalled();
    });

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

    it('includes approval threads in the active list', () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'approval',
          startedAt: Date.now(),
          activeProcessId: null,
        },
      ]);

      const handler = handlers.get('pipeline:list-active');
      if (!handler) throw new Error('pipeline:list-active handler not registered');

      const result = handler(undefined, undefined) as Array<{ phase: string }>;
      expect(result[0].phase).toBe('approval');
    });

    it('marks approved approval threads as waiting for execution', () => {
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
          phase: 'approval',
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

    it('uses fallback summary fields when thread records are missing', () => {
      queries.threads.getById.mockReturnValue(null);
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'missing-thread',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: 123,
          activeProcessId: 'proc-1',
        },
      ]);

      const handler = handlers.get('pipeline:list-active');
      if (!handler) throw new Error('pipeline:list-active handler not registered');

      expect(handler(undefined, undefined)).toEqual([
        expect.objectContaining({
          threadId: 'missing-thread',
          projectId: '',
          projectName: 'Unknown project',
          threadTitle: 'missing-thread',
          modelProvider: null,
        }),
      ]);
    });

    it('uses fallback active summary fields when the thread exists without project details', () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          title: null,
          githubIssueNumber: null,
        }),
      );
      queries.projects.getById.mockReturnValue(null);
      queries.plans.getLatest.mockReturnValue(null);
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'approval',
          startedAt: 123,
          activeProcessId: null,
        },
      ]);

      const handler = handlers.get('pipeline:list-active');
      if (!handler) throw new Error('pipeline:list-active handler not registered');

      expect(handler(undefined, undefined)).toEqual([
        expect.objectContaining({
          threadId: 'thread-1',
          projectId: 'project-1',
          projectName: 'Unknown project',
          threadTitle: 'thread-1',
          approvedAwaitingExecution: false,
          githubIssueNumber: null,
          modelProvider: 'claude',
          model: 'claude',
          reasoningEffort: 'none',
        }),
      ]);
    });
  });

  describe('pipeline:retry', () => {
    it('rejects retry while the task is already active', async () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: 'proc-1',
        },
      ]);

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Stop the active pipeline before retrying',
      );
      expect(queries.threads.getById).not.toHaveBeenCalled();
    });

    it('rejects retry when thread or project records are missing', async () => {
      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      queries.threads.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Thread thread-1 not found',
      );

      queries.projects.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Project project-1 not found',
      );
      expect(pipeline.startPlanGeneration).not.toHaveBeenCalled();
    });

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

    it('uses issue-specific phase model settings before retry routing', async () => {
      const issue = {
        id: 'issue-42',
        projectId: 'project-1',
        issueNumber: 42,
        title: 'Fix bug',
        executorModelOverride: 'codex',
        executorModelIdOverride: null,
        plannerModelOverride: null,
        reviewerModelOverride: null,
        verifierModelOverride: null,
        plannerModelIdOverride: null,
        reviewerModelIdOverride: null,
        verifierModelIdOverride: null,
        plannerReasoningEffortOverride: null,
        reviewerReasoningEffortOverride: null,
        executorReasoningEffortOverride: null,
        verifierReasoningEffortOverride: null,
      };
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.githubIssues.getByNumber.mockReturnValue(issue);
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

      expect(queries.threads.setPhaseModels).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ executorModel: 'codex' }),
      );
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

    it('falls back to global approval settings when the thread disappears during retry logging', async () => {
      queries.threads.getById
        .mockReturnValueOnce(makeThread({ status: 'failed', githubIssueNumber: null }))
        .mockReturnValueOnce(null);
      queries.settings.get.mockReturnValue({
        ...DEFAULT_SETTINGS,
        requireApproval: true,
        revisionCount: 2,
        maxConcurrentPipelines: 3,
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('falls back to global approval settings when the project disappears during retry logging', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({ status: 'failed', githubIssueNumber: null }),
      );
      queries.projects.getById
        .mockReturnValueOnce({
          id: 'project-1',
          name: 'Test Repo',
          path: '/tmp/project',
          gitRemote: 'https://github.com/acme/repo.git',
          defaultBranch: 'main',
        })
        .mockReturnValueOnce(null);
      queries.settings.get.mockReturnValue({
        ...DEFAULT_SETTINGS,
        requireApproval: true,
        revisionCount: 2,
        maxConcurrentPipelines: 3,
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
      );
    });

    it('attaches resume context with git read errors for interrupted execution retries', async () => {
      const context: { executionResumeContext?: string } = {};
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'failed',
          failurePhase: 'executing',
          lastError: 'interrupted while ShipCode was closed',
          worktreePath: '/tmp/worktree',
        }),
      );
      pipeline.getContext.mockReturnValue(context);
      execFileMock.mockImplementation(
        (
          _command: string,
          _args: string[],
          _options: Record<string, unknown>,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(new Error('git unavailable'), '', '');
        },
      );

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(lastExecutionResumeContext()).toContain(
        '[Unable to read git status: git unavailable]',
      );
      expect(lastExecutionResumeContext()).toContain('<interrupted_run_context>');
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'lifecycle',
          message: 'Retry is resuming from interrupted worktree state.',
        }),
      );
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.objectContaining({ executionResumeContext: expect.any(String) }),
      );
    });

    it('attaches resume context on retry even when the in-memory context is gone', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'failed',
          failurePhase: 'executing',
          lastError: 'interrupted by an app refresh',
          worktreePath: '/tmp/worktree',
        }),
      );
      pipeline.getContext.mockReturnValue(null);

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      // Resume context is built from persisted thread state and threaded on the
      // start carry, so it no longer depends on an in-memory PipelineContext.
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'lifecycle',
          message: 'Retry is resuming from interrupted worktree state.',
        }),
      );
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.objectContaining({ executionResumeContext: expect.any(String) }),
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

    it('parses and persists a raw latest plan before retry routing', async () => {
      const parseablePlan = {
        ...JSON.parse(PLAN_JSON),
        files: [{ path: 'src/foo.ts', action: 'modify', description: 'Update foo' }],
        steps: [
          { order: 1, description: 'review', files: ['src/foo.ts'], rationale: 'r' },
          { order: 2, description: 'change', files: ['src/foo.ts'], rationale: 'r' },
          { order: 3, description: 'verify', files: ['src/foo.ts'], rationale: 'r' },
        ],
        outOfScope: ['unrelated work'],
      };
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-raw',
        threadId: 'thread-1',
        version: 1,
        rawOutput: `\`\`\`shipcode-plan\n${JSON.stringify(parseablePlan)}\n\`\`\``,
        structured: null,
        status: 'failed',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.updateStructured).toHaveBeenCalledWith(
        'plan-raw',
        expect.objectContaining({ objective: 'Test plan' }),
      );
      expect(queries.plans.supersedeAll).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startPlanGeneration).toHaveBeenCalledWith(
        'thread-1',
        'Fix it',
        '/tmp/project',
        '/tmp/worktree',
        expect.objectContaining({ previousPlanRawOutput: expect.any(String) }),
      );
    });

    it('attaches interrupted worktree context before retrying execution', async () => {
      const context: { executionResumeContext?: string } = {};
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'failed',
          failurePhase: 'executing',
          lastError: 'Agent process stalled after tool output went quiet',
          worktreePath: '/tmp/worktree',
        }),
      );
      queries.terminalEvents.listByThread.mockReturnValue([
        {
          id: 'event-text',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          event: { kind: 'text' as const, content: 'plain output' },
        },
        {
          id: 'event-raw',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          event: { kind: 'raw' as const, content: 'raw output' },
        },
        {
          id: 'event-thinking',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:02.000Z',
          event: { kind: 'thinking' as const, content: 'thinking output' },
        },
        {
          id: 'event-1',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:03.000Z',
          event: { kind: 'error' as const, message: 'vitest timed out' },
        },
        {
          id: 'event-lifecycle',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:04.000Z',
          event: { kind: 'lifecycle' as const, message: 'process started' },
        },
        {
          id: 'event-tool-start',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:05.000Z',
          event: { kind: 'tool_start' as const, name: 'Read', summary: 'Inspect file' },
        },
        {
          id: 'event-tool-end',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:06.000Z',
          event: { kind: 'tool_end' as const, name: 'Read', exitCode: 0, outputSummary: 'done' },
        },
        {
          id: 'event-turn-start',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:07.000Z',
          event: { kind: 'turn_start' as const, turn: 2 },
        },
        {
          id: 'event-turn-end',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:08.000Z',
          event: { kind: 'turn_end' as const, turn: 2 },
        },
        {
          id: 'event-action',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:09.000Z',
          event: { kind: 'action' as const, label: 'Running tests' },
        },
        {
          id: 'event-clarification-requested',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:10.000Z',
          event: { kind: 'clarification_requested' as const, summary: 'Need scope' },
        },
        {
          id: 'event-clarification-answered',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:11.000Z',
          event: { kind: 'clarification_answered' as const, questionCount: 2 },
        },
        {
          id: 'event-done',
          threadId: 'thread-1',
          createdAt: '2026-01-01T00:00:12.000Z',
          event: { kind: 'done' as const },
        },
      ]);
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
      pipeline.getContext.mockReturnValue(context);

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(lastExecutionResumeContext()).toContain('The previous execution was interrupted');
      expect(lastExecutionResumeContext()).toContain('Agent process stalled');
      expect(lastExecutionResumeContext()).toContain('plain output');
      expect(lastExecutionResumeContext()).toContain('[error] vitest timed out');
      expect(lastExecutionResumeContext()).toContain('[tool:start] Read: Inspect file');
      expect(lastExecutionResumeContext()).toContain('[tool:end] Read exit=0 done');
      expect(lastExecutionResumeContext()).toContain('[clarification_answered] 2 answers');
      expect(lastExecutionResumeContext()).toContain('[done]');
      expect(queries.terminalEvents.create).toHaveBeenCalledWith('thread-1', {
        kind: 'lifecycle',
        message: 'Retry is resuming from interrupted worktree state.',
      });
      expect(pipeline.startExecution).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ objective: 'Test plan' }),
        expect.objectContaining({ executionResumeContext: expect.any(String) }),
      );
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

    it('borrows a structured plan from another thread for the same issue', async () => {
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
      queries.plans.getLatestStructured.mockReturnValue(null);
      queries.plans.getLatestStructuredForIssue.mockReturnValue({
        id: 'plan-cross-thread',
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
      queries.plans.getMaxVersion.mockReturnValue(7);
      queries.plans.create.mockReturnValue({
        id: 'plan-clone',
        threadId: 'thread-1',
        version: 8,
        rawOutput: 'borrowed raw output',
        structured: {
          ...JSON.parse(PLAN_JSON),
          threadId: 'thread-1',
          version: 8,
        },
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      });

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(queries.plans.getLatestStructuredForIssue).toHaveBeenCalledWith('project-1', 42);
      expect(queries.plans.create).toHaveBeenCalledWith(
        'thread-1',
        'borrowed raw output',
        expect.objectContaining({ threadId: 'thread-1', version: 8 }),
        8,
      );
      expect(pipeline.startReview).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({ threadId: 'thread-1', version: 8 }),
      );
    });

    it('restarts planning when no structured plan can be recovered', async () => {
      const context: { previousPlanRawOutput?: string } = {};
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));
      queries.plans.getLatest.mockReturnValue({
        id: 'plan-failed',
        threadId: 'thread-1',
        version: 1,
        rawOutput: 'unparseable failed plan',
        structured: null,
        status: 'failed',
        createdAt: new Date().toISOString(),
      });
      pipeline.getContext.mockReturnValue(context);

      const handler = handlers.get('pipeline:retry');
      if (!handler) throw new Error('pipeline:retry handler not registered');

      await handler(undefined, { threadId: 'thread-1' });

      expect(lastPlanPreviousRawOutput()).toBe('unparseable failed plan');
      expect(queries.plans.supersedeAll).toHaveBeenCalledWith('thread-1');
      expect(pipeline.startPlanGeneration).toHaveBeenCalledWith(
        'thread-1',
        'Fix it',
        '/tmp/project',
        '/tmp/worktree',
        expect.objectContaining({ previousPlanRawOutput: expect.any(String) }),
      );
    });
  });

  describe('pipeline:auto-fix', () => {
    it('rejects auto-fix while the task is already active', async () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: 'proc-1',
        },
      ]);

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await expect(
        handler(undefined, { threadId: 'thread-1', failureOutput: 'vitest failed' }),
      ).rejects.toThrow('Stop the active pipeline before auto-fixing');
      expect(queries.threads.getById).not.toHaveBeenCalled();
    });

    it('rejects auto-fix when the thread no longer exists', async () => {
      queries.threads.getById.mockReturnValue(null);

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await expect(
        handler(undefined, { threadId: 'thread-1', failureOutput: 'vitest failed' }),
      ).rejects.toThrow('Thread thread-1 not found');
      expect(execFileMock).not.toHaveBeenCalled();
    });

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

    it('truncates long auto-fix failure output from the terminal tail', async () => {
      queries.threads.getById.mockReturnValue(makeThread({ status: 'failed' }));

      const handler = handlers.get('pipeline:auto-fix');
      if (!handler) throw new Error('pipeline:auto-fix handler not registered');

      await handler(undefined, {
        threadId: 'thread-1',
        failureOutput: `start-${'x'.repeat(9_000)}-end`,
      });

      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          kind: 'raw',
          content: expect.stringContaining('[Earlier terminal output truncated for Auto Fix]'),
        }),
      );
      expect(queries.terminalEvents.create).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          content: expect.stringContaining('-end'),
        }),
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
    it('rejects concurrent PR creation for the same thread', async () => {
      let releaseFirstGhCall!: (stdout: string) => void;
      execFileMock.mockImplementationOnce(
        (
          _command: string,
          _args: string[],
          _options: Record<string, unknown>,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          releaseFirstGhCall = (stdout: string) =>
            callback(null, { stdout, stderr: '' } as unknown as string, '');
        },
      );
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'completed',
          worktreeBranch: 'shipcode/thread-1',
        }),
      );

      const handler = handlers.get('pipeline:create-pr');
      if (!handler) throw new Error('pipeline:create-pr handler not registered');

      const first = handler(undefined, { threadId: 'thread-1' });
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'PR creation already in progress for this thread',
      );

      releaseFirstGhCall(
        JSON.stringify([{ number: 17, url: 'https://github.com/acme/repo/pull/17' }]),
      );
      await expect(first).resolves.toEqual({
        prNumber: 17,
        prUrl: 'https://github.com/acme/repo/pull/17',
      });
    });

    it('rejects invalid thread state before calling gh', async () => {
      const handler = handlers.get('pipeline:create-pr');
      if (!handler) throw new Error('pipeline:create-pr handler not registered');

      queries.threads.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Thread thread-1 not found',
      );

      queries.projects.getById.mockReturnValueOnce(null);
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Project project-1 not found',
      );

      queries.threads.getById.mockReturnValueOnce(
        makeThread({ status: 'completed', worktreeBranch: null }),
      );
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'No branch available for this run',
      );

      queries.threads.getById.mockReturnValueOnce(
        makeThread({
          status: 'completed',
          worktreeBranch: 'shipcode/thread-1',
          githubPrNumber: 17,
        }),
      );
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'A pull request already exists for this thread',
      );

      queries.threads.getById.mockReturnValueOnce(
        makeThread({ status: 'executing', worktreeBranch: 'shipcode/thread-1' }),
      );
      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Can only create a PR for a completed run',
      );

      expect(execFileMock).not.toHaveBeenCalled();
    });

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

    it('uses project defaults when creating a pull request without plan or worktree path', async () => {
      queries.threads.getById.mockReturnValue(
        makeThread({
          status: 'completed',
          title: 'Fallback PR title',
          worktreeBranch: 'shipcode/thread-1',
          worktreePath: null,
          baseBranch: null,
          githubPrNumber: null,
        }),
      );
      queries.plans.getLatest.mockReturnValue(null);
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
                stdout: 'https://github.com/acme/repo/pull/19\n',
                stderr: '',
              } as unknown as string,
              '',
            );
          },
        );

      const handler = handlers.get('pipeline:create-pr');
      if (!handler) throw new Error('pipeline:create-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).resolves.toEqual({
        prNumber: 19,
        prUrl: 'https://github.com/acme/repo/pull/19',
      });

      expect(execFileMock).toHaveBeenNthCalledWith(
        2,
        'gh',
        expect.arrayContaining(['--title', 'Fallback PR title', '--base', 'main']),
        expect.objectContaining({ cwd: '/tmp/project' }),
        expect.any(Function),
      );
    });

    it('clamps gh and parse failures while releasing the in-flight lock', async () => {
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
          callback(new Error('gh auth failed\nmore detail'), '', '');
        },
      );

      const handler = handlers.get('pipeline:create-pr');
      if (!handler) throw new Error('pipeline:create-pr handler not registered');

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow('gh auth failed');

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
            callback(null, { stdout: 'created without URL', stderr: '' } as unknown as string, '');
          },
        );

      await expect(handler(undefined, { threadId: 'thread-1' })).rejects.toThrow(
        'Failed to parse pull request number from gh output: created without URL',
      );
      expect(queries.threads.setGithubPr).not.toHaveBeenCalled();
    });
  });

  describe('dashboard, costs, telemetry, and analytics handlers', () => {
    it('returns dashboard overview and paginated dashboard data with defaults and filters', () => {
      pipeline.listActive.mockReturnValue([
        {
          threadId: 'thread-1',
          projectPath: '/tmp/project',
          phase: 'executing',
          startedAt: 123,
          activeProcessId: 'proc-1',
        },
      ]);

      const overview = handlers.get('dashboard:get-overview');
      const activity = handlers.get('dashboard:get-activity');
      const countActivity = handlers.get('dashboard:count-activity');
      const recentTasks = handlers.get('dashboard:get-recent-tasks');
      const countRecentTasks = handlers.get('dashboard:count-recent-tasks');
      if (!overview || !activity || !countActivity || !recentTasks || !countRecentTasks) {
        throw new Error('dashboard handlers not registered');
      }

      expect(overview(undefined, { activityLimit: 7, activityOffset: 2 })).toMatchObject({
        running: [expect.objectContaining({ threadId: 'thread-1' })],
      });
      expect(queries.activity.listRecent).toHaveBeenCalledWith(7, undefined, 2);
      expect(queries.dashboard.getRecentTasks).toHaveBeenCalledWith(20, 0);

      activity(undefined, { limit: 3, offset: 4, projectId: 'project-1' });
      countActivity(undefined, { projectId: 'project-1' });
      recentTasks(undefined, { limit: 5, offset: 6 });
      countRecentTasks(undefined, undefined);

      expect(queries.activity.listRecent).toHaveBeenCalledWith(3, 'project-1', 4);
      expect(queries.activity.countRecent).toHaveBeenCalledWith('project-1');
      expect(queries.dashboard.getRecentTasks).toHaveBeenCalledWith(5, 6);
      expect(queries.dashboard.countRecentTasks).toHaveBeenCalled();
    });

    it('returns dashboard stats, issue activity, and default activity pagination', () => {
      const stats = { tasksOpen: 3 };
      queries.dashboard.getStats.mockReturnValue(stats);

      const dashboardStats = handlers.get('dashboard:get-stats');
      const activity = handlers.get('dashboard:get-activity');
      const countActivity = handlers.get('dashboard:count-activity');
      const activityForIssue = handlers.get('activity:list-for-issue');
      const recentTasks = handlers.get('dashboard:get-recent-tasks');
      if (!dashboardStats || !activity || !countActivity || !activityForIssue || !recentTasks) {
        throw new Error('dashboard handlers not registered');
      }

      expect(dashboardStats()).toBe(stats);
      activity(undefined, undefined);
      countActivity(undefined, undefined);
      activityForIssue(undefined, { projectId: 'project-1', issueNumber: 42 });
      recentTasks(undefined, undefined);

      expect(queries.activity.listRecent).toHaveBeenCalledWith(50, undefined, 0);
      expect(queries.activity.countRecent).toHaveBeenCalledWith(undefined);
      expect(queries.activity.listByIssue).toHaveBeenCalledWith('project-1', 42, 200);
      expect(queries.dashboard.getRecentTasks).toHaveBeenCalledWith(20, 0);
    });

    it('returns cost, pipeline step, telemetry, analytics, and heatmap data', () => {
      const costsSummary = handlers.get('costs:get-summary');
      const listCosts = handlers.get('costs:list-tasks');
      const countCosts = handlers.get('costs:count-tasks');
      const issueCosts = handlers.get('costs:list-for-issue');
      const steps = handlers.get('pipeline-steps:list-by-thread');
      const telemetry = handlers.get('prompt-telemetry:list-by-thread');
      const analyticsOverview = handlers.get('pipeline-analytics:get-overview');
      const analyticsThread = handlers.get('pipeline-analytics:get-thread');
      const heatmap = handlers.get('activity-heatmap:query');
      if (
        !costsSummary ||
        !listCosts ||
        !countCosts ||
        !issueCosts ||
        !steps ||
        !telemetry ||
        !analyticsOverview ||
        !analyticsThread ||
        !heatmap
      ) {
        throw new Error('cost/analytics handlers not registered');
      }

      costsSummary(undefined, undefined);
      listCosts(undefined, { limit: 9, offset: 1, projectId: 'project-1' });
      countCosts(undefined, {});
      issueCosts(undefined, { projectId: 'project-1', issueNumber: 42 });
      steps(undefined, { threadId: 'thread-1' });
      telemetry(undefined, { threadId: 'thread-1' });
      analyticsOverview(undefined, undefined);
      analyticsThread(undefined, { threadId: 'thread-1' });
      heatmap(undefined, { scope: 'global', metric: 'runs' });

      expect(queries.costs.getSummary).toHaveBeenCalled();
      expect(queries.costs.listTasks).toHaveBeenCalledWith(9, 1, 'project-1');
      expect(queries.costs.countTasks).toHaveBeenCalledWith(null);
      expect(queries.costs.listTasksForIssue).toHaveBeenCalledWith('project-1', 42);
      expect(queries.pipelineSteps.listByThread).toHaveBeenCalledWith('thread-1');
      expect(queries.promptTelemetry.listByThread).toHaveBeenCalledWith('thread-1');
      expect(queries.pipelineAnalytics.getOverview).toHaveBeenCalled();
      expect(queries.pipelineAnalytics.getThread).toHaveBeenCalledWith('thread-1');
      expect(queries.heatmap.byScope).toHaveBeenCalledWith({ scope: 'global', metric: 'runs' });
    });
  });
});
