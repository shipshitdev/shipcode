import type { DatabaseSync } from 'node:sqlite';
import type {
  PipelineStepCompletionUpdate,
  PipelineStepInsert,
  PipelineStepPhase,
  PipelineStepRecord,
  PipelineStepStatus,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface PipelineStepRow {
  id: string;
  thread_id: string;
  phase: PipelineStepPhase;
  attempt: number;
  provider: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  status: PipelineStepStatus;
  error_kind: string | null;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

/**
 * Lifecycle envelope for a single provider invocation. `start()` inserts a
 * `started` row; `complete()` flips it to one of the terminal statuses and
 * fills in resolved model, tokens, error fields, and duration.
 */
export class PipelineStepQueries {
  constructor(private db: DatabaseSync) {}

  start(input: PipelineStepInsert): PipelineStepRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO pipeline_step_log (
          id, thread_id, phase, attempt, provider, requested_model, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'started')`,
      )
      .run(
        id,
        input.threadId,
        input.phase,
        input.attempt,
        input.provider ?? null,
        input.requestedModel ?? null,
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  complete(id: string, update: PipelineStepCompletionUpdate): PipelineStepRecord {
    const existing = this.getById(id);
    if (!existing) this.failLoad(id);
    const startedAtMs = Date.parse(existing.startedAt);
    const completedAtMs = Date.now();
    const durationMs = Number.isFinite(startedAtMs) ? completedAtMs - startedAtMs : null;

    this.db
      .prepare(
        `UPDATE pipeline_step_log
            SET status = ?,
                resolved_model = COALESCE(?, resolved_model),
                error_kind = ?,
                error_message = ?,
                prompt_tokens = COALESCE(?, prompt_tokens),
                completion_tokens = COALESCE(?, completion_tokens),
                cost_usd = COALESCE(?, cost_usd),
                completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                duration_ms = ?
          WHERE id = ?`,
      )
      .run(
        update.status,
        update.resolvedModel ?? null,
        update.errorKind ?? null,
        update.errorMessage ?? null,
        update.promptTokens ?? null,
        update.completionTokens ?? null,
        update.costUsd ?? null,
        durationMs,
        id,
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): PipelineStepRecord | null {
    const row = this.db.prepare('SELECT * FROM pipeline_step_log WHERE id = ?').get(id);
    return row ? mapRow(asRow<PipelineStepRow>(row)) : null;
  }

  listByThread(threadId: string): PipelineStepRecord[] {
    return asRows<PipelineStepRow>(
      this.db
        .prepare(
          // Tiebreak on rowid (sqlite's monotonic insert order) because
          // started_at resolution is milliseconds — bursts of inserts in the
          // same ms otherwise sort by random nanoid id.
          'SELECT * FROM pipeline_step_log WHERE thread_id = ? ORDER BY started_at ASC, rowid ASC',
        )
        .all(threadId),
    ).map(mapRow);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load pipeline step row: ${id}`);
  }
}

function mapRow(row: PipelineStepRow): PipelineStepRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    phase: row.phase,
    attempt: row.attempt,
    provider: row.provider,
    requestedModel: row.requested_model,
    resolvedModel: row.resolved_model,
    status: row.status,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
  };
}
