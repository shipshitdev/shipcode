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
    });
    const second = checkpoints.create({
      threadId: thread.id,
      projectId: project.id,
      phase: 'executing',
      reason: 'before_retry',
      label: 'Before execute attempt 2',
      branch: 'ship/1-demo',
      commitSha: 'def456',
    });

    expect(checkpoints.getById(first.id)?.commitSha).toBe('abc123');
    expect(checkpoints.getLatest(thread.id)?.id).toBe(second.id);
    expect(checkpoints.list(thread.id).map((checkpoint) => checkpoint.id)).toEqual([
      second.id,
      first.id,
    ]);
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
      }),
    ).toThrow(/Failed to load checkpoint after insert/);
  });
});
