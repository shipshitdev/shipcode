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
        5: { state: 'open', labels: ['enhancement', 'shipcode:agent:claude'] },
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

    it('records non-Error issue provider failures', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 1, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const issueStateProvider: IssueStateProvider = {
        getIssueState: vi.fn(async () => {
          throw 'offline';
        }),
      };

      deps = { pipeline, issueStateProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps);
      const result = await loop.tick();

      expect(result.errors).toEqual([{ threadId: 't1', error: 'offline' }]);
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
    it('start() schedules ticks and stop() clears them', async () => {
      const pipeline = createMockPipeline(new Map());
      const issueProvider = createMockIssueStateProvider({});

      deps = { pipeline, issueStateProvider: issueProvider, log: vi.fn() };
      const loop = createReconciliationLoop(deps, { intervalMs: 5000 });

      // Each tick must be allowed to settle between firings, otherwise the
      // re-entrancy guard (correctly) skips the next one.
      const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

      loop.start();
      expect(pipeline.listActive).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);
      await settle();
      expect(pipeline.listActive).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      await settle();
      expect(pipeline.listActive).toHaveBeenCalledTimes(2);

      loop.stop();
      vi.advanceTimersByTime(10_000);
      await settle();
      expect(pipeline.listActive).toHaveBeenCalledTimes(2);
    });

    it('uses console.log by default and logs non-Error tick failures', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const pipeline = createMockPipeline(new Map());
      vi.mocked(pipeline.listActive).mockImplementation(() => {
        throw 'tick exploded';
      });
      const issueStateProvider = createMockIssueStateProvider({});
      const loop = createReconciliationLoop({ pipeline, issueStateProvider }, { intervalMs: 1000 });

      loop.start();
      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(logSpy).toHaveBeenCalledWith('[reconcile] tick failed: tick exploded');
      loop.stop();
      logSpy.mockRestore();
    });

    it('uses console.log by default and logs Error tick failures', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const pipeline = createMockPipeline(new Map());
      vi.mocked(pipeline.listActive).mockImplementation(() => {
        throw new Error('typed tick exploded');
      });
      const issueStateProvider = createMockIssueStateProvider({});
      const loop = createReconciliationLoop({ pipeline, issueStateProvider }, { intervalMs: 1000 });

      loop.start();
      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(logSpy).toHaveBeenCalledWith('[reconcile] tick failed: typed tick exploded');
      loop.stop();
      logSpy.mockRestore();
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

  describe('re-entrancy', () => {
    /** Only setInterval is faked, so real timers still flush the microtask queue. */
    function flush() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    /** An issue provider that hangs until the returned release() is called. */
    function createGatedIssueStateProvider(state: { state: 'open' | 'closed'; labels: string[] }) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const provider: IssueStateProvider = {
        getIssueState: vi.fn(async () => {
          await gate;
          return state;
        }),
      };
      return { provider, release: () => release() };
    }

    it('skips an interval firing while the previous tick is still running', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 42, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const { provider, release } = createGatedIssueStateProvider({ state: 'open', labels: [] });
      const log = vi.fn();

      deps = { pipeline, issueStateProvider: provider, log };
      const loop = createReconciliationLoop(deps, { intervalMs: 1000 });

      loop.start();
      vi.advanceTimersByTime(1000);
      await flush();
      expect(pipeline.listActive).toHaveBeenCalledTimes(1);
      expect(provider.getIssueState).toHaveBeenCalledTimes(1);

      // Two more firings land while tick 1 is still awaiting GitHub.
      vi.advanceTimersByTime(2000);
      await flush();
      expect(pipeline.listActive).toHaveBeenCalledTimes(1);
      expect(provider.getIssueState).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        '[reconcile] previous tick still running — skipping this interval',
      );

      // Once tick 1 settles, the next firing runs normally.
      release();
      await flush();
      vi.advanceTimersByTime(1000);
      await flush();
      expect(pipeline.listActive).toHaveBeenCalledTimes(2);

      loop.stop();
    });

    it('does not cancel a thread twice for the same closed issue', async () => {
      const contexts = new Map([['t1', { githubIssueNumber: 42, projectPath: '/proj' }]]);
      const pipeline = createMockPipeline(contexts);
      const { provider, release } = createGatedIssueStateProvider({ state: 'closed', labels: [] });
      const onCancel = vi.fn();

      deps = {
        pipeline,
        issueStateProvider: provider,
        onReconciliationCancel: onCancel,
        log: vi.fn(),
      };
      const loop = createReconciliationLoop(deps, { intervalMs: 1000 });

      loop.start();
      vi.advanceTimersByTime(1000);
      await flush();

      // Three further firings while the closed-issue lookup is still in flight.
      vi.advanceTimersByTime(3000);
      await flush();

      release();
      await flush();

      expect(pipeline.cancel).toHaveBeenCalledTimes(1);
      expect(pipeline.cancel).toHaveBeenCalledWith('t1');
      expect(onCancel).toHaveBeenCalledTimes(1);

      loop.stop();
    });

    it('recovers the guard after a tick throws', async () => {
      const pipeline = createMockPipeline(new Map());
      vi.mocked(pipeline.listActive).mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const issueStateProvider = createMockIssueStateProvider({});
      const log = vi.fn();
      const loop = createReconciliationLoop(
        { pipeline, issueStateProvider, log },
        {
          intervalMs: 1000,
        },
      );

      loop.start();
      vi.advanceTimersByTime(1000);
      await flush();
      expect(log).toHaveBeenCalledWith('[reconcile] tick failed: boom');

      vi.advanceTimersByTime(1000);
      await flush();
      expect(pipeline.listActive).toHaveBeenCalledTimes(2);

      loop.stop();
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
