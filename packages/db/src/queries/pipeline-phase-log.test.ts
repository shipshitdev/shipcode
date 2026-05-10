import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PhaseLogQueries } from './pipeline-phase-log';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('phase log queries', () => {
  let db: DatabaseSync;
  let threadId: string;
  let phaseLogs: PhaseLogQueries;

  beforeEach(() => {
    db = createTestDb();
    const projectId = new ProjectQueries(db).add('/tmp/phase-log').id;
    threadId = new ThreadQueries(db).create(projectId, 'prompt', 'Issue').id;
    phaseLogs = new PhaseLogQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates rows with metadata and returns null for missing ids', () => {
    const row = phaseLogs.create({
      threadId,
      phase: 'planning',
      startedAt: '2026-05-09T00:00:00.000Z',
      metadata: { attempt: 1, model: 'claude' },
    });

    expect(row).toMatchObject({
      threadId,
      phase: 'planning',
      startedAt: '2026-05-09T00:00:00.000Z',
      metadata: { attempt: 1, model: 'claude' },
    });
    expect(phaseLogs.getById('missing')).toBeNull();
  });

  it('uses default timestamps and fails loudly when a created row cannot be reloaded', () => {
    const defaulted = phaseLogs.create({
      threadId,
      phase: 'planning',
    });
    expect(defaulted.startedAt).toBeTruthy();
    expect(defaulted.metadata).toBeNull();

    const getById = vi.spyOn(phaseLogs, 'getById').mockReturnValueOnce(null);
    expect(() =>
      phaseLogs.create({
        threadId,
        phase: 'reviewing',
      }),
    ).toThrow('Failed to load pipeline phase log row');
    getById.mockRestore();
  });

  it('closes open rows with errors, preserves existing errors, and tolerates invalid dates', () => {
    const first = phaseLogs.create({
      threadId,
      phase: 'planning',
      startedAt: 'not-a-date',
    });

    phaseLogs.transition(threadId, 'executing', 'planner failed');
    phaseLogs.transition(threadId, 'completed');

    const rows = phaseLogs.listByThread(threadId);
    expect(rows).toHaveLength(3);
    const invalidStartedRow = rows.find((row) => row.id === first.id);
    const executingRow = rows.find((row) => row.phase === 'executing');
    const completedRow = rows.find((row) => row.phase === 'completed');

    expect(invalidStartedRow).toMatchObject({
      id: first.id,
      durationMs: null,
      terminalStatus: 'executing',
      errorMessage: 'planner failed',
    });
    expect(executingRow).toMatchObject({
      completedAt: completedRow?.startedAt,
      terminalStatus: 'completed',
      errorMessage: null,
    });
    expect(completedRow).toMatchObject({
      phase: 'completed',
      completedAt: completedRow?.startedAt,
      durationMs: null,
      terminalStatus: 'completed',
    });
  });

  it('returns null metadata for invalid stored JSON', () => {
    db.prepare(
      `INSERT INTO pipeline_phase_log (
        id, thread_id, phase, started_at, metadata_json
      ) VALUES ('phase-invalid-json', ?, 'planning', '2026-05-09T00:00:00.000Z', '{bad')`,
    ).run(threadId);

    expect(phaseLogs.getById('phase-invalid-json')?.metadata).toBeNull();
  });
});
