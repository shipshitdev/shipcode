import type { DatabaseSync } from 'node:sqlite';
import type { ShipCodePlan } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

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
  });

  it('getById() returns plan or null', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    expect(plans.getById(p.id)).toMatchObject({ id: p.id });
    expect(plans.getById('nonexistent')).toBeNull();
  });

  it('updateStatus() changes plan status', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    plans.updateStatus(p.id, 'approved');
    expect(plans.getById(p.id)?.status).toBe('approved');
  });

  it('updateStructured() stores JSON', () => {
    const p = plans.create(threadId, 'raw', null, 1);
    const structured: ShipCodePlan = {
      id: 'plan-structured',
      threadId,
      version: 1,
      objective: 'Test plan objective',
      files: [],
      steps: [],
      acceptanceCriteria: [],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    };
    plans.updateStructured(p.id, structured);
    const updated = plans.getById(p.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected updated plan');
    expect(updated.structured).toEqual(structured);
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
});
