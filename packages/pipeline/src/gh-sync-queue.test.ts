import type { GhStatusMapping, IssuePipelineStatus } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import { GhSyncQueue, type GhSyncWriteOpts } from './gh-sync-queue';

const MAPPING: GhStatusMapping = {
  todo: { name: 'Todo', color: 'GREEN' },
  inProgress: { name: 'In Progress', color: 'YELLOW' },
  humanReview: { name: 'Human Review', color: 'ORANGE' },
  done: { name: 'Done', color: 'PURPLE' },
};

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

describe('GhSyncQueue', () => {
  it('fires immediately when no write is in-flight', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const queue = new GhSyncQueue(writeFn);
    const opts = makeOpts();

    queue.enqueue(opts);
    await queue.drain();

    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(opts);
    expect(queue.size).toBe(0);
  });

  it('collapses multiple enqueues while a write is in-flight', async () => {
    const gate = createGate();
    const queue = new GhSyncQueue(gate.writeFn);

    // First write starts immediately (blocked on gate).
    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));

    // Two more enqueues while first is in-flight — only latest should survive.
    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.reviewing }));
    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));

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

    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));
    await queue.drain();

    // Should see planning first, then executing (serialized, not concurrent).
    expect(order).toEqual([ISSUE_PIPELINE_STATUS.planning, ISSUE_PIPELINE_STATUS.executing]);
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

    queue.enqueue(makeOpts({ issueNumber: 1, pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    queue.enqueue(makeOpts({ issueNumber: 2, pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    await queue.drain();

    // Different issues should run concurrently.
    expect(maxConcurrent).toBe(2);
    expect(writeFn).toHaveBeenCalledTimes(2);
  });

  it('swallows write errors and continues to drain pending', async () => {
    const onError = vi.fn();
    let callCount = 0;
    const writeFn = vi.fn(async (_opts: GhSyncWriteOpts) => {
      callCount++;
      if (callCount === 1) throw new Error('network timeout');
    });
    const queue = new GhSyncQueue(writeFn, onError);

    // First write will fail, second should still execute.
    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.planning }));
    queue.enqueue(makeOpts({ pipelineStatus: ISSUE_PIPELINE_STATUS.executing }));
    await queue.drain();

    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it('queue is empty after all writes drain', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const queue = new GhSyncQueue(writeFn);

    queue.enqueue(makeOpts());
    expect(queue.size).toBe(1);
    await queue.drain();
    expect(queue.size).toBe(0);
  });
});
