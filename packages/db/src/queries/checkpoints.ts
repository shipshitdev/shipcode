import type { DatabaseSync } from 'node:sqlite';
import type { PipelineCheckpoint, PipelineCheckpointPhase } from '@shipcode/shared';
import { toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface PipelineCheckpointRow {
  id: string;
  thread_id: string;
  project_id: string | null;
  phase: PipelineCheckpointPhase;
  reason: string;
  label: string;
  branch: string | null;
  commit_sha: string;
  ref_name: string | null;
  created_at: string;
}

/** Extract the checkpoint turn encoded in a ref name; null for legacy/no ref. */
function refTurn(refName: string | null): number | null {
  if (!refName) return null;
  const match = /\/turn\/(\d+)$/.exec(refName);
  return match ? Number.parseInt(match[1], 10) : null;
}

function mapRow(row: PipelineCheckpointRow): PipelineCheckpoint {
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    phase: row.phase as PipelineCheckpointPhase,
    reason: row.reason,
    label: row.label,
    branch: row.branch ?? null,
    commitSha: row.commit_sha,
    refName: row.ref_name ?? null,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
  };
}

export class CheckpointQueries {
  constructor(private db: DatabaseSync) {}

  list(threadId: string): PipelineCheckpoint[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pipeline_checkpoints
         WHERE thread_id = ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(threadId);
    return asRows<PipelineCheckpointRow>(rows).map(mapRow);
  }

  getById(id: string): PipelineCheckpoint | null {
    const row = this.db.prepare('SELECT * FROM pipeline_checkpoints WHERE id = ?').get(id);
    return row ? mapRow(asRow<PipelineCheckpointRow>(row)) : null;
  }

  getLatest(threadId: string): PipelineCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT * FROM pipeline_checkpoints
         WHERE thread_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId);
    return row ? mapRow(asRow<PipelineCheckpointRow>(row)) : null;
  }

  create(input: {
    threadId: string;
    projectId: string | null;
    phase: PipelineCheckpointPhase;
    reason: string;
    label: string;
    branch: string | null;
    commitSha: string;
    refName: string | null;
  }): PipelineCheckpoint {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO pipeline_checkpoints (
           id,
           thread_id,
           project_id,
           phase,
           reason,
           label,
           branch,
           commit_sha,
           ref_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.projectId,
        input.phase,
        input.reason,
        input.label,
        input.branch,
        input.commitSha,
        input.refName,
      );
    const checkpoint = this.getById(id);
    if (!checkpoint) {
      throw new Error(`Failed to load checkpoint after insert: ${id}`);
    }
    return checkpoint;
  }

  /**
   * Prune a thread's checkpoint rows whose ref turn is strictly greater than
   * `turn` (post-rollback cleanup, #328). Rows must be deleted alongside their
   * git refs — a surviving row whose turn is later reused would otherwise
   * resolve to unrelated content on restore. Legacy rows without a ref name
   * carry no turn and are never touched. Returns the number deleted.
   */
  deleteNewerThan(threadId: string, turn: number): number {
    return this.deleteByRefTurn(threadId, (t) => t > turn);
  }

  /**
   * Prune a thread's checkpoint rows whose ref turn is strictly less than
   * `turn` (capture-time GC that keeps only the most recent turns, #328).
   * Legacy rows without a ref name carry no turn and are never touched.
   * Returns the number deleted.
   */
  deleteOlderThan(threadId: string, turn: number): number {
    return this.deleteByRefTurn(threadId, (t) => t < turn);
  }

  private deleteByRefTurn(threadId: string, matches: (turn: number) => boolean): number {
    const rows = this.db
      .prepare('SELECT id, ref_name FROM pipeline_checkpoints WHERE thread_id = ?')
      .all(threadId);
    const ids = asRows<Pick<PipelineCheckpointRow, 'id' | 'ref_name'>>(rows).flatMap((row) => {
      const turn = refTurn(row.ref_name);
      return turn !== null && matches(turn) ? [row.id] : [];
    });
    if (ids.length === 0) return 0;
    const stmt = this.db.prepare('DELETE FROM pipeline_checkpoints WHERE id = ?');
    let deleted = 0;
    for (const id of ids) {
      deleted += Number(stmt.run(id).changes);
    }
    return deleted;
  }
}
