import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateV38 } from '../schema';
import { createTestDb } from '../test-helpers';
import { PipelineStepQueries } from './pipeline-steps';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('pipeline_step_log persistence', () => {
  let db: DatabaseSync;
  let threadId: string;
  let queries: PipelineStepQueries;

  beforeEach(() => {
    db = createTestDb();
    const projectId = new ProjectQueries(db).add('/tmp/pipeline-steps').id;
    threadId = new ThreadQueries(db).create(projectId, 'step', 'Step').id;
    queries = new PipelineStepQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('migration is idempotent', () => {
    expect(() => migrateV38(db)).not.toThrow();
    expect(() => migrateV38(db)).not.toThrow();
  });

  it('start inserts a row in started status with attempt + provider', () => {
    const row = queries.start({
      threadId,
      phase: 'plan',
      attempt: 1,
      provider: 'claude-cli',
      requestedModel: 'claude-sonnet-4-6',
    });

    expect(row.status).toBe('started');
    expect(row.phase).toBe('plan');
    expect(row.attempt).toBe(1);
    expect(row.provider).toBe('claude-cli');
    expect(row.requestedModel).toBe('claude-sonnet-4-6');
    expect(row.completedAt).toBeNull();
    expect(row.durationMs).toBeNull();
  });

  it('complete flips status, fills resolved model + tokens, computes duration', async () => {
    const started = queries.start({
      threadId,
      phase: 'review',
      attempt: 1,
      provider: 'codex-cli',
      requestedModel: 'gpt-5.4',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const completed = queries.complete(started.id, {
      status: 'completed',
      resolvedModel: 'gpt-5.4-high',
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.02,
    });

    expect(completed.status).toBe('completed');
    expect(completed.resolvedModel).toBe('gpt-5.4-high');
    expect(completed.promptTokens).toBe(100);
    expect(completed.completionTokens).toBe(50);
    expect(completed.costUsd).toBe(0.02);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.durationMs).not.toBeNull();
    expect(completed.durationMs ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('records error kind + message on failure', () => {
    const started = queries.start({
      threadId,
      phase: 'execute',
      attempt: 2,
      provider: 'claude-cli',
      requestedModel: 'claude-sonnet-4-6',
    });
    const failed = queries.complete(started.id, {
      status: 'failed',
      errorKind: 'rate_limit',
      errorMessage: 'OpenRouter rate limit',
    });

    expect(failed.status).toBe('failed');
    expect(failed.errorKind).toBe('rate_limit');
    expect(failed.errorMessage).toBe('OpenRouter rate limit');
  });

  it('preserves aborted status without overwriting prior tokens', () => {
    const started = queries.start({
      threadId,
      phase: 'verify',
      attempt: 1,
      provider: 'codex-cli',
    });
    const aborted = queries.complete(started.id, {
      status: 'aborted',
      errorKind: 'aborted',
      errorMessage: 'aborted',
    });

    expect(aborted.status).toBe('aborted');
    expect(aborted.errorKind).toBe('aborted');
  });

  it('listByThread returns rows in start order', () => {
    queries.start({ threadId, phase: 'plan', attempt: 1, provider: 'claude-cli' });
    queries.start({ threadId, phase: 'review', attempt: 1, provider: 'codex-cli' });
    queries.start({ threadId, phase: 'execute', attempt: 1, provider: 'claude-cli' });

    const rows = queries.listByThread(threadId);
    expect(rows.map((r) => r.phase)).toEqual(['plan', 'review', 'execute']);
  });
});
