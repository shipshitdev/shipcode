import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';
import { CostsQueries } from './costs';

describe('CostsQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let costs: CostsQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    threads = new ThreadQueries(db);
    costs = new CostsQueries(db);
    projectId = projects.add('/tmp/test-project').id;
  });

  afterEach(() => {
    db.close();
  });

  it('getSummary() returns zeros when no threads exist', () => {
    const summary = costs.getSummary();
    expect(summary.totalCostAllTime).toBe(0);
    expect(summary.totalCost7d).toBe(0);
    expect(summary.totalTokensAllTime).toBe(0);
    expect(summary.totalTokens7d).toBe(0);
    expect(summary.avgCostPerTask).toBe(0);
    expect(summary.avgTokensPerTask).toBe(0);
    expect(summary.byProject).toEqual([]);
    expect(summary.recentByTask).toEqual([]);
  });

  it('getSummary() excludes idle threads', () => {
    // idle thread should not count
    const t = threads.create(projectId, 'idle task', 'Idle');
    db.prepare(
      `UPDATE threads SET total_cost_usd = 1.0, total_tokens_prompt = 100 WHERE id = ?`,
    ).run(t.id);
    // status stays 'idle'
    const summary = costs.getSummary();
    expect(summary.totalCostAllTime).toBe(0);
    expect(summary.byProject).toEqual([]);
  });

  it('getSummary() aggregates cost and tokens across non-idle threads', () => {
    const t1 = threads.create(projectId, 'task 1', 'Task 1');
    const t2 = threads.create(projectId, 'task 2', 'Task 2');
    db.prepare(
      `UPDATE threads SET status = 'completed', total_cost_usd = 0.05, total_tokens_prompt = 1000, total_tokens_completion = 500 WHERE id = ?`,
    ).run(t1.id);
    db.prepare(
      `UPDATE threads SET status = 'completed', total_cost_usd = 0.03, total_tokens_prompt = 600, total_tokens_completion = 300 WHERE id = ?`,
    ).run(t2.id);

    const summary = costs.getSummary();
    expect(summary.totalCostAllTime).toBeCloseTo(0.08);
    expect(summary.totalTokensAllTime).toBe(1600);
    expect(summary.avgCostPerTask).toBeCloseTo(0.04);
    expect(summary.avgTokensPerTask).toBe(800);
  });

  it('getSummary().byProject groups costs by project', () => {
    const p2Id = projects.add('/tmp/other-project').id;
    const t1 = threads.create(projectId, 'task 1', 'Task 1');
    const t2 = threads.create(p2Id, 'task 2', 'Task 2');
    db.prepare(
      `UPDATE threads SET status = 'completed', total_cost_usd = 0.10, total_tokens_prompt = 1000, total_tokens_completion = 500 WHERE id = ?`,
    ).run(t1.id);
    db.prepare(
      `UPDATE threads SET status = 'failed', total_cost_usd = 0.02, total_tokens_prompt = 200, total_tokens_completion = 100 WHERE id = ?`,
    ).run(t2.id);

    const summary = costs.getSummary();
    expect(summary.byProject).toHaveLength(2);
    const proj1 = summary.byProject.find((p) => p.projectId === projectId)!;
    expect(proj1.totalCostUsd).toBeCloseTo(0.10);
    expect(proj1.taskCount).toBe(1);
  });

  it('getSummary().recentByTask returns top tasks by cost (max 20)', () => {
    const t = threads.create(projectId, 'expensive task', 'Expensive');
    db.prepare(
      `UPDATE threads SET status = 'completed', total_cost_usd = 0.99, total_tokens_prompt = 5000, total_tokens_completion = 2000 WHERE id = ?`,
    ).run(t.id);

    const summary = costs.getSummary();
    expect(summary.recentByTask).toHaveLength(1);
    expect(summary.recentByTask[0].threadId).toBe(t.id);
    expect(summary.recentByTask[0].costUsd).toBeCloseTo(0.99);
    expect(summary.recentByTask[0].projectName).toBe('test-project');
  });
});
