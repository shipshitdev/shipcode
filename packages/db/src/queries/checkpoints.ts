import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { toIsoUtc } from '@shipcode/shared';
import type { PipelineCheckpoint, PipelineCheckpointPhase } from '@shipcode/shared/source';

function mapRow(row: any): PipelineCheckpoint {
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
      .all(threadId) as any[];
    return rows.map(mapRow);
  }

  getById(id: string): PipelineCheckpoint | null {
    const row = this.db.prepare('SELECT * FROM pipeline_checkpoints WHERE id = ?').get(id) as any;
    return row ? mapRow(row) : null;
  }

  getLatest(threadId: string): PipelineCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT * FROM pipeline_checkpoints
         WHERE thread_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(threadId) as any;
    return row ? mapRow(row) : null;
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
    return this.getById(id)!;
  }
}
