import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReconciliationLoop,
  DEFAULT_TERMINAL_LABELS,
  type IssueStateProvider,
  type ReconciliationLoopDeps,
} from './reconciliation-loop';
import type { ActivePipelineSummary, Pipeline, PipelineContext } from './types';

function createMockPipeline(contexts: Map<string, Partial<PipelineContext>> = new Map()): Pipeline {
  return {
    listActive: vi.fn(() =>
      [...contexts.entries()].map(
        ([threadId, ctx]): ActivePipelineSummary => ({
          threadId,
          projectId: ctx.projectId ?? 'proj-1',
          projectPath: ctx.projectPath ?? '/proj',
          worktreePath: ctx.worktreePath ?? null,
          phase: 'executing',
          startedAt: Date.now(),
          activeProcessId: null,
        }),
      ),
    ),
    getContext: vi.fn((threadId: string) => contexts.get(threadId) as PipelineContext | undefined),
    cancel: vi.fn(),
    // Stubs for unused methods
    startPlanGeneration: vi.fn(),
    startReview: vi.fn(),
    startRevision: vi.fn(),
    startExecution: vi.fn(),
    startVerification: vi.fn(),
    startCommitAndPush: vi.fn(),
    startShipping: vi.fn(),
    startStabilization: vi.fn(),
    rehydrateContext: vi.fn(),
    startFromGitHubIssue: vi.fn(),
    startFromQuickTask: vi.fn(),
    startFromAutomation: vi.fn(),
    initializeContext: vi.fn(),
    listActiveInPhases: vi.fn(() => []),
  } as unknown as Pipeline;
}

function createMockIssueStateProvider(
  states: Record<number, { state: 'open' | 'closed'; labels: string[] }> = {},
): IssueStateProvider {
  return {
    getIssueState: vi.fn(async (_projectPath: string, issueNumber: number) => {
      const s = states[issueNumber];
      if (!s) throw new Error(`Issue #${issueNumber} not found`);
      return s;
    }),
  };
}

describe('createReconciliationLoop', () => {
  let deps: ReconciliationLoopDeps;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('tick', () => {
    it('cancels pipeline when issue is closed', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 42, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({
        42: { state: 'closed', labels: [] },
      });
      const onCancel = vi.fn();

      deps = {
        pipeline,
        issueStateProvider: issueProvider,
        onReconciliationCancel: onCancel,
        log: vi.fn(),
      };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(pipeline.cancel).toHaveBeenCalledWith('t1');
      expect(onCancel).toHaveBeenCalledWith('t1', expect.stringContaining('issue #42 closed'));
      expect(result.checked).toBe(1);
      expect(result.cancelled).toHaveLength(1);
      expect(result.cancelled[0].reason).toContain('closed');
    });

    it('cancels pipeline when issue has terminal label', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 10, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({
        10: { state: 'open', labels: ['wontfix', 'bug'] },
      });
      const onCancel = vi.fn();

      deps = {
        pipeline,
        issueStateProvider: issueProvider,
        onReconciliationCancel: onCancel,
        log: vi.fn(),
      };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(pipeline.cancel).toHaveBeenCalledWith('t1');
      expect(result.cancelled).toHaveLength(1);
      expect(result.cancelled[0].reason).toContain("terminal label 'wontfix'");
    });

    it('does not cancel when issue is open with no terminal labels', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 5, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({
        5: { state: 'open', labels: ['enhancement', 'agent:claude'] },
      });

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(pipeline.cancel).not.toHaveBeenCalled();
      expect(result.checked).toBe(1);
      expect(result.cancelled).toHaveLength(0);
    });

    it('skips threads without a GitHub issue number', async () => {
      const contexts = new Map([
        ['t1', { githubIssueNumber: null, projectPath: '/proj' }],
        ['t2', { githubIssueNumber: -1, projectPath: '/proj' }],
      ]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({});

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(issueProvider.getIssueState).not.toHaveBeenCalled();
      expect(result.checked).toBe(0);
    });

    it('handles API failures without crashing — logs error and continues', async () => {
      const contexts = new Map([
        ['t1', { githubIssueNumber: 1, projectPath: '/proj' }],
        ['t2', { githubIssueNumber: 2, projectPath: '/proj' }],
      ]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider: IssueStateProvider = {
        getIssueState: vi.fn(async (_path: string, n: number) => {
          if (n === 1) throw new Error('API rate limited');
          return { state: 'closed' as const, labels: [] };
        }),
      };

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      // t1 errored, t2 cancelled
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].threadId).toBe('t1');
      expect(result.cancelled).toHaveLength(1);
      expect(result.cancelled[0].threadId).toBe('t2');
      expect(pipeline.cancel).toHaveBeenCalledTimes(1);
      expect(pipeline.cancel).toHaveBeenCalledWith('t2');
    });

    it('supports case-insensitive terminal label matching', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 7, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({
        7: { state: 'open', labels: ['WontFix'] },
      });

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(pipeline.cancel).toHaveBeenCalledWith('t1');
      expect(result.cancelled).toHaveLength(1);
    });

    it('supports custom terminal labels', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 3, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({
        3: { state: 'open', labels: ['cancelled'] },
      });

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps, { terminalLabels: ['cancelled'] });
      const result = await loop.tick();

      expect(pipeline.cancel).toHaveBeenCalledWith('t1');
      expect(result.cancelled).toHaveLength(1);
    });

    it('handles multiple threads across different projects', async () => {
      const contexts = new Map([
        ['t1', { githubIssueNumber: 1, projectPath: '/proj-a' }],
        ['t2', { githubIssueNumber: 2, projectPath: '/proj-b' }],
      ]);
      const pipeline = createMockPipeline(contexts);
      const issueProvider = createMockIssueStateProvider({
        1: { state: 'closed', labels: [] },
        2: { state: 'open', labels: [] },
      });

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(pipeline.cancel).toHaveBeenCalledTimes(1);
      expect(pipeline.cancel).toHaveBeenCalledWith('t1');
      expect(result.checked).toBe(2);
      expect(result.cancelled).toHaveLength(1);
    });

    it('returns empty result when no pipelines are active', async () => {
      const pipeline = createMockPipeline(new Map());
      const issueProvider = createMockIssueStateProvider({});

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(result.checked).toBe(0);
      expect(result.cancelled).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('start / stop', () => {
    it('start() schedules ticks and stop() clears them', () => {
      const pipeline = createMockPipeline(new Map());
      const issueProvider = createMockIssueStateProvider({});

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps, { intervalMs: 5000 });

      loop.start();
      expect(pipeline.listActive).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);
      expect(pipeline.listActive).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(pipeline.listActive).toHaveBeenCalledTimes(2);

      loop.stop();
      vi.advanceTimersByTime(10_000);
      expect(pipeline.listActive).toHaveBeenCalledTimes(2);
    });

    it('start() is idempotent', () => {
      const pipeline = createMockPipeline(new Map());
      const issueProvider = createMockIssueStateProvider({});

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps, { intervalMs: 1000 });

      loop.start();
      loop.start(); // Should not create a second interval

      vi.advanceTimersByTime(1000);
      expect(pipeline.listActive).toHaveBeenCalledTimes(1);
    });

    it('stop() is idempotent', () => {
      const pipeline = createMockPipeline(new Map());
      const issueProvider = createMockIssueStateProvider({});

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);

      loop.stop(); // No-op before start
      loop.start();
      loop.stop();
      loop.stop(); // No-op after stop
    });
  });

  describe('defaults', () => {
    it('exports sensible default terminal labels', () => {
      expect(DEFAULT_TERMINAL_LABELS).toContain('wontfix');
      expect(DEFAULT_TERMINAL_LABELS).toContain('duplicate');
      expect(DEFAULT_TERMINAL_LABELS).toContain('invalid');
    });
  });
});
