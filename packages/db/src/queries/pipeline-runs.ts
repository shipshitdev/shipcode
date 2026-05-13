import type { DatabaseSync } from 'node:sqlite';
import {
  ISO_NOW_SQL,
  type PipelinePhase,
  type PipelineRunFinishUpdate,
  type PipelineRunInsert,
  type PipelineRunRecord,
  type PipelineRunStatus,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface PipelineRunRow {
  id: string;
  thread_id: string;
  project_id: string | null;
  source: string;
  trigger_detail: string | null;
  status: PipelineRunStatus;
  current_phase: PipelinePhase | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  error_kind: string | null;
  context_json: string | null;
  retry_of_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export class PipelineRunQueries {
  constructor(private db: DatabaseSync) {}

  create(input: PipelineRunInsert): PipelineRunRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO pipeline_runs (
          id,
          thread_id,
          project_id,
          source,
          trigger_detail,
          current_phase,
          context_json,
          retry_of_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.projectId ?? null,
        input.source,
        input.triggerDetail ?? null,
        input.currentPhase ?? null,
        input.context ? JSON.stringify(input.context) : null,
        input.retryOfRunId ?? null,
      );

    this.db
      .prepare(`UPDATE threads SET current_run_id = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(id, input.threadId);

    return this.getById(id) ?? this.failLoad(id);
  }

  start(id: string, phase?: PipelinePhase | null): PipelineRunRecord {
    this.db
      .prepare(
        `UPDATE pipeline_runs
            SET status = CASE
                  WHEN status IN ('queued', 'running') THEN 'running'
                  ELSE status
                END,
                started_at = COALESCE(started_at, ${ISO_NOW_SQL}),
                current_phase = COALESCE(?, current_phase),
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(phase ?? null, id);
    return this.getById(id) ?? this.failLoad(id);
  }

  setPhase(id: string, phase: PipelinePhase): PipelineRunRecord {
    this.db
      .prepare(
        `UPDATE pipeline_runs
            SET current_phase = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(phase, id);
    return this.getById(id) ?? this.failLoad(id);
  }

  finish(id: string, update: PipelineRunFinishUpdate): PipelineRunRecord {
    const hasContext = update.context !== undefined;
    this.db
      .prepare(
        `UPDATE pipeline_runs
            SET status = ?,
                current_phase = COALESCE(?, current_phase),
                finished_at = COALESCE(finished_at, ${ISO_NOW_SQL}),
                error_message = ?,
                error_kind = ?,
                context_json = CASE WHEN ? THEN ? ELSE context_json END,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(
        update.status,
        update.currentPhase ?? null,
        update.errorMessage ?? null,
        update.errorKind ?? null,
        hasContext ? 1 : 0,
        hasContext && update.context ? JSON.stringify(update.context) : null,
        id,
      );

    this.db
      .prepare(
        `UPDATE threads
            SET current_run_id = NULL,
                updated_at = ${ISO_NOW_SQL}
          WHERE current_run_id = ?`,
      )
      .run(id);

    this.releaseIssueExecution(id);
    return this.getById(id) ?? this.failLoad(id);
  }

  markInterruptedForThread(threadId: string, message: string): PipelineRunRecord | null {
    const run = this.getCurrentForThread(threadId);
    if (!run) return null;
    return this.finish(run.id, {
      status: 'interrupted',
      currentPhase: run.currentPhase ?? undefined,
      errorKind: 'restart',
      errorMessage: message,
    });
  }

  getById(id: string): PipelineRunRecord | null {
    const row = this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id);
    return row ? mapRun(asRow<PipelineRunRow>(row)) : null;
  }

  getCurrentForThread(threadId: string): PipelineRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT pr.*
           FROM threads t
           JOIN pipeline_runs pr ON pr.id = t.current_run_id
          WHERE t.id = ?`,
      )
      .get(threadId);
    return row ? mapRun(asRow<PipelineRunRow>(row)) : null;
  }

  listByThread(threadId: string): PipelineRunRecord[] {
    return asRows<PipelineRunRow>(
      this.db
        .prepare(
          `SELECT *
             FROM pipeline_runs
            WHERE thread_id = ?
            ORDER BY created_at DESC, rowid DESC`,
        )
        .all(threadId),
    ).map(mapRun);
  }

  claimIssueExecution(input: { issueId: string; runId: string; owner: string | null }): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
            SET execution_run_id = ?,
                execution_locked_at = ${ISO_NOW_SQL},
                execution_lock_owner = ?
          WHERE id = ?
            AND (execution_run_id IS NULL OR execution_run_id = ?)`,
      )
      .run(input.runId, input.owner ?? null, input.issueId, input.runId);
    return Number(result.changes) > 0;
  }

  releaseIssueExecution(runId: string): void {
    this.db
      .prepare(
        `UPDATE github_issue_cache
            SET execution_run_id = NULL,
                execution_locked_at = NULL,
                execution_lock_owner = NULL
          WHERE execution_run_id = ?`,
      )
      .run(runId);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load pipeline run row: ${id}`);
  }
}

function mapRun(row: PipelineRunRow): PipelineRunRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    source: row.source,
    triggerDetail: row.trigger_detail,
    status: row.status,
    currentPhase: row.current_phase,
    startedAt: toIsoUtc(row.started_at),
    finishedAt: toIsoUtc(row.finished_at),
    errorMessage: row.error_message,
    errorKind: row.error_kind,
    context: parseContext(row.context_json),
    retryOfRunId: row.retry_of_run_id,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}

function parseContext(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
