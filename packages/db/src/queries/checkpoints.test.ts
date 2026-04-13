import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
});
