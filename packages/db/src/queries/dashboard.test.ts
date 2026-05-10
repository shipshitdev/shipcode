import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { DashboardQueries } from './dashboard';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('DashboardQueries', () => {
  let db: DatabaseSync;
  let plans: PlanQueries;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let dashboard: DashboardQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    plans = new PlanQueries(db);
    projects = new ProjectQueries(db);
    threads = new ThreadQueries(db);
    dashboard = new DashboardQueries(db);
    projectId = projects.add('/tmp/test-project').id;
  });

  afterEach(() => {
    db.close();
  });

  it('getStats() returns all zeros with no threads', () => {
    const stats = dashboard.getStats();
    expect(stats.agentsRunning).toBe(0);
    expect(stats.tasksInProgress).toBe(0);
    expect(stats.tasksOpen).toBe(0);
    expect(stats.tasksBlocked).toBe(0);
    expect(stats.pendingApprovals).toBe(0);
    expect(stats.staleApprovals).toBe(0);
    expect(stats.shippedLast7d).toBe(0);
    expect(stats.failedLast7d).toBe(0);
  });

  it('getStats().agentsRunning counts threads in agent-running phases', () => {
    const t1 = threads.create(projectId, 'a', 'A');
    const t2 = threads.create(projectId, 'b', 'B');
    db.prepare(`UPDATE threads SET status = 'planning' WHERE id = ?`).run(t1.id);
    db.prepare(`UPDATE threads SET status = 'executing' WHERE id = ?`).run(t2.id);

    const stats = dashboard.getStats();
    expect(stats.agentsRunning).toBe(2);
    expect(stats.runningByPhase.planning).toBe(1);
    expect(stats.runningByPhase.executing).toBe(1);
  });

  it('getStats().tasksBlocked and pendingApprovals count approval threads', () => {
    const t = threads.create(projectId, 'needs approval', 'Approval');
    db.prepare(`UPDATE threads SET status = 'approval' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.tasksBlocked).toBe(1);
    expect(stats.pendingApprovals).toBe(1);
    expect(stats.tasksInProgress).toBe(1); // approval is still "in progress"
  });

  it('getStats().shippedLast7d counts completed threads updated recently', () => {
    const t = threads.create(projectId, 'done', 'Done');
    db.prepare(`UPDATE threads SET status = 'completed' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.shippedLast7d).toBe(1);
  });

  it('getStats().failedLast7d counts failed threads updated recently', () => {
    const t = threads.create(projectId, 'broken', 'Broken');
    db.prepare(`UPDATE threads SET status = 'failed' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.failedLast7d).toBe(1);
  });

  it('ignores closed threads outside the recent window and counts stale approvals', () => {
    const oldCompleted = threads.create(projectId, 'old done', 'Old Done');
    const oldFailed = threads.create(projectId, 'old failed', 'Old Failed');
    const staleApproval = threads.create(projectId, 'stale approval', 'Stale Approval');
    db.prepare(`UPDATE threads SET status = 'completed', updated_at = ? WHERE id = ?`).run(
      '2000-01-01T00:00:00.000Z',
      oldCompleted.id,
    );
    db.prepare(`UPDATE threads SET status = 'failed', updated_at = ? WHERE id = ?`).run(
      '2000-01-01T00:00:00.000Z',
      oldFailed.id,
    );
    db.prepare(`UPDATE threads SET status = 'approval', updated_at = ? WHERE id = ?`).run(
      '2000-01-01T00:00:00.000Z',
      staleApproval.id,
    );

    const stats = dashboard.getStats();
    expect(stats.shippedLast7d).toBe(0);
    expect(stats.failedLast7d).toBe(0);
    expect(stats.staleApprovals).toBe(1);
  });

  it('getRecentTasks() returns non-idle threads with project name, paginated', () => {
    const t1 = threads.create(projectId, 'task a', 'Task A');
    const t2 = threads.create(projectId, 'task b', 'Task B');
    db.prepare(`UPDATE threads SET status = 'completed' WHERE id = ?`).run(t1.id);
    db.prepare(`UPDATE threads SET status = 'planning' WHERE id = ?`).run(t2.id);

    const page1 = dashboard.getRecentTasks(1, 0);
    expect(page1).toHaveLength(1);
    expect(page1[0].projectName).toBe('test-project');

    const all = dashboard.getRecentTasks(10, 0);
    expect(all).toHaveLength(2);
  });

  it('falls back to raw recent-task timestamps when they cannot be normalized', () => {
    const t = threads.create(projectId, 'task raw date', 'Task Raw Date');
    db.prepare(`UPDATE threads SET status = 'completed', updated_at = ? WHERE id = ?`).run(
      '',
      t.id,
    );

    expect(dashboard.getRecentTasks(1, 0)[0].updatedAt).toBe('');
  });

  it('getRecentTasks() excludes idle threads', () => {
    threads.create(projectId, 'idle task', 'Idle'); // status stays idle
    expect(dashboard.getRecentTasks()).toHaveLength(0);
  });

  it('countRecentTasks() counts non-idle threads', () => {
    const t = threads.create(projectId, 'active', 'Active');
    db.prepare(`UPDATE threads SET status = 'executing' WHERE id = ?`).run(t.id);
    threads.create(projectId, 'idle', 'Idle'); // stays idle

    expect(dashboard.countRecentTasks()).toBe(1);
  });

  it('getStats().agentsRunningByProject counts running threads per project', () => {
    const project2Id = projects.add('/tmp/test-project-2').id;
    const t1 = threads.create(projectId, 'task a', 'Task A');
    const t2 = threads.create(projectId, 'task b', 'Task B');
    const t3 = threads.create(project2Id, 'task c', 'Task C');
    db.prepare(`UPDATE threads SET status = 'planning' WHERE id = ?`).run(t1.id);
    db.prepare(`UPDATE threads SET status = 'executing' WHERE id = ?`).run(t2.id);
    db.prepare(`UPDATE threads SET status = 'verifying' WHERE id = ?`).run(t3.id);

    const stats = dashboard.getStats();
    expect(stats.agentsRunningByProject[projectId]).toBe(2);
    expect(stats.agentsRunningByProject[project2Id]).toBe(1);
  });

  it('getStats().agentsRunningByProject excludes approval from count', () => {
    const t = threads.create(projectId, 'blocked', 'Blocked');
    db.prepare(`UPDATE threads SET status = 'approval' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.agentsRunningByProject[projectId]).toBeUndefined();
  });

  it('getStats().pendingApprovalsByProject counts approval threads per project', () => {
    const project2Id = projects.add('/tmp/test-project-2').id;
    const t1 = threads.create(projectId, 'needs approval a', 'Approval A');
    const t2 = threads.create(projectId, 'needs approval b', 'Approval B');
    const t3 = threads.create(project2Id, 'needs approval c', 'Approval C');
    const t4 = threads.create(project2Id, 'executing', 'Executing');
    db.prepare(`UPDATE threads SET status = 'approval' WHERE id = ?`).run(t1.id);
    db.prepare(`UPDATE threads SET status = 'approval' WHERE id = ?`).run(t2.id);
    db.prepare(`UPDATE threads SET status = 'approval' WHERE id = ?`).run(t3.id);
    db.prepare(`UPDATE threads SET status = 'executing' WHERE id = ?`).run(t4.id);

    const stats = dashboard.getStats();
    expect(stats.pendingApprovalsByProject[projectId]).toBe(2);
    expect(stats.pendingApprovalsByProject[project2Id]).toBe(1);
    // executing thread should not appear in pendingApprovalsByProject
    expect(Object.keys(stats.pendingApprovalsByProject)).toHaveLength(2);
  });

  it('getStats().pendingApprovalsByProject returns empty object when no approvals pending', () => {
    const t = threads.create(projectId, 'executing', 'Executing');
    db.prepare(`UPDATE threads SET status = 'executing' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.pendingApprovalsByProject).toEqual({});
  });

  it('excludes approved execution-slot waiters from approval counts', () => {
    const t = threads.create(projectId, 'slot wait', 'Slot Wait');
    db.prepare(`UPDATE threads SET status = 'approval' WHERE id = ?`).run(t.id);
    const plan = plans.create(t.id, 'raw plan', null, 1);
    plans.updateStatus(plan.id, 'approved');

    const stats = dashboard.getStats();

    expect(stats.tasksBlocked).toBe(1);
    expect(stats.pendingApprovals).toBe(0);
    expect(stats.pendingApprovalsByProject).toEqual({});
    expect(stats.staleApprovals).toBe(0);
  });
});
