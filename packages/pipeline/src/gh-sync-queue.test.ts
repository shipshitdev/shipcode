import type { GhStatusMapping, IssuePipelineStatus } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import { GhSyncQueue, type GhSyncWriteOpts, ghSyncQueueKey } from './gh-sync-queue';

const MAPPING: GhStatusMapping = {
  todo: { name: 'Todo', color: 'GREEN' },
  inProgress: { name: 'In Progress', color: 'YELLOW' },
  humanReview: { name: 'Human Review', color: 'ORANGE' },
  done: { name: 'Done', color: 'PURPLE' },
};

/** No-op sleep so retry tests don't pay real backoff. */
const noSleep = async (): Promise<void> => {};

function makeOpts(overrides: Partial<GhSyncWriteOpts> = {}): GhSyncWriteOpts {
  return {
    projectPath: '/tmp/repo',
    projectUrl: 'https://github.com/orgs/acme/projects/1',
    issueNumber: 42,
    pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
    statusMapping: MAPPING,
    ...overrides,
  };
}

/**
 * Enqueue and ignore the outcome. `enqueue` now rejects when a write exhausts
 * its retries, and fire-and-forget callers are expected to handle that; tests
 * that only care about writeFn/onError do the same instead of leaking an
 * unhandled rejection.
 */
function fireAndForget(queue: GhSyncQueue, opts: GhSyncWriteOpts): void {
  void queue.enqueue(opts).catch(() => {});
}

/** Creates a writeFn that resolves when `resolve()` is called externally. */
function createGate() {
  let resolveFn!: () => void;
  const promise = new Promise<void>((r) => {
    resolveFn = r;
  });
  const calls: GhSyncWriteOpts[] = [];
  const writeFn = vi.fn(async (opts: GhSyncWriteOpts) => {
    calls.push(opts);
    await promise;
  });
  return { writeFn, resolve: resolveFn, calls };
}

describe('ghSyncQueueKey', () => {
  it('keys on the GitHub repo identity when the project has one', () => {
    // Two clones of one repo are two projects on disk but one issue on GitHub.
    const clone1 = makeOpts({ projectPath: '/tmp/clone-a', repoFullName: 'acme/app' });
    const clone2 = makeOpts({ projectPath: '/tmp/clone-b', repoFullName: 'acme/app' });

    expect(ghSyncQueueKey(clone1)).toBe(ghSyncQueueKey(clone2));
    expect(ghSyncQueueKey(clone1)).toBe('acme/app:42');
  });

  it('is case-insensitive on the repo name', () => {
    expect(ghSyncQueueKey(makeOpts({ repoFullName: 'ACME/App' }))).toBe(
      ghSyncQueueKey(makeOpts({ repoFullName: 'acme/app' })),
    );
  });

  it('separates different issues in the same repo', () => {
    expect(ghSyncQueueKey(makeOpts({ repoFullName: 'acme/app', issueNumber: 1 }))).not.toBe(
      ghSyncQueueKey(makeOpts({ repoFullName: 'acme/app', issueNumber: 2 })),
    );
  });

  it('falls back to the local path when no repo is linked', () => {
    expect(ghSyncQueueKey(makeOpts({ repoFullName: null }))).toBe('/tmp/repo:42');
    expect(ghSyncQueueKey(makeOpts({ repoFullName: '  ' }))).toBe('/tmp/repo:42');
    expect(ghSyncQueueKey(makeOpts())).toBe('/tmp/repo:42');
  });
});

describe('GhSyncQueue', () => {
  it('fires immediately when no write is in-flight', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const queue = new GhSyncQueue(writeFn);
    const opts = makeOpts();

    await queue.enqueue(opts);

    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(opts);
    expect(queue.size).toBe(0);
  });

  it('collapses multiple enqueues while a write is in-flight', async () => {
    const gate = createGate();
    const queue = new GhSyncQueue(gate.writeFn);

    // First write starts immediately (blocked on gate).
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));

    // Two more enqueues while first is in-flight — only latest should survive.
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.reviewing }));
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));

    // Release gate — first write finishes, then the collapsed "executing" fires.
    gate.resolve();
    await queue.drain();

    // writeFn called twice: planning (first), then executing (collapsed).
    // "reviewing" was collapsed away.
    expect(gate.writeFn).toHaveBeenCalledTimes(2);
    expect(gate.calls[0]?.pipelineStatus).toBe(ISSUE_PIPELINE_STATUS.planning);
    expect(gate.calls[1]?.pipelineStatus).toBe(ISSUE_PIPELINE_STATUS.executing);
  });

  it('serializes writes for the same issue', async () => {
    const order: IssuePipelineStatus[] = [];
    const writeFn = vi.fn(async (opts: GhSyncWriteOpts) => {
      // Simulate async work
      await new Promise((r) => setTimeout(r, 5));
      order.push(opts.pipelineStatus);
    });
    const queue = new GhSyncQueue(writeFn);

    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));
    await queue.drain();

    // Should see planning first, then executing (serialized, not concurrent).
    expect(order).toEqual([ISSUE_PIPELINE_STATUS.planning, ISSUE_PIPELINE_STATUS.executing]);
  });

  it('serializes writes for one issue across two clones of the same repo', async () => {
    const active = new Set<string>();
    let maxConcurrent = 0;
    const writeFn = vi.fn(async (opts: GhSyncWriteOpts) => {
      active.add(opts.projectPath);
      maxConcurrent = Math.max(maxConcurrent, active.size);
      await new Promise((r) => setTimeout(r, 10));
      active.delete(opts.projectPath);
    });
    const queue = new GhSyncQueue(writeFn);

    fireAndForget(queue, makeOpts({ projectPath: '/tmp/clone-a', repoFullName: 'acme/app' }));
    fireAndForget(queue, makeOpts({ projectPath: '/tmp/clone-b', repoFullName: 'acme/app' }));
    await queue.drain();

    // One issue on GitHub — the two checkouts must not race each other.
    expect(maxConcurrent).toBe(1);
  });

  it('allows concurrent writes for different issues', async () => {
    const active = new Set<number>();
    let maxConcurrent = 0;
    const writeFn = vi.fn(async (opts: GhSyncWriteOpts) => {
      active.add(opts.issueNumber);
      maxConcurrent = Math.max(maxConcurrent, active.size);
      await new Promise((r) => setTimeout(r, 10));
      active.delete(opts.issueNumber);
    });
    const queue = new GhSyncQueue(writeFn);

    fireAndForget(queue, makeOpts({ issueNumber: 1 }));
    fireAndForget(queue, makeOpts({ issueNumber: 2 }));
    await queue.drain();

    // Different issues should run concurrently.
    expect(maxConcurrent).toBe(2);
    expect(writeFn).toHaveBeenCalledTimes(2);
  });

  it('retries a transient failure and resolves once it succeeds', async () => {
    const onError = vi.fn();
    let attempts = 0;
    const writeFn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('network timeout');
    });
    const queue = new GhSyncQueue(writeFn, { sleep: noSleep, onError });

    await expect(queue.enqueue(makeOpts())).resolves.toBeUndefined();

    expect(writeFn).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });

  it('backs off between retries', async () => {
    const delays: number[] = [];
    const writeFn = vi.fn(async () => {
      throw new Error('network timeout');
    });
    const queue = new GhSyncQueue(writeFn, {
      maxAttempts: 4,
      baseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await expect(queue.enqueue(makeOpts())).rejects.toThrow('network timeout');

    // One sleep between each pair of attempts, doubling each time.
    expect(delays).toEqual([100, 200, 400]);
  });

  it('reports a write that exhausts its retries and rejects the caller', async () => {
    const onError = vi.fn();
    const writeFn = vi.fn(async () => {
      throw new Error('network timeout');
    });
    const opts = makeOpts();
    const queue = new GhSyncQueue(writeFn, { maxAttempts: 2, sleep: noSleep, onError });

    await expect(queue.enqueue(opts)).rejects.toThrow('network timeout');

    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({ opts, attempts: 2, error: expect.any(Error) });
    expect(queue.size).toBe(0);
  });

  it('abandons retries when a newer state is already queued behind the failure', async () => {
    const onError = vi.fn();
    const writeFn = vi.fn(async (opts: GhSyncWriteOpts) => {
      if (opts.pipelineStatus === ISSUE_PIPELINE_STATUS.planning) {
        // Let the newer state land while this attempt is still in flight.
        await new Promise((r) => setTimeout(r, 1));
        throw new Error('network timeout');
      }
    });
    const queue = new GhSyncQueue(writeFn, { sleep: noSleep, onError });

    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));
    await queue.drain();

    // Retrying "planning" would only write back a state GitHub is about to be
    // told to leave — one attempt each, then the newer state wins.
    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    // The report carries the attempts actually spent, not the configured max.
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1 }));
    expect(queue.size).toBe(0);
  });

  it('continues to drain pending work after a failed write', async () => {
    const onError = vi.fn();
    let callCount = 0;
    const writeFn = vi.fn(async (_opts: GhSyncWriteOpts) => {
      callCount++;
      if (callCount === 1) throw new Error('network timeout');
    });
    const queue = new GhSyncQueue(writeFn, { sleep: noSleep, onError });

    // First write will fail, second should still execute.
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));
    await queue.drain();

    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it('settles a collapsed enqueue with the superseding write outcome', async () => {
    const gate = createGate();
    const queue = new GhSyncQueue(gate.writeFn);

    fireAndForget(queue, makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    const collapsed = queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.reviewing }));
    const latest = queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));

    gate.resolve();

    // "reviewing" never reaches GitHub, but the state it wanted written is
    // superseded by "executing" — both callers see that write's outcome.
    await expect(collapsed).resolves.toBeUndefined();
    await expect(latest).resolves.toBeUndefined();
  });

  it('queue is empty after all writes drain', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const queue = new GhSyncQueue(writeFn);

    fireAndForget(queue, makeOpts());
    expect(queue.size).toBe(1);
    await queue.drain();
    expect(queue.size).toBe(0);
  });

  it('drain resolves immediately when the queue is empty', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const queue = new GhSyncQueue(writeFn);

    await expect(queue.drain()).resolves.toBeUndefined();

    expect(writeFn).not.toHaveBeenCalled();
  });

  it('handles stale queue entries without in-flight work during drain', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const queue = new GhSyncQueue(writeFn);
    (
      queue as unknown as {
        queue: Map<string, { inflight: Promise<void> | null; pending: GhSyncWriteOpts | null }>;
      }
    ).queue.set('/tmp/repo:42', { inflight: null, pending: null });

    await expect(queue.drain()).resolves.toBeUndefined();

    expect(writeFn).not.toHaveBeenCalled();
    expect(queue.size).toBe(1);
  });

  it('tolerates entries removed before an in-flight write finishes', async () => {
    let release!: () => void;
    const writeFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const queue = new GhSyncQueue(writeFn);
    fireAndForget(queue, makeOpts());
    (
      queue as unknown as {
        queue: Map<string, { inflight: Promise<void> | null; pending: GhSyncWriteOpts | null }>;
      }
    ).queue.delete('/tmp/repo:42');

    release();
    await queue.drain();

    expect(queue.size).toBe(0);
  });
});
