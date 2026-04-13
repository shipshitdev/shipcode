import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { CostsQueries } from './costs';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

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
    expect(proj1.totalCostUsd).toBeCloseTo(0.1);
    expect(proj1.taskCount).toBe(1);
  });

  it('listTasks() returns top tasks by cost', () => {
    const t = threads.create(projectId, 'expensive task', 'Expensive');
    db.prepare(
      `UPDATE threads
         SET status = 'completed',
             executor_model = 'openrouter',
             executor_resolved_model = 'anthropic/claude-sonnet-4-6',
             total_cost_usd = 0.99,
             total_tokens_prompt = 5000,
             total_tokens_completion = 2000
       WHERE id = ?`,
    ).run(t.id);

    const rows = costs.listTasks();
    expect(rows).toHaveLength(1);
    expect(rows[0].threadId).toBe(t.id);
    expect(rows[0].costUsd).toBeCloseTo(0.99);
    expect(rows[0].projectName).toBe('test-project');
    expect(rows[0].provider).toBe('openrouter');
    expect(rows[0].model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('listTasks() resolves phase-specific provider + model', () => {
    const planner = threads.create(projectId, 'planner task', 'Planner');
    const reviewer = threads.create(projectId, 'reviewer task', 'Reviewer');
    const executor = threads.create(projectId, 'executor task', 'Executor');
    const verifier = threads.create(projectId, 'verifier task', 'Verifier');

    db.prepare(
      `UPDATE threads
         SET status = 'planning',
             planner_model = 'claude',
             planner_resolved_model = 'claude',
             total_cost_usd = 0.10
       WHERE id = ?`,
    ).run(planner.id);

    db.prepare(
      `UPDATE threads
         SET status = 'reviewing',
             reviewer_model = 'codex',
             reviewer_resolved_model = 'openai/gpt-5-codex',
             total_cost_usd = 0.20
       WHERE id = ?`,
    ).run(reviewer.id);

    db.prepare(
      `UPDATE threads
         SET status = 'executing',
             executor_model = 'openrouter',
             executor_resolved_model = 'qwen/qwen3-coder:free',
             total_cost_usd = 0.30
       WHERE id = ?`,
    ).run(executor.id);

    db.prepare(
      `UPDATE threads
         SET status = 'verifying',
             verifier_model = 'claude',
             verifier_resolved_model = 'anthropic/claude-sonnet-4-6',
             total_cost_usd = 0.40
       WHERE id = ?`,
    ).run(verifier.id);

    const rows = costs.listTasks();
    expect(rows.map((row) => [row.title, row.provider, row.model])).toEqual([
      ['Verifier', 'claude', 'anthropic/claude-sonnet-4-6'],
      ['Executor', 'openrouter', 'qwen/qwen3-coder:free'],
      ['Reviewer', 'codex', 'openai/gpt-5-codex'],
      ['Planner', 'claude', 'claude'],
    ]);
  });

  it('countTasks() and listTasks() filter by project', () => {
    const otherProjectId = projects.add('/tmp/project-b').id;
    const t1 = threads.create(projectId, 'task 1', 'Task 1');
    const t2 = threads.create(otherProjectId, 'task 2', 'Task 2');

    db.prepare(`UPDATE threads SET status = 'completed', total_cost_usd = 0.12 WHERE id = ?`).run(
      t1.id,
    );
    db.prepare(`UPDATE threads SET status = 'completed', total_cost_usd = 0.34 WHERE id = ?`).run(
      t2.id,
    );

    expect(costs.countTasks()).toBe(2);
    expect(costs.countTasks(projectId)).toBe(1);
    expect(costs.listTasks(20, 0, projectId).map((row) => row.threadId)).toEqual([t1.id]);
  });
});
