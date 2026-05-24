import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateV57 } from '../schema';
import { createTestDb } from '../test-helpers';
import { PipelineWakeRequestQueries } from './pipeline-wake-requests';
import { ProjectQueries } from './projects';

describe('pipeline_wake_requests persistence', () => {
  let db: DatabaseSync;
  let projectId: string;
  let wakes: PipelineWakeRequestQueries;

  beforeEach(() => {
    db = createTestDb();
    projectId = new ProjectQueries(db).add('/tmp/pipeline-wakes').id;
    wakes = new PipelineWakeRequestQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('migration is idempotent', () => {
    expect(() => migrateV57(db)).not.toThrow();
    expect(() => migrateV57(db)).not.toThrow();
  });

  it('enqueues and claims due wake requests in schedule order', () => {
    const later = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'pipeline-capacity',
      targetType: 'automation',
      targetId: 'auto-later',
      projectId,
      scheduledAt: '2026-05-12T10:00:00.000Z',
    });
    const earlier = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'pipeline-capacity',
      targetType: 'automation',
      targetId: 'auto-earlier',
      projectId,
      scheduledAt: '2026-05-12T09:00:00.000Z',
    });

    expect(later.status).toBe('pending');
    expect(wakes.peekNextPending({ kind: 'automation' })?.id).toBe(earlier.id);

    const claimed = wakes.claimNext('scheduler', { kind: 'automation' });
    expect(claimed?.id).toBe(earlier.id);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedBy).toBe('scheduler');
  });

  it('coalesces active requests by idempotency key', () => {
    const first = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'pipeline-capacity',
      targetType: 'automation',
      targetId: 'auto-1',
      projectId,
      idempotencyKey: 'automation:auto-1',
      scheduledAt: '2026-05-12T10:00:00.000Z',
      payload: { attempt: 1 },
    });
    const second = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'still-full',
      targetType: 'automation',
      targetId: 'auto-1',
      projectId,
      idempotencyKey: 'automation:auto-1',
      scheduledAt: '2026-05-12T09:00:00.000Z',
      payload: { attempt: 2 },
    });

    expect(second.id).toBe(first.id);
    expect(second.reason).toBe('still-full');
    expect(second.scheduledAt).toBe('2026-05-12T09:00:00.000Z');
    expect(second.coalescedCount).toBe(1);
    expect(second.payload).toEqual({ attempt: 2 });
    expect(wakes.listByStatus('pending')).toHaveLength(1);
  });

  it('does not coalesce completed requests', () => {
    const first = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'pipeline-capacity',
      targetType: 'automation',
      targetId: 'auto-1',
      idempotencyKey: 'automation:auto-1',
    });
    wakes.complete(first.id);

    const second = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'pipeline-capacity',
      targetType: 'automation',
      targetId: 'auto-1',
      idempotencyKey: 'automation:auto-1',
    });

    expect(second.id).not.toBe(first.id);
    expect(wakes.listByStatus('completed')).toHaveLength(1);
    expect(wakes.listByStatus('pending')).toHaveLength(1);
  });

  it('can defer, complete, fail, and cancel claimed requests', () => {
    const wake = wakes.enqueue({
      kind: 'automation',
      source: 'automation:tick',
      reason: 'pipeline-capacity',
      targetType: 'automation',
      targetId: 'auto-1',
    });

    expect(wakes.claim(wake.id, 'scheduler')?.status).toBe('claimed');
    const deferred = wakes.defer(wake.id, '2099-05-12T11:00:00.000Z', 'still-full');
    expect(deferred.status).toBe('pending');
    expect(deferred.reason).toBe('still-full');
    expect(deferred.claimedAt).toBeNull();

    expect(wakes.claim(wake.id, 'scheduler')).toBeNull();
    const ready = wakes.defer(wake.id, new Date(Date.now() - 1_000).toISOString());
    expect(ready.status).toBe('pending');

    const claimed = wakes.claim(wake.id, 'scheduler');
    expect(claimed?.status).toBe('claimed');
    expect(wakes.fail(wake.id, 'boom').status).toBe('failed');
    expect(wakes.cancel(wake.id).status).toBe('cancelled');
  });
});
