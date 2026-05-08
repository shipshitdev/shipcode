import type { DatabaseSync } from 'node:sqlite';
import type {
  PipelinePhase,
  PipelinePhaseLogInsert,
  PipelinePhaseLogRecord,
  PipelinePhaseTerminalStatus,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface PipelinePhaseLogRow {
  id: string;
  thread_id: string;
  phase: PipelinePhase;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  terminal_status: PipelinePhaseTerminalStatus | null;
  error_message: string | null;
  metadata_json: string | null;
}

const UNTIMERED_PHASES = new Set<PipelinePhase>([
  'awaiting_approval',
  'clarifying',
  'completed',
  'failed',
  'idle',
]);

export class PhaseLogQueries {
  constructor(private db: DatabaseSync) {}

  transition(threadId: string, phase: PipelinePhase, errorMessage?: string | null): void {
    const now = new Date().toISOString();
    this.closeOpenRows(threadId, phase, errorMessage ?? null, now);
    this.create({
      threadId,
      phase,
      startedAt: now,
      metadata: null,
    });

    if (UNTIMERED_PHASES.has(phase)) {
      this.closeOpenRows(threadId, phase, errorMessage ?? null, now, { durationMs: null });
    }
  }

  create(input: PipelinePhaseLogInsert): PipelinePhaseLogRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO pipeline_phase_log (
           id,
           thread_id,
           phase,
           started_at,
           metadata_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.phase,
        input.startedAt ?? new Date().toISOString(),
        input.metadata ? JSON.stringify(input.metadata) : null,
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): PipelinePhaseLogRecord | null {
    const row = this.db.prepare('SELECT * FROM pipeline_phase_log WHERE id = ?').get(id);
    return row ? mapPhaseLog(asRow<PipelinePhaseLogRow>(row)) : null;
  }

  listByThread(threadId: string): PipelinePhaseLogRecord[] {
    return asRows<PipelinePhaseLogRow>(
      this.db
        .prepare(
          `SELECT *
             FROM pipeline_phase_log
            WHERE thread_id = ?
            ORDER BY started_at ASC, rowid ASC`,
        )
        .all(threadId),
    ).map(mapPhaseLog);
  }

  private closeOpenRows(
    threadId: string,
    terminalStatus: PipelinePhaseTerminalStatus,
    errorMessage: string | null,
    completedAt: string,
    options?: { durationMs?: number | null },
  ): void {
    const rows = asRows<Pick<PipelinePhaseLogRow, 'id' | 'started_at'>>(
      this.db
        .prepare(
          `SELECT id, started_at
             FROM pipeline_phase_log
            WHERE thread_id = ?
              AND completed_at IS NULL
            ORDER BY started_at ASC, rowid ASC`,
        )
        .all(threadId),
    );

    for (const row of rows) {
      const startedAtMs = Date.parse(row.started_at);
      const completedAtMs = Date.parse(completedAt);
      const durationMs =
        'durationMs' in (options ?? {})
          ? (options?.durationMs ?? null)
          : Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
            ? Math.max(0, completedAtMs - startedAtMs)
            : null;

      this.db
        .prepare(
          `UPDATE pipeline_phase_log
              SET completed_at = ?,
                  duration_ms = ?,
                  terminal_status = ?,
                  error_message = COALESCE(?, error_message)
            WHERE id = ?`,
        )
        .run(completedAt, durationMs, terminalStatus, errorMessage, row.id);
    }
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load pipeline phase log row: ${id}`);
  }
}

function mapPhaseLog(row: PipelinePhaseLogRow): PipelinePhaseLogRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    phase: row.phase,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    terminalStatus: row.terminal_status,
    errorMessage: row.error_message,
    metadata: parseMetadata(row.metadata_json),
  };
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
