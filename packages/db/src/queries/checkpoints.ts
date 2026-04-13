import type { DatabaseSync } from 'node:sqlite';
import { toIsoUtc } from '@shipcode/shared';
import type { PipelineCheckpoint, PipelineCheckpointPhase } from '@shipcode/shared/source';
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
  created_at: string;
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
           commit_sha
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    const checkpoint = this.getById(id);
    if (!checkpoint) {
      throw new Error(`Failed to load checkpoint after insert: ${id}`);
    }
    return checkpoint;
  }
}
