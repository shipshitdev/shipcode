import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { ProjectFailureQueries } from './project-failures';

describe('ProjectFailureQueries', () => {
  let db: DatabaseSync;
  let failures: ProjectFailureQueries;

  beforeEach(() => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES ('project-1', 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('owner-thread', 'project-1', 'go', 'Owner', 'idle', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('blocked-thread', 'project-1', 'go', 'Blocked', 'idle', datetime('now'), datetime('now'))",
    ).run();
    failures = new ProjectFailureQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates and claims a new project failure for the first seeing thread', () => {
    const record = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-1',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'expect(received).toBe(expected)',
      implicatedFiles: ['packages/a.test.ts'],
    });

    expect(record.status).toBe('in_progress');
    expect(record.ownerThreadId).toBe('owner-thread');
    expect(record.firstSeenThreadId).toBe('owner-thread');
    expect(record.seenThreadIds).toEqual(['owner-thread']);
    expect(record.implicatedFiles).toEqual(['packages/a.test.ts']);
  });

  it('does not transfer ownership when another thread sees the same open failure', () => {
    const owned = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-1',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'first',
      implicatedFiles: ['a.test.ts'],
    });

    const duplicate = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-1',
      threadId: 'blocked-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'second',
      implicatedFiles: ['a.test.ts'],
    });

    expect(duplicate.id).toBe(owned.id);
    expect(duplicate.ownerThreadId).toBe('owner-thread');
    expect(duplicate.seenThreadIds).toEqual(['owner-thread', 'blocked-thread']);
  });

  it('resolves all open failures owned by a thread', () => {
    const record = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-1',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'output',
      implicatedFiles: [],
    });

    expect(failures.resolveOwnedByThread('owner-thread', 'abc123')).toBe(1);

    const resolved = failures.getById(record.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedByThreadId).toBe('owner-thread');
    expect(resolved?.resolvedCommitSha).toBe('abc123');
    expect(resolved?.resolvedAt).toBeTruthy();
  });
});
