import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';
import { DiffQueries } from './diffs';

describe('DiffQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let threads: ThreadQueries;
  let diffs: DiffQueries;
  let projectId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    threads = new ThreadQueries(db);
    diffs = new DiffQueries(db);
    projectId = projects.add('/tmp/test-project').id;
    threadId = threads.create(projectId, 'some task', 'Task').id;
  });

  afterEach(() => {
    db.close();
  });

  it('list() returns empty array when no diffs exist', () => {
    expect(diffs.list(threadId)).toEqual([]);
  });

  it('create() stores a diff and returns a mapped record', () => {
    const d = diffs.create(threadId, 'src/foo.ts', 'modified', '- old\n+ new');
    expect(d.id).toBeTruthy();
    expect(d.threadId).toBe(threadId);
    expect(d.filePath).toBe('src/foo.ts');
    expect(d.action).toBe('modified');
    expect(d.diffContent).toBe('- old\n+ new');
    expect(d.beforeHash).toBeNull();
    expect(d.afterHash).toBeNull();
    expect(d.createdAt).toBeTruthy();
  });

  it('create() accepts null diffContent for deleted files', () => {
    const d = diffs.create(threadId, 'src/gone.ts', 'deleted', null);
    expect(d.diffContent).toBeNull();
    expect(d.action).toBe('deleted');
  });

  it('list() returns diffs ordered by created_at ASC', () => {
    diffs.create(threadId, 'a.ts', 'modified', 'diff a');
    diffs.create(threadId, 'b.ts', 'added', 'diff b');
    diffs.create(threadId, 'c.ts', 'deleted', null);

    const list = diffs.list(threadId);
    expect(list).toHaveLength(3);
    expect(list.map((d) => d.filePath)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('list() is scoped to a single thread', () => {
    const otherThread = threads.create(projectId, 'other', 'Other').id;
    diffs.create(threadId, 'mine.ts', 'modified', null);
    diffs.create(otherThread, 'theirs.ts', 'added', null);

    expect(diffs.list(threadId)).toHaveLength(1);
    expect(diffs.list(otherThread)).toHaveLength(1);
    expect(diffs.list(threadId)[0].filePath).toBe('mine.ts');
  });
});
