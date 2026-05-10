import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('fails loudly when created or updated failure rows cannot be reloaded', () => {
    const getById = vi.spyOn(failures, 'getById').mockReturnValueOnce(null);
    expect(() =>
      failures.claimOrCreate({
        projectId: 'project-1',
        baseBranch: 'main',
        fingerprint: 'fp-load-new',
        threadId: 'owner-thread',
        command: 'bun test',
        summary: '1 failed',
        outputExcerpt: 'output',
        implicatedFiles: [],
      }),
    ).toThrow('Failed to load project failure row');
    getById.mockRestore();

    const record = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-load-existing',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'output',
      implicatedFiles: [],
    });
    const reload = vi.spyOn(failures, 'getById').mockReturnValueOnce(null);
    expect(() =>
      failures.claimOrCreate({
        projectId: 'project-1',
        baseBranch: 'main',
        fingerprint: record.fingerprint,
        threadId: 'blocked-thread',
        command: 'bun test',
        summary: 'still failed',
        outputExcerpt: 'output',
        implicatedFiles: [],
      }),
    ).toThrow('Failed to load project failure row');
    reload.mockRestore();
  });

  it('normalizes non-array failure metadata and blank timestamps', () => {
    db.prepare(
      `INSERT INTO project_failures (
         id,
         project_id,
         base_branch,
         fingerprint,
         status,
         owner_thread_id,
         first_seen_thread_id,
         seen_thread_ids,
         command,
         summary,
         output_excerpt,
         implicated_files,
         resolved_at,
         created_at,
         updated_at
       ) VALUES (
         'failure-weird',
         'project-1',
         'main',
         'fp-weird',
         'resolved',
         'owner-thread',
         'owner-thread',
         '{"not":"array"}',
         'bun test',
         'summary',
         'output',
         '{"not":"array"}',
         'not-a-date',
         '',
         ''
       )`,
    ).run();

    expect(failures.getById('failure-weird')).toMatchObject({
      seenThreadIds: [],
      implicatedFiles: [],
      resolvedAt: 'not-a-dateZ',
      createdAt: null,
      updatedAt: null,
    });
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

  it('matches null base branches, avoids duplicate seen threads, and claims ownerless open rows', () => {
    const owned = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: null,
      fingerprint: 'fp-null-base',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'first',
      implicatedFiles: ['a.test.ts'],
    });

    db.prepare(`UPDATE project_failures SET owner_thread_id = NULL WHERE id = ?`).run(owned.id);

    const reclaimed = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: null,
      fingerprint: 'fp-null-base',
      threadId: 'owner-thread',
      command: 'bun test --retry',
      summary: 'still failed',
      outputExcerpt: 'second',
      implicatedFiles: ['b.test.ts'],
    });

    expect(reclaimed.id).toBe(owned.id);
    expect(reclaimed.ownerThreadId).toBe('owner-thread');
    expect(reclaimed.seenThreadIds).toEqual(['owner-thread']);
    expect(reclaimed.command).toBe('bun test --retry');
    expect(reclaimed.implicatedFiles).toEqual(['b.test.ts']);
    expect(failures.getByFingerprint('project-1', null, 'fp-null-base')?.id).toBe(owned.id);
  });

  it('lists open failures by project newest first and parses malformed arrays defensively', () => {
    const first = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-list-1',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: 'first',
      outputExcerpt: 'first output',
      implicatedFiles: ['a.test.ts'],
    });
    const second = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-list-2',
      threadId: 'blocked-thread',
      command: 'bun test',
      summary: 'second',
      outputExcerpt: 'second output',
      implicatedFiles: ['b.test.ts'],
    });
    db.prepare(
      `UPDATE project_failures
          SET seen_thread_ids = 'not-json',
              implicated_files = '[1,"kept",false]',
              updated_at = '2026-05-02T00:00:00.000Z'
        WHERE id = ?`,
    ).run(second.id);
    db.prepare(
      `UPDATE project_failures SET updated_at = '2026-05-01T00:00:00.000Z' WHERE id = ?`,
    ).run(first.id);

    const rows = failures.listOpenForProject('project-1');

    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows[0].seenThreadIds).toEqual([]);
    expect(rows[0].implicatedFiles).toEqual(['kept']);
    expect(failures.listOpenForProject('missing-project')).toEqual([]);
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

  it('does not resolve already resolved or differently owned failures', () => {
    const owned = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-owned',
      threadId: 'owner-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'output',
      implicatedFiles: [],
    });
    const blocked = failures.claimOrCreate({
      projectId: 'project-1',
      baseBranch: 'main',
      fingerprint: 'fp-blocked',
      threadId: 'blocked-thread',
      command: 'bun test',
      summary: '1 failed',
      outputExcerpt: 'output',
      implicatedFiles: [],
    });

    expect(failures.resolveOwnedByThread('missing-thread', 'abc123')).toBe(0);
    expect(failures.resolveOwnedByThread('owner-thread', 'abc123')).toBe(1);
    expect(failures.resolveOwnedByThread('owner-thread', 'def456')).toBe(0);
    expect(failures.getById(owned.id)?.resolvedCommitSha).toBe('abc123');
    expect(failures.getById(blocked.id)?.status).toBe('in_progress');
    expect(failures.getById('missing-failure')).toBeNull();
  });
});
