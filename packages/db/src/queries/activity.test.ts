import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';
import { ActivityQueries } from './activity';

describe('ActivityQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let activity: ActivityQueries;
  let projectId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    threads = new ThreadQueries(db);
    activity = new ActivityQueries(db);
    projectId = projects.add('/tmp/test-project').id;
    threadId = threads.create(projectId, 'some task', 'Task').id;
  });

  afterEach(() => {
    db.close();
  });

  it('create() stores an activity entry and returns it', () => {
    const entry = activity.create({
      threadId,
      projectId,
      kind: 'phase_change',
      actor: 'system',
      title: 'Phase changed to planning',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.threadId).toBe(threadId);
    expect(entry.projectId).toBe(projectId);
    expect(entry.kind).toBe('phase_change');
    expect(entry.actor).toBe('system');
    expect(entry.title).toBe('Phase changed to planning');
    expect(entry.subtitle).toBeNull();
    expect(entry.metadata).toBeNull();
    expect(entry.createdAt).toBeTruthy();
  });

  it('create() stores subtitle and metadata', () => {
    const entry = activity.create({
      threadId,
      projectId,
      kind: 'phase_change',
      actor: 'claude',
      title: 'Done',
      subtitle: 'All checks passed',
      metadata: { cost: 0.05, tokens: 1200 },
    });
    expect(entry.subtitle).toBe('All checks passed');
    expect(entry.metadata).toEqual({ cost: 0.05, tokens: 1200 });
  });

  it('create() accepts null threadId and projectId', () => {
    const entry = activity.create({
      threadId: null,
      projectId: null,
      kind: 'phase_change',
      actor: 'system',
      title: 'Global event',
    });
    expect(entry.threadId).toBeNull();
    expect(entry.projectId).toBeNull();
  });

  it('listRecent() returns entries ordered by created_at DESC', () => {
    const first = activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'First' });
    // Backdate 'First' so 'Second' is definitively newer
    db.prepare(`UPDATE activity_log SET created_at = datetime('now', '-1 hour') WHERE id = ?`).run(first.id);
    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'Second' });

    const entries = activity.listRecent();
    expect(entries[0].title).toBe('Second');
    expect(entries[1].title).toBe('First');
  });

  it('listRecent() filters by projectId when provided', () => {
    const otherId = projects.add('/tmp/other').id;
    const otherThread = threads.create(otherId, 'other task', 'Other').id;
    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'Mine' });
    activity.create({ threadId: otherThread, projectId: otherId, kind: 'phase_change', actor: 'system', title: 'Theirs' });

    const mine = activity.listRecent(50, projectId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Mine');
  });

  it('listRecent() respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: `Entry ${i}` });
    }
    const page1 = activity.listRecent(2, undefined, 0);
    expect(page1).toHaveLength(2);

    const page2 = activity.listRecent(2, undefined, 2);
    expect(page2).toHaveLength(2);

    expect(page1[0].title).not.toBe(page2[0].title);
  });

  it('countRecent() counts all entries without filter', () => {
    expect(activity.countRecent()).toBe(0);
    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'A' });
    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'B' });
    expect(activity.countRecent()).toBe(2);
  });

  it('countRecent() counts entries filtered by projectId', () => {
    const otherId = projects.add('/tmp/other').id;
    const otherThread = threads.create(otherId, 'other task', 'Other').id;
    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'Mine' });
    activity.create({ threadId: otherThread, projectId: otherId, kind: 'phase_change', actor: 'system', title: 'Theirs' });

    expect(activity.countRecent(projectId)).toBe(1);
    expect(activity.countRecent(otherId)).toBe(1);
    expect(activity.countRecent()).toBe(2);
  });

  it('listByThread() returns entries for a specific thread', () => {
    const otherThread = threads.create(projectId, 'other', 'Other').id;
    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'Mine' });
    activity.create({ threadId: otherThread, projectId, kind: 'phase_change', actor: 'system', title: 'Theirs' });

    const mine = activity.listByThread(threadId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Mine');
  });

  it('listByIssue() returns entries across all threads for the same issue', () => {
    const secondThread = threads.create(projectId, 'second', 'Second');
    const otherIssueThread = threads.create(projectId, 'third', 'Third');

    threads.setGithubIssue(threadId, 42, 'owner/repo');
    threads.setGithubIssue(secondThread.id, 42, 'owner/repo');
    threads.setGithubIssue(otherIssueThread.id, 43, 'owner/repo');

    activity.create({ threadId, projectId, kind: 'phase_change', actor: 'system', title: 'Run 1 started' });
    activity.create({
      threadId: secondThread.id,
      projectId,
      kind: 'phase_change',
      actor: 'system',
      title: 'Run 2 started',
    });
    db.prepare(`UPDATE activity_log SET created_at = datetime('now', '-1 hour') WHERE title = ?`).run(
      'Run 1 started',
    );
    activity.create({
      threadId: otherIssueThread.id,
      projectId,
      kind: 'phase_change',
      actor: 'system',
      title: 'Other issue started',
    });

    const entries = activity.listByIssue(projectId, 42);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.title)).toEqual(['Run 2 started', 'Run 1 started']);
  });
});
