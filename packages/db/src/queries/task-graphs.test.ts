import type { DatabaseSync } from 'node:sqlite';
import type { ShipCodePlan } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { TaskGraphQueries } from './task-graphs';
import { ThreadQueries } from './threads';

function plan(overrides: Partial<ShipCodePlan> = {}): ShipCodePlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    objective: 'Add task graph persistence',
    files: [
      { path: 'packages/db/src/schema.ts', action: 'modify', description: 'schema' },
      { path: 'packages/db/src/queries/task-graphs.ts', action: 'create', description: 'query' },
      { path: 'packages/shared/src/task-graph.ts', action: 'create', description: 'types' },
      { path: 'packages/pipeline/src/pipeline.ts', action: 'modify', description: 'wire' },
    ],
    steps: [
      {
        order: 1,
        description: 'Create task graph tables',
        files: ['packages/db/src/schema.ts'],
        rationale: 'Persist graph',
      },
      {
        order: 2,
        description: 'Add task graph queries',
        files: ['packages/db/src/queries/task-graphs.ts'],
        rationale: 'Read and write graph',
      },
      {
        order: 3,
        description: 'Wire pipeline persistence',
        files: ['packages/pipeline/src/pipeline.ts'],
        rationale: 'Create graph after planning',
      },
    ],
    acceptanceCriteria: ['Task graph is persisted for a structured plan'],
    outOfScope: [],
    estimatedComplexity: 'medium',
    dependencies: [],
    ...overrides,
  };
}

describe('TaskGraphQueries', () => {
  let db: DatabaseSync;
  let taskGraphs: TaskGraphQueries;
  let plans: PlanQueries;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    const projectId = new ProjectQueries(db).add('/tmp/task-graph-project').id;
    threadId = new ThreadQueries(db).create(projectId, 'prompt', 'Issue').id;
    plans = new PlanQueries(db);
    taskGraphs = new TaskGraphQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('replaces the active graph for a plan and persists ordered nodes and edges', () => {
    const firstPlan = plans.create(threadId, 'raw', plan(), 1);

    const graph = taskGraphs.replaceForPlan(threadId, firstPlan.id, plan());

    expect(graph.threadId).toBe(threadId);
    expect(graph.planId).toBe(firstPlan.id);
    expect(graph.mode).toBe('internal');
    expect(graph.nodes.map((node) => [node.stableKey, node.status])).toEqual([
      ['step-1', 'ready'],
      ['step-2', 'pending'],
      ['step-3', 'pending'],
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(taskGraphs.getByPlanId(firstPlan.id)?.id).toBe(graph.id);
  });

  it('supersedes prior active graphs when a new plan graph is created', () => {
    const firstPlan = plans.create(threadId, 'raw', plan(), 1);
    const firstGraph = taskGraphs.replaceForPlan(threadId, firstPlan.id, plan());
    const secondPlan = plans.create(threadId, 'raw 2', plan({ version: 2 }), 2);
    const secondGraph = taskGraphs.replaceForPlan(threadId, secondPlan.id, plan({ version: 2 }));

    expect(taskGraphs.getById(firstGraph.id)?.status).toBe('superseded');
    expect(taskGraphs.getById(secondGraph.id)?.status).toBe('active');
    expect(taskGraphs.getLatestByThread(threadId)?.id).toBe(secondGraph.id);
  });

  it('updates node lifecycle status with timestamps', () => {
    const planRecord = plans.create(threadId, 'raw', plan(), 1);
    const graph = taskGraphs.replaceForPlan(threadId, planRecord.id, plan());
    const node = graph.nodes[0];

    const running = taskGraphs.updateNodeStatus(node.id, 'running');
    const completed = taskGraphs.updateNodeStatus(node.id, 'completed');

    expect(running.status).toBe('running');
    expect(running.startedAt).toBeTruthy();
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
  });

  it('stores the GitHub issue number created for a task node', () => {
    const planRecord = plans.create(threadId, 'raw', plan(), 1);
    const graph = taskGraphs.replaceForPlan(threadId, planRecord.id, plan());

    const updated = taskGraphs.updateNodeGithubIssueNumber(graph.nodes[0].id, 99);

    expect(updated.nodes[0].githubIssueNumber).toBe(99);
    expect(taskGraphs.getNodeById(graph.nodes[0].id)?.githubIssueNumber).toBe(99);
  });

  it('promotes dependents only after prerequisites complete', () => {
    const planRecord = plans.create(threadId, 'raw', plan(), 1);
    const graph = taskGraphs.replaceForPlan(threadId, planRecord.id, plan());

    expect(taskGraphs.getNextReadyNode(graph.id)?.stableKey).toBe('step-1');

    const afterFirst = taskGraphs.markNodeCompletedAndPromote(graph.nodes[0].id);
    expect(afterFirst.nodes.map((node) => [node.stableKey, node.status])).toEqual([
      ['step-1', 'completed'],
      ['step-2', 'ready'],
      ['step-3', 'pending'],
    ]);

    const afterSecond = taskGraphs.markNodeCompletedAndPromote(afterFirst.nodes[1].id);
    expect(afterSecond.nodes.map((node) => [node.stableKey, node.status])).toEqual([
      ['step-1', 'completed'],
      ['step-2', 'completed'],
      ['step-3', 'ready'],
    ]);
  });

  it('marks the graph completed after the final node completes', () => {
    const planRecord = plans.create(threadId, 'raw', plan(), 1);
    let graph = taskGraphs.replaceForPlan(threadId, planRecord.id, plan());

    for (const node of graph.nodes) {
      graph = taskGraphs.markNodeCompletedAndPromote(node.id);
    }

    expect(graph.status).toBe('completed');
    expect(graph.nodes.every((node) => node.status === 'completed')).toBe(true);
  });

  it('resets terminal node statuses for an execution retry', () => {
    const planRecord = plans.create(threadId, 'raw', plan(), 1);
    let graph = taskGraphs.replaceForPlan(threadId, planRecord.id, plan());
    graph = taskGraphs.markNodeFailed(graph.nodes[0].id);

    const reset = taskGraphs.resetForRetry(graph.id);

    expect(reset.status).toBe('active');
    expect(
      reset.nodes.map((node) => [node.stableKey, node.status, node.startedAt, node.completedAt]),
    ).toEqual([
      ['step-1', 'ready', null, null],
      ['step-2', 'pending', null, null],
      ['step-3', 'pending', null, null],
    ]);
  });
});
