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
    const proj1 = summary.byProject.find((p) => p.projectId === projectId);
    expect(proj1).toBeDefined();
    if (!proj1) throw new Error('Expected project summary');
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

  it('normalizes blank task timestamps to null', () => {
    const t = threads.create(projectId, 'raw timestamp task', 'Raw timestamp');
    db.prepare(
      `UPDATE threads
          SET status = 'completed',
              total_cost_usd = 0.01,
              updated_at = ''
        WHERE id = ?`,
    ).run(t.id);

    expect(costs.listTasks()[0].updatedAt).toBeNull();
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

  it('listTasks() resolves planning aliases, revising, testing, paused, shipping, and fallback phases', () => {
    const clarifying = threads.create(projectId, 'clarifying task', 'Clarifying');
    const revising = threads.create(projectId, 'revising task', 'Revising');
    const testing = threads.create(projectId, 'testing task', 'Testing');
    const approval = threads.create(projectId, 'approval task', 'Approval');
    const paused = threads.create(projectId, 'paused task', 'Paused');
    const shipping = threads.create(projectId, 'shipping task', 'Shipping');
    const completedVerifier = threads.create(projectId, 'completed verifier', 'Completed verifier');
    const completedExecutor = threads.create(projectId, 'completed executor', 'Completed executor');
    const completedReviewerFallback = threads.create(
      projectId,
      'completed reviewer fallback',
      'Completed reviewer fallback',
    );
    const completedRevisorFallback = threads.create(
      projectId,
      'completed revisor fallback',
      'Completed revisor fallback',
    );
    const failedExecutorFallback = threads.create(
      projectId,
      'failed executor fallback',
      'Failed executor fallback',
    );
    const completedPlannerFallback = threads.create(
      projectId,
      'completed planner fallback',
      'Completed planner fallback',
    );
    const failedVerifierFallback = threads.create(
      projectId,
      'failed verifier fallback',
      'Failed verifier fallback',
    );
    const failedReviewerFallback = threads.create(
      projectId,
      'failed reviewer fallback',
      'Failed reviewer fallback',
    );
    const failedRevisorFallback = threads.create(
      projectId,
      'failed revisor fallback',
      'Failed revisor fallback',
    );
    const failedPlannerFallback = threads.create(
      projectId,
      'failed planner fallback',
      'Failed planner fallback',
    );

    const update = db.prepare(
      `UPDATE threads
         SET status = ?,
             planner_model = 'claude',
             reviewer_model = 'codex',
             executor_model = 'openrouter',
             verifier_model = 'claude',
             planner_resolved_model = ?,
             reviewer_resolved_model = ?,
             revisor_resolved_model = ?,
             executor_resolved_model = ?,
             verifier_resolved_model = ?,
             total_cost_usd = ?
       WHERE id = ?`,
    );

    update.run('clarifying', 'planner-model', null, null, null, null, 1.1, clarifying.id);
    update.run('revising', 'planner-model', null, 'revisor-model', null, null, 1.2, revising.id);
    update.run('testing', null, null, null, 'executor-model', null, 1.3, testing.id);
    update.run('approval', null, null, null, 'executor-model', null, 1.35, approval.id);
    update.run('paused', null, null, null, 'executor-model', null, 1.4, paused.id);
    update.run('shipping', null, null, null, null, 'verifier-model', 1.5, shipping.id);
    update.run(
      'completed',
      'planner-model',
      'reviewer-model',
      'revisor-model',
      'executor-model',
      'verifier-model',
      1.55,
      completedVerifier.id,
    );
    update.run(
      'completed',
      'planner-model',
      'reviewer-model',
      'revisor-model',
      'executor-model',
      null,
      1.56,
      completedExecutor.id,
    );
    update.run(
      'completed',
      'planner-model',
      'reviewer-model',
      null,
      null,
      null,
      1.6,
      completedReviewerFallback.id,
    );
    update.run(
      'completed',
      'planner-model',
      null,
      'revisor-model',
      null,
      null,
      1.65,
      completedRevisorFallback.id,
    );
    update.run(
      'completed',
      'planner-model',
      null,
      null,
      null,
      null,
      1.7,
      completedPlannerFallback.id,
    );
    update.run(
      'failed',
      'planner-model',
      null,
      null,
      'executor-model',
      null,
      1.75,
      failedExecutorFallback.id,
    );
    update.run(
      'failed',
      'planner-model',
      null,
      null,
      null,
      'verifier-model',
      1.8,
      failedVerifierFallback.id,
    );
    update.run(
      'failed',
      'planner-model',
      'reviewer-model',
      null,
      null,
      null,
      1.9,
      failedReviewerFallback.id,
    );
    update.run(
      'failed',
      'planner-model',
      null,
      'revisor-model',
      null,
      null,
      2.0,
      failedRevisorFallback.id,
    );
    update.run('failed', 'planner-model', null, null, null, null, 2.1, failedPlannerFallback.id);

    const byTitle = new Map(costs.listTasks(20).map((row) => [row.title, row]));

    expect(byTitle.get('Clarifying')).toMatchObject({ provider: 'claude', model: 'planner-model' });
    expect(byTitle.get('Revising')).toMatchObject({ provider: 'claude', model: 'revisor-model' });
    expect(byTitle.get('Testing')).toMatchObject({
      provider: 'openrouter',
      model: 'executor-model',
    });
    expect(byTitle.get('Approval')).toMatchObject({
      provider: 'openrouter',
      model: 'executor-model',
    });
    expect(byTitle.get('Paused')).toMatchObject({
      provider: 'openrouter',
      model: 'executor-model',
    });
    expect(byTitle.get('Shipping')).toMatchObject({ provider: 'claude', model: 'verifier-model' });
    expect(byTitle.get('Completed verifier')).toMatchObject({
      provider: 'claude',
      model: 'verifier-model',
    });
    expect(byTitle.get('Completed executor')).toMatchObject({
      provider: 'openrouter',
      model: 'executor-model',
    });
    expect(byTitle.get('Completed reviewer fallback')).toMatchObject({
      provider: 'codex',
      model: 'reviewer-model',
    });
    expect(byTitle.get('Completed revisor fallback')).toMatchObject({
      provider: 'claude',
      model: 'revisor-model',
    });
    expect(byTitle.get('Completed planner fallback')).toMatchObject({
      provider: 'claude',
      model: 'planner-model',
    });
    expect(byTitle.get('Failed executor fallback')).toMatchObject({
      provider: 'openrouter',
      model: 'executor-model',
    });
    expect(byTitle.get('Failed verifier fallback')).toMatchObject({
      provider: 'claude',
      model: 'verifier-model',
    });
    expect(byTitle.get('Failed reviewer fallback')).toMatchObject({
      provider: 'codex',
      model: 'reviewer-model',
    });
    expect(byTitle.get('Failed revisor fallback')).toMatchObject({
      provider: 'claude',
      model: 'revisor-model',
    });
    expect(byTitle.get('Failed planner fallback')).toMatchObject({
      provider: 'claude',
      model: 'planner-model',
    });
  });

  it('listTasksForIssue() returns non-idle rows for one project issue sorted by update time', () => {
    const otherProjectId = projects.add('/tmp/project-b').id;
    const first = threads.create(projectId, 'issue first', 'Issue first');
    const second = threads.create(projectId, 'issue second', 'Issue second');
    const idle = threads.create(projectId, 'issue idle', 'Issue idle');
    const otherProject = threads.create(otherProjectId, 'other issue', 'Other issue');

    const update = db.prepare(
      `UPDATE threads
         SET github_issue_number = ?,
             status = ?,
             executor_model = 'openrouter',
             executor_resolved_model = ?,
             total_cost_usd = ?,
             updated_at = ?
       WHERE id = ?`,
    );
    update.run(123, 'completed', 'model-a', 0.1, '2026-05-01 10:00:00', first.id);
    update.run(123, 'executing', 'model-b', 0.2, '2026-05-01 12:00:00', second.id);
    update.run(123, 'idle', 'model-idle', 0.3, '2026-05-01 13:00:00', idle.id);
    update.run(123, 'completed', 'model-other', 0.4, '2026-05-01 14:00:00', otherProject.id);

    const rows = costs.listTasksForIssue(projectId, 123);

    expect(rows.map((row) => row.threadId)).toEqual([second.id, first.id]);
    expect(rows[0]).toMatchObject({
      projectId,
      title: 'Issue second',
      provider: 'openrouter',
      model: 'model-b',
      costUsd: 0.2,
      updatedAt: '2026-05-01T12:00:00Z',
    });
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
