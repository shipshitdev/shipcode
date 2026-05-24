import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { NotificationsQueries } from './notifications';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('NotificationsQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let notifications: NotificationsQueries;
  let projectId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    threads = new ThreadQueries(db);
    notifications = new NotificationsQueries(db);
    projectId = projects.add('/tmp/test-project').id;
    const t = threads.create(projectId, 'some task', 'Task');
    threadId = t.id;
  });

  afterEach(() => {
    db.close();
  });

  it('create() stores a notification and returns it', () => {
    const n = notifications.create({
      threadId,
      projectId,
      kind: 'completed',
      title: 'Done',
      body: 'Pipeline finished',
    });
    expect(n.id).toBeTruthy();
    expect(n.threadId).toBe(threadId);
    expect(n.projectId).toBe(projectId);
    expect(n.kind).toBe('completed');
    expect(n.title).toBe('Done');
    expect(n.dismissedAt).toBeNull();
  });

  it('falls back to the raw timestamp when created_at is not ISO parseable', () => {
    const n = notifications.create({
      threadId,
      projectId,
      kind: 'completed',
      title: 'Raw timestamp',
      body: '',
    });
    db.prepare(`UPDATE notifications SET created_at = '' WHERE id = ?`).run(n.id);

    expect(notifications.listActive()[0].createdAt).toBe('');
  });

  it('listActive() returns only undismissed notifications', () => {
    const n1 = notifications.create({
      threadId,
      projectId,
      kind: 'completed',
      title: 'N1',
      body: '',
    });
    const n2 = notifications.create({ threadId, projectId, kind: 'failed', title: 'N2', body: '' });
    notifications.dismiss(n1.id);

    const active = notifications.listActive();
    expect(active.map((n) => n.id)).toEqual([n2.id]);
  });

  it('listByThread() returns undismissed notifications for a thread', () => {
    const otherThread = threads.create(projectId, 'other', 'Other').id;
    notifications.create({ threadId, projectId, kind: 'completed', title: 'Mine', body: '' });
    notifications.create({
      threadId: otherThread,
      projectId,
      kind: 'failed',
      title: 'Theirs',
      body: '',
    });

    const mine = notifications.listByThread(threadId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Mine');
  });

  it('dismiss() sets dismissed_at on a single notification', () => {
    const n = notifications.create({
      threadId,
      projectId,
      kind: 'completed',
      title: 'N',
      body: '',
    });
    expect(notifications.listActive()).toHaveLength(1);
    notifications.dismiss(n.id);
    expect(notifications.listActive()).toHaveLength(0);
  });

  it('dismissAll() clears all active notifications', () => {
    notifications.create({ threadId, projectId, kind: 'completed', title: 'A', body: '' });
    notifications.create({ threadId, projectId, kind: 'failed', title: 'B', body: '' });
    notifications.dismissAll();
    expect(notifications.listActive()).toHaveLength(0);
  });

  it('dismissByThread() clears active notifications for one thread only', () => {
    const otherThread = threads.create(projectId, 'other', 'Other').id;
    notifications.create({ threadId, projectId, kind: 'completed', title: 'Mine', body: '' });
    notifications.create({
      threadId: otherThread,
      projectId,
      kind: 'failed',
      title: 'Theirs',
      body: '',
    });

    notifications.dismissByThread(threadId);

    const active = notifications.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].threadId).toBe(otherThread);
  });

  it('activeCount() returns count of undismissed notifications', () => {
    expect(notifications.activeCount()).toBe(0);
    notifications.create({ threadId, projectId, kind: 'completed', title: 'N1', body: '' });
    notifications.create({ threadId, projectId, kind: 'failed', title: 'N2', body: '' });
    expect(notifications.activeCount()).toBe(2);
    notifications.dismissAll();
    expect(notifications.activeCount()).toBe(0);
  });

  it('create() accepts null projectId', () => {
    const n = notifications.create({
      threadId,
      projectId: null,
      kind: 'completed',
      title: 'Global',
      body: 'No project',
    });
    expect(n.projectId).toBeNull();
  });
});
