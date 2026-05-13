import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateV56 } from '../schema';
import { createTestDb } from '../test-helpers';
import { GitHubIssueQueries } from './github-issues';
import { PipelineRunQueries } from './pipeline-runs';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('pipeline_runs persistence', () => {
  let db: DatabaseSync;
  let projectId: string;
  let threadId: string;
  let runs: PipelineRunQueries;

  beforeEach(() => {
    db = createTestDb();
    projectId = new ProjectQueries(db).add('/tmp/pipeline-runs').id;
    threadId = new ThreadQueries(db).create(projectId, 'prompt', 'Issue').id;
    runs = new PipelineRunQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('migration is idempotent', () => {
    expect(() => migrateV56(db)).not.toThrow();
    expect(() => migrateV56(db)).not.toThrow();
  });

  it('creates a queued run and makes it current for the thread', () => {
    const run = runs.create({
      threadId,
      projectId,
      source: 'github:start-issue',
      triggerDetail: 'issue:123',
      currentPhase: 'planning',
      context: { issueNumber: 123 },
    });

    expect(run).toMatchObject({
      threadId,
      projectId,
      source: 'github:start-issue',
      triggerDetail: 'issue:123',
      status: 'queued',
      currentPhase: 'planning',
      context: { issueNumber: 123 },
    });
    expect(runs.getCurrentForThread(threadId)?.id).toBe(run.id);
  });

  it('tracks start, phase updates, and terminal completion', () => {
    const run = runs.create({
      threadId,
      projectId,
      source: 'quick-task:start',
      currentPhase: 'executing',
    });

    const started = runs.start(run.id, 'executing');
    expect(started.status).toBe('running');
    expect(started.startedAt).not.toBeNull();

    const verifying = runs.setPhase(run.id, 'verifying');
    expect(verifying.currentPhase).toBe('verifying');

    const finished = runs.finish(run.id, {
      status: 'succeeded',
      currentPhase: 'completed',
    });
    expect(finished.status).toBe('succeeded');
    expect(finished.finishedAt).not.toBeNull();
    expect(runs.getCurrentForThread(threadId)).toBeNull();
  });

  it('persists retry lineage between run attempts', () => {
    const first = runs.create({
      threadId,
      projectId,
      source: 'github:start-issue',
      currentPhase: 'planning',
    });
    runs.finish(first.id, { status: 'failed', currentPhase: 'failed', errorMessage: 'boom' });

    const retry = runs.create({
      threadId,
      projectId,
      source: 'pipeline:resume',
      currentPhase: 'executing',
      retryOfRunId: first.id,
    });

    expect(retry.retryOfRunId).toBe(first.id);
    expect(runs.listByThread(threadId).map((run) => run.id)).toEqual([retry.id, first.id]);
  });

  it('claims and releases GitHub issue execution ownership by run id', () => {
    const issues = new GitHubIssueQueries(db);
    const issue = issues.upsert({
      projectId,
      issueNumber: 42,
      title: 'Locked issue',
      body: 'body',
      labels: [],
      assignee: null,
      state: 'open',
      updatedAt: null,
    });
    const first = runs.create({ threadId, projectId, source: 'github:start-issue' });
    const second = runs.create({ threadId, projectId, source: 'github:start-issue' });

    expect(runs.claimIssueExecution({ issueId: issue.id, runId: first.id, owner: 'claude' })).toBe(
      true,
    );
    expect(runs.claimIssueExecution({ issueId: issue.id, runId: second.id, owner: 'codex' })).toBe(
      false,
    );

    const locked = issues.getByNumber(projectId, 42);
    expect(locked?.executionRunId).toBe(first.id);
    expect(locked?.executionLockOwner).toBe('claude');

    runs.releaseIssueExecution(first.id);
    expect(issues.getByNumber(projectId, 42)?.executionRunId).toBeNull();
  });
});
