import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { DashboardQueries } from './dashboard';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('DashboardQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let dashboard: DashboardQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
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

  it('getStats().tasksBlocked and pendingApprovals count awaiting_approval threads', () => {
    const t = threads.create(projectId, 'needs approval', 'Approval');
    db.prepare(`UPDATE threads SET status = 'awaiting_approval' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.tasksBlocked).toBe(1);
    expect(stats.pendingApprovals).toBe(1);
    expect(stats.tasksInProgress).toBe(1); // awaiting_approval is still "in progress"
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

  it('getStats().agentsRunningByProject excludes awaiting_approval from count', () => {
    const t = threads.create(projectId, 'blocked', 'Blocked');
    db.prepare(`UPDATE threads SET status = 'awaiting_approval' WHERE id = ?`).run(t.id);

    const stats = dashboard.getStats();
    expect(stats.agentsRunningByProject[projectId]).toBeUndefined();
  });
});
