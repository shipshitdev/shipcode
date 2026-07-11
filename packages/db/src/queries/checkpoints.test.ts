import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from '../index';
import { CheckpointQueries } from './checkpoints';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('CheckpointQueries', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    closeDatabase();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates and lists checkpoints newest-first', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-db-checkpoints-'));
    tempDirs.push(dataDir);
    const db = getDatabase(dataDir);
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const checkpoints = new CheckpointQueries(db);

    const project = projects.add('/tmp/checkpoints-project');
    const thread = threads.create(project.id, 'Prompt', 'Thread title');

    const first = checkpoints.create({
      threadId: thread.id,
      projectId: project.id,
      phase: 'executing',
      reason: 'before_execute',
      label: 'Before execute attempt 1',
      branch: 'ship/1-demo',
      commitSha: 'abc123',
      refName: `refs/shipcode/checkpoints/${thread.id}/turn/0`,
    });
    const second = checkpoints.create({
      threadId: thread.id,
      projectId: project.id,
      phase: 'executing',
      reason: 'before_retry',
      label: 'Before execute attempt 2',
      branch: 'ship/1-demo',
      commitSha: 'def456',
      refName: null,
    });

    expect(checkpoints.getById(first.id)?.commitSha).toBe('abc123');
    expect(checkpoints.getById(first.id)?.refName).toBe(
      `refs/shipcode/checkpoints/${thread.id}/turn/0`,
    );
    expect(checkpoints.getById(second.id)?.refName).toBeNull();
    expect(checkpoints.getLatest(thread.id)?.id).toBe(second.id);
    expect(checkpoints.list(thread.id).map((checkpoint) => checkpoint.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('prunes rows newer than a turn on rollback, then reuses the turn cleanly (#328)', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-db-checkpoints-'));
    tempDirs.push(dataDir);
    const db = getDatabase(dataDir);
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const checkpoints = new CheckpointQueries(db);

    const project = projects.add('/tmp/checkpoints-prune');
    const thread = threads.create(project.id, 'Prompt', 'Thread title');

    const make = (turn: number, commitSha: string) =>
      checkpoints.create({
        threadId: thread.id,
        projectId: project.id,
        phase: 'executing',
        reason: 'before_execute',
        label: `turn ${turn}`,
        branch: 'ship/1-demo',
        commitSha,
        refName: `refs/shipcode/checkpoints/${thread.id}/turn/${turn}`,
      });
    // A legacy row with no ref (null turn) must never be pruned by turn range.
    const legacy = checkpoints.create({
      threadId: thread.id,
      projectId: project.id,
      phase: 'executing',
      reason: 'before_execute',
      label: 'legacy',
      branch: null,
      commitSha: 'legacy-sha',
      refName: null,
    });
    make(0, 'sha0');
    make(1, 'sha1');
    make(2, 'sha2');
    make(3, 'sha3');

    // Restore to turn 1: rows 2 and 3 are stale and must be deleted with the refs.
    expect(checkpoints.deleteNewerThan(thread.id, 1)).toBe(2);

    const remainingTurns = checkpoints
      .list(thread.id)
      .map((c) => (c.refName ? Number(/\/turn\/(\d+)$/.exec(c.refName)?.[1]) : 'legacy'));
    expect(remainingTurns).toEqual(expect.arrayContaining([0, 1, 'legacy']));
    expect(remainingTurns).not.toContain(2);
    expect(remainingTurns).not.toContain(3);
    // Legacy null-ref row survives.
    expect(checkpoints.getById(legacy.id)).not.toBeNull();

    // Recapture reusing turn 2 with fresh content: no stale turn-2 row lingers,
    // so getLatest resolves to the new row, not the old one.
    const reused = make(2, 'sha2-new');
    expect(checkpoints.getLatest(thread.id)?.id).toBe(reused.id);
    expect(checkpoints.getLatest(thread.id)?.commitSha).toBe('sha2-new');
    // Exactly one row now carries the turn-2 ref name.
    const turn2Rows = checkpoints
      .list(thread.id)
      .filter((c) => c.refName === `refs/shipcode/checkpoints/${thread.id}/turn/2`);
    expect(turn2Rows).toHaveLength(1);
  });

  it('prunes rows older than a turn for capture-time GC, sparing legacy rows (#328)', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-db-checkpoints-'));
    tempDirs.push(dataDir);
    const db = getDatabase(dataDir);
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const checkpoints = new CheckpointQueries(db);

    const project = projects.add('/tmp/checkpoints-gc');
    const thread = threads.create(project.id, 'Prompt', 'Thread title');
    const other = threads.create(project.id, 'Prompt', 'Other');

    const make = (threadId: string, turn: number) =>
      checkpoints.create({
        threadId,
        projectId: project.id,
        phase: 'executing',
        reason: 'before_execute',
        label: `turn ${turn}`,
        branch: null,
        commitSha: `sha-${turn}`,
        refName: `refs/shipcode/checkpoints/${threadId}/turn/${turn}`,
      });
    const legacy = checkpoints.create({
      threadId: thread.id,
      projectId: project.id,
      phase: 'executing',
      reason: 'before_execute',
      label: 'legacy',
      branch: null,
      commitSha: 'legacy-sha',
      refName: null,
    });
    for (let i = 0; i < 4; i++) make(thread.id, i);
    make(other.id, 0);

    // Keep the two most recent turns (2, 3): drop turns < 2.
    expect(checkpoints.deleteOlderThan(thread.id, 2)).toBe(2);
    const turns = checkpoints
      .list(thread.id)
      .flatMap((c) => (c.refName ? [Number(/\/turn\/(\d+)$/.exec(c.refName)?.[1])] : []));
    expect(turns.sort((a, b) => a - b)).toEqual([2, 3]);
    // Legacy row and other thread untouched.
    expect(checkpoints.getById(legacy.id)).not.toBeNull();
    expect(checkpoints.list(other.id)).toHaveLength(1);
  });

  it('maps null branch and invalid timestamps, returns null for missing rows, and fails if insert reload is missing', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-db-checkpoints-'));
    tempDirs.push(dataDir);
    const db = getDatabase(dataDir);
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const checkpoints = new CheckpointQueries(db);

    const project = projects.add('/tmp/checkpoints-project-mapping');
    const thread = threads.create(project.id, 'Prompt', 'Thread title');

    db.prepare(
      `INSERT INTO pipeline_checkpoints (
        id, thread_id, project_id, phase, reason, label, branch, commit_sha, created_at
      ) VALUES (
        'checkpoint-invalid-date', ?, ?, 'verifying', 'before_verify', 'Before verify', NULL, 'abc123', ''
      )`,
    ).run(thread.id, project.id);

    const row = checkpoints.getById('checkpoint-invalid-date');
    expect(row).toMatchObject({
      id: 'checkpoint-invalid-date',
      branch: null,
      refName: null,
      createdAt: '',
    });
    expect(checkpoints.getById('missing')).toBeNull();
    expect(checkpoints.getLatest('missing-thread')).toBeNull();

    const broken = new CheckpointQueries(db);
    broken.getById = () => null;
    expect(() =>
      broken.create({
        threadId: thread.id,
        projectId: project.id,
        phase: 'verifying',
        reason: 'before_verify',
        label: 'Before verify',
        branch: null,
        commitSha: 'def456',
        refName: null,
      }),
    ).toThrow(/Failed to load checkpoint after insert/);
  });
});
