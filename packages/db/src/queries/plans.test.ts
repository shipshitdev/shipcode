import type { DatabaseSync } from 'node:sqlite';
import type { ShipCodePlan } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

function structuredPlan(overrides: Partial<ShipCodePlan> = {}): ShipCodePlan {
  return {
    id: 'plan-structured',
    threadId: 'thread-structured',
    version: 1,
    objective: 'Test plan objective',
    files: [],
    steps: [],
    acceptanceCriteria: [],
    outOfScope: [],
    estimatedComplexity: 'low',
    dependencies: [],
    ...overrides,
  };
}

describe('PlanQueries', () => {
  let db: DatabaseSync;
  let plans: PlanQueries;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/test').id;
    threadId = threads.create(projectId, 'prompt', 'title').id;
    plans = new PlanQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create() returns a plan record', () => {
    const p = plans.create(threadId, 'raw output', null, 1);
    expect(p.id).toBeTruthy();
    expect(p.threadId).toBe(threadId);
    expect(p.rawOutput).toBe('raw output');
    expect(p.structured).toBeNull();
    expect(p.version).toBe(1);
    expect(p.status).toBe('draft');
  });

  it('fails loudly when a created plan cannot be reloaded', () => {
    const getById = vi.spyOn(plans, 'getById').mockReturnValueOnce(null);

    expect(() => plans.create(threadId, 'raw output', null, 1)).toThrow(
      'Failed to load plan after insert',
    );
    getById.mockRestore();
  });

  it('create() clamps oversized raw output', () => {
    const rawOutput = `prefix\n${'x'.repeat(20_000)}\nsuffix`;
    const p = plans.create(threadId, rawOutput, null, 1);
    expect(p.rawOutput.length).toBeLessThanOrEqual(16_000);
    expect(p.rawOutput).toContain('prefix');
    expect(p.rawOutput).toContain('suffix');
    expect(p.rawOutput).toContain('[truncated');
  });

  it('getMaxVersion() returns 0 when no plans', () => {
    expect(plans.getMaxVersion(threadId)).toBe(0);
  });

  it('getMaxVersion() returns highest version', () => {
    plans.create(threadId, 'v1', null, 1);
    plans.create(threadId, 'v2', null, 2);
    expect(plans.getMaxVersion(threadId)).toBe(2);
  });

  it('getLatest() returns null when no plans', () => {
    expect(plans.getLatest(threadId)).toBeNull();
  });

  it('getLatest() returns highest version plan', () => {
    plans.create(threadId, 'v1', null, 1);
    const p2 = plans.create(threadId, 'v2', null, 2);
    expect(plans.getLatest(threadId)?.id).toBe(p2.id);
  });

  it('getLatestStructured() returns the newest structured plan only', () => {
    plans.create(threadId, 'v1', structuredPlan({ threadId, version: 1 }), 1);
    plans.create(threadId, 'v2 raw only', null, 2);
    const p3 = plans.create(threadId, 'v3', structuredPlan({ threadId, version: 3 }), 3);

    expect(plans.getLatestStructured(threadId)).toMatchObject({
      id: p3.id,
      version: 3,
      structured: expect.objectContaining({ version: 3 }),
    });
    expect(plans.getLatestStructured('missing-thread')).toBeNull();
  });

  it('list() returns plans ordered by version DESC', () => {
    plans.create(threadId, 'v1', null, 1);
    plans.create(threadId, 'v2', null, 2);
    const list = plans.list(threadId);
    expect(list.length).toBe(2);
    expect(list[0].version).toBe(2);
    expect(list[1].version).toBe(1);
  });

  it('listByIssue() returns plans across all threads for the same GitHub issue', () => {
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/test-issue-history').id;
    const firstThread = threads.create(projectId, 'prompt 1', 'title 1');
    const secondThread = threads.create(projectId, 'prompt 2', 'title 2');
    const otherThread = threads.create(projectId, 'prompt 3', 'title 3');

    threads.setGithubIssue(firstThread.id, 38, 'owner/repo');
    threads.setGithubIssue(secondThread.id, 38, 'owner/repo');
    threads.setGithubIssue(otherThread.id, 39, 'owner/repo');

    const firstPlan = plans.create(firstThread.id, 'v1', null, 1);
    const secondPlan = plans.create(secondThread.id, 'v2', null, 1);
    plans.create(otherThread.id, 'other issue', null, 1);

    db.prepare('UPDATE plans SET created_at = ? WHERE id = ?').run(
      '2026-04-13T18:03:54.505Z',
      firstPlan.id,
    );
    db.prepare('UPDATE plans SET created_at = ? WHERE id = ?').run(
      '2026-04-13T18:12:36.879Z',
      secondPlan.id,
    );

    const list = plans.listByIssue(projectId, 38);
    expect(list).toHaveLength(2);
    expect(list.map((plan) => plan.id)).toEqual([secondPlan.id, firstPlan.id]);
    expect(list.map((plan) => plan.rawOutput)).toEqual(['', '']);
    expect(list.map((plan) => plan.structured)).toEqual([null, null]);
  });

  it('getLatestStructuredForIssue() returns the newest structured issue plan', () => {
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/test-issue-structured').id;
    const olderThread = threads.create(projectId, 'prompt 1', 'title 1');
    const newerThread = threads.create(projectId, 'prompt 2', 'title 2');
    const rawThread = threads.create(projectId, 'prompt 3', 'title 3');

    threads.setGithubIssue(olderThread.id, 42, 'owner/repo');
    threads.setGithubIssue(newerThread.id, 42, 'owner/repo');
    threads.setGithubIssue(rawThread.id, 42, 'owner/repo');

    const olderPlan = plans.create(
      olderThread.id,
      'older structured',
      structuredPlan({ threadId: olderThread.id, version: 1, objective: 'Older plan' }),
      1,
    );
    const newerPlan = plans.create(
      newerThread.id,
      'newer structured',
      structuredPlan({ threadId: newerThread.id, version: 1, objective: 'Newer plan' }),
      1,
    );
    plans.create(rawThread.id, 'newest raw only', null, 1);

    db.prepare('UPDATE plans SET created_at = ? WHERE id = ?').run(
      '2026-04-13T18:03:54.505Z',
      olderPlan.id,
    );
    db.prepare('UPDATE plans SET created_at = ? WHERE id = ?').run(
      '2026-04-13T18:12:36.879Z',
      newerPlan.id,
    );

    expect(plans.getLatestStructuredForIssue(projectId, 42)).toMatchObject({
      id: newerPlan.id,
      structured: expect.objectContaining({ objective: 'Newer plan' }),
    });
    expect(plans.getLatestStructuredForIssue(projectId, 404)).toBeNull();
  });

  it('getById() returns plan or null', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    expect(plans.getById(p.id)).toMatchObject({ id: p.id });
    expect(plans.getById('nonexistent')).toBeNull();
  });

  it('falls back to raw created_at values when they cannot be normalized', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    db.prepare('UPDATE plans SET created_at = ? WHERE id = ?').run('', p.id);

    expect(plans.getById(p.id)?.createdAt).toBe('');
  });

  it('updateStatus() changes plan status', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    plans.updateStatus(p.id, 'approval');
    expect(plans.getById(p.id)?.status).toBe('approval');
  });

  it('updateStructured() stores JSON', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    const structured = structuredPlan({ threadId });
    plans.updateStructured(p.id, structured);
    const updated = plans.getById(p.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected updated plan');
    expect(updated.structured).toEqual(structured);
  });

  it('getLatestStatusByThreadIds() returns latest plan status in batches', () => {
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/test-plan-status-batches').id;
    const threadIds = Array.from(
      { length: 905 },
      (_, index) => threads.create(projectId, `prompt ${index}`, `title ${index}`).id,
    );

    const firstOld = plans.create(threadIds[0], 'old', null, 1);
    const firstNew = plans.create(threadIds[0], 'new', null, 2);
    const lastPlan = plans.create(threadIds[904], 'last', null, 1);
    plans.updateStatus(firstOld.id, 'approved');
    plans.updateStatus(firstNew.id, 'rejected');
    plans.updateStatus(lastPlan.id, 'pending_review');

    expect(plans.getLatestStatusByThreadIds([])).toEqual(new Map());
    expect(plans.getLatestStatusByThreadIds(threadIds)).toEqual(
      new Map([
        [threadIds[0], 'rejected'],
        [threadIds[904], 'pending_review'],
      ]),
    );
  });

  it('supersedeAll() marks all non-superseded as superseded', () => {
    const p1 = plans.create(threadId, 'v1', null, 1);
    const p2 = plans.create(threadId, 'v2', null, 2);
    plans.updateStatus(p1.id, 'approved');

    plans.supersedeAll(threadId);

    expect(plans.getById(p1.id)?.status).toBe('superseded');
    expect(plans.getById(p2.id)?.status).toBe('superseded');
  });

  it('supersedeAllForIssue() supersedes plans on older runs for the same issue', () => {
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/test-issue-supersede').id;
    const olderThread = threads.create(projectId, 'prompt 1', 'title 1');
    const currentThread = threads.create(projectId, 'prompt 2', 'title 2');
    const otherIssueThread = threads.create(projectId, 'prompt 3', 'title 3');

    threads.setGithubIssue(olderThread.id, 38, 'owner/repo');
    threads.setGithubIssue(currentThread.id, 38, 'owner/repo');
    threads.setGithubIssue(otherIssueThread.id, 39, 'owner/repo');

    const olderPlan = plans.create(olderThread.id, 'old run', null, 1);
    const currentPlan = plans.create(currentThread.id, 'current run', null, 1);
    const otherIssuePlan = plans.create(otherIssueThread.id, 'other issue', null, 1);

    plans.updateStatus(olderPlan.id, 'pending_review');
    plans.updateStatus(currentPlan.id, 'pending_review');
    plans.updateStatus(otherIssuePlan.id, 'pending_review');

    plans.supersedeAllForIssue(projectId, 38, currentThread.id);

    expect(plans.getById(olderPlan.id)?.status).toBe('superseded');
    expect(plans.getById(currentPlan.id)?.status).toBe('pending_review');
    expect(plans.getById(otherIssuePlan.id)?.status).toBe('pending_review');
  });

  it('supersedeAllForIssue() can supersede every run for an issue', () => {
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/test-issue-supersede-all').id;
    const firstThread = threads.create(projectId, 'prompt 1', 'title 1');
    const secondThread = threads.create(projectId, 'prompt 2', 'title 2');

    threads.setGithubIssue(firstThread.id, 52, 'owner/repo');
    threads.setGithubIssue(secondThread.id, 52, 'owner/repo');

    const firstPlan = plans.create(firstThread.id, 'first', null, 1);
    const secondPlan = plans.create(secondThread.id, 'second', null, 1);

    plans.supersedeAllForIssue(projectId, 52);

    expect(plans.getById(firstPlan.id)?.status).toBe('superseded');
    expect(plans.getById(secondPlan.id)?.status).toBe('superseded');
  });
});
