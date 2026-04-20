import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { DiffQueries } from './diffs';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

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
    const d = diffs.create(threadId, 'src/foo.ts', 'modify', '- old\n+ new');
    expect(d.id).toBeTruthy();
    expect(d.threadId).toBe(threadId);
    expect(d.filePath).toBe('src/foo.ts');
    expect(d.action).toBe('modify');
    expect(d.diffContent).toBe('- old\n+ new');
    expect(d.beforeHash).toBeNull();
    expect(d.afterHash).toBeNull();
    expect(d.createdAt).toBeTruthy();
  });

  it('create() accepts null diffContent for deleted files', () => {
    const d = diffs.create(threadId, 'src/gone.ts', 'delete', null);
    expect(d.diffContent).toBeNull();
    expect(d.action).toBe('delete');
  });

  it('list() returns diffs ordered by created_at ASC', () => {
    diffs.create(threadId, 'a.ts', 'modify', 'diff a');
    diffs.create(threadId, 'b.ts', 'create', 'diff b');
    diffs.create(threadId, 'c.ts', 'delete', null);

    const list = diffs.list(threadId);
    expect(list).toHaveLength(3);
    expect(list.map((d) => d.filePath)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('list() is scoped to a single thread', () => {
    const otherThread = threads.create(projectId, 'other', 'Other').id;
    diffs.create(threadId, 'mine.ts', 'modify', null);
    diffs.create(otherThread, 'theirs.ts', 'create', null);

    expect(diffs.list(threadId)).toHaveLength(1);
    expect(diffs.list(otherThread)).toHaveLength(1);
    expect(diffs.list(threadId)[0].filePath).toBe('mine.ts');
  });

  it('replaceForThread() clears stale rows and preserves input order', () => {
    diffs.create(threadId, 'stale.ts', 'modify', 'old diff');

    const replaced = diffs.replaceForThread(threadId, [
      {
        filePath: 'src/new-a.ts',
        action: 'modify',
        diffContent: '@@ -1 +1 @@\n-old\n+new',
        beforeHash: '1111111',
        afterHash: '2222222',
      },
      {
        filePath: 'src/new-b.ts',
        action: 'create',
        diffContent: '@@ -0,0 +1 @@\n+hello',
        beforeHash: null,
        afterHash: '3333333',
      },
    ]);

    expect(replaced).toHaveLength(2);
    expect(replaced.map((diff) => diff.filePath)).toEqual(['src/new-a.ts', 'src/new-b.ts']);

    const listed = diffs.list(threadId);
    expect(listed).toHaveLength(2);
    expect(listed.map((diff) => diff.filePath)).toEqual(['src/new-a.ts', 'src/new-b.ts']);
    expect(listed[0]).toMatchObject({
      action: 'modify',
      beforeHash: '1111111',
      afterHash: '2222222',
    });
    expect(listed[1]).toMatchObject({
      action: 'create',
      beforeHash: null,
      afterHash: '3333333',
    });
  });
});
