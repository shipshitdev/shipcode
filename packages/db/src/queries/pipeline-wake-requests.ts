import type { DatabaseSync } from 'node:sqlite';
import {
  ISO_NOW_SQL,
  type PipelineWakeRequestInsert,
  type PipelineWakeRequestKind,
  type PipelineWakeRequestRecord,
  type PipelineWakeRequestStatus,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows, transaction } from '../utils';

interface PipelineWakeRequestRow {
  id: string;
  kind: PipelineWakeRequestKind;
  source: string;
  reason: string;
  target_type: string;
  target_id: string;
  project_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  idempotency_key: string | null;
  status: PipelineWakeRequestStatus;
  scheduled_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  coalesced_count: number;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export class PipelineWakeRequestQueries {
  constructor(private db: DatabaseSync) {}

  enqueue(input: PipelineWakeRequestInsert): PipelineWakeRequestRecord {
    return transaction(this.db, () => {
      const scheduledAt = input.scheduledAt ?? new Date().toISOString();
      const existing = input.idempotencyKey
        ? this.getActiveByIdempotencyKey(input.idempotencyKey)
        : null;

      if (existing) {
        this.db
          .prepare(
            `UPDATE pipeline_wake_requests
                SET reason = ?,
                    project_id = COALESCE(?, project_id),
                    thread_id = COALESCE(?, thread_id),
                    run_id = COALESCE(?, run_id),
                    scheduled_at = CASE
                      WHEN scheduled_at <= ? THEN scheduled_at
                      ELSE ?
                    END,
                    payload_json = CASE WHEN ? THEN ? ELSE payload_json END,
                    coalesced_count = coalesced_count + 1,
                    updated_at = ${ISO_NOW_SQL}
              WHERE id = ?`,
          )
          .run(
            input.reason,
            input.projectId ?? null,
            input.threadId ?? null,
            input.runId ?? null,
            scheduledAt,
            scheduledAt,
            input.payload !== undefined ? 1 : 0,
            input.payload ? JSON.stringify(input.payload) : null,
            existing.id,
          );
        return this.getById(existing.id) ?? this.failLoad(existing.id);
      }

      const id = nanoid();
      this.db
        .prepare(
          `INSERT INTO pipeline_wake_requests (
            id,
            kind,
            source,
            reason,
            target_type,
            target_id,
            project_id,
            thread_id,
            run_id,
            idempotency_key,
            scheduled_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.kind,
          input.source,
          input.reason,
          input.targetType,
          input.targetId,
          input.projectId ?? null,
          input.threadId ?? null,
          input.runId ?? null,
          input.idempotencyKey ?? null,
          scheduledAt,
          input.payload ? JSON.stringify(input.payload) : null,
        );
      return this.getById(id) ?? this.failLoad(id);
    });
  }

  peekNextPending(filter?: { kind?: PipelineWakeRequestKind }): PipelineWakeRequestRecord | null {
    const now = new Date().toISOString();
    const row = filter?.kind
      ? this.db
          .prepare(
            `SELECT *
               FROM pipeline_wake_requests
              WHERE status = 'pending'
                AND kind = ?
                AND scheduled_at <= ?
              ORDER BY scheduled_at ASC, created_at ASC, rowid ASC
              LIMIT 1`,
          )
          .get(filter.kind, now)
      : this.db
          .prepare(
            `SELECT *
               FROM pipeline_wake_requests
              WHERE status = 'pending'
                AND scheduled_at <= ?
              ORDER BY scheduled_at ASC, created_at ASC, rowid ASC
              LIMIT 1`,
          )
          .get(now);
    return row ? mapWakeRequest(asRow<PipelineWakeRequestRow>(row)) : null;
  }

  claim(id: string, owner: string): PipelineWakeRequestRecord | null {
    const result = this.db
      .prepare(
        `UPDATE pipeline_wake_requests
            SET status = 'claimed',
                claimed_at = ${ISO_NOW_SQL},
                claimed_by = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?
            AND status = 'pending'
            AND scheduled_at <= ?`,
      )
      .run(owner, id, new Date().toISOString());
    if (Number(result.changes) === 0) return null;
    return this.getById(id) ?? this.failLoad(id);
  }

  claimNext(
    owner: string,
    filter?: { kind?: PipelineWakeRequestKind },
  ): PipelineWakeRequestRecord | null {
    return transaction(this.db, () => {
      const next = this.peekNextPending(filter);
      if (!next) return null;
      return this.claim(next.id, owner);
    });
  }

  defer(
    id: string,
    scheduledAt?: string | null,
    reason?: string | null,
  ): PipelineWakeRequestRecord {
    this.db
      .prepare(
        `UPDATE pipeline_wake_requests
            SET status = 'pending',
                scheduled_at = COALESCE(?, scheduled_at),
                reason = COALESCE(?, reason),
                claimed_at = NULL,
                claimed_by = NULL,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(scheduledAt ?? null, reason ?? null, id);
    return this.getById(id) ?? this.failLoad(id);
  }

  complete(id: string): PipelineWakeRequestRecord {
    this.db
      .prepare(
        `UPDATE pipeline_wake_requests
            SET status = 'completed',
                completed_at = COALESCE(completed_at, ${ISO_NOW_SQL}),
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(id);
    return this.getById(id) ?? this.failLoad(id);
  }

  fail(id: string, error: string): PipelineWakeRequestRecord {
    this.db
      .prepare(
        `UPDATE pipeline_wake_requests
            SET status = 'failed',
                failed_at = COALESCE(failed_at, ${ISO_NOW_SQL}),
                last_error = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(error.slice(0, 1000), id);
    return this.getById(id) ?? this.failLoad(id);
  }

  cancel(id: string): PipelineWakeRequestRecord {
    this.db
      .prepare(
        `UPDATE pipeline_wake_requests
            SET status = 'cancelled',
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(id);
    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): PipelineWakeRequestRecord | null {
    const row = this.db.prepare('SELECT * FROM pipeline_wake_requests WHERE id = ?').get(id);
    return row ? mapWakeRequest(asRow<PipelineWakeRequestRow>(row)) : null;
  }

  listByStatus(status: PipelineWakeRequestStatus): PipelineWakeRequestRecord[] {
    return asRows<PipelineWakeRequestRow>(
      this.db
        .prepare(
          `SELECT *
             FROM pipeline_wake_requests
            WHERE status = ?
            ORDER BY scheduled_at ASC, created_at ASC, rowid ASC`,
        )
        .all(status),
    ).map(mapWakeRequest);
  }

  private getActiveByIdempotencyKey(idempotencyKey: string): PipelineWakeRequestRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM pipeline_wake_requests
          WHERE idempotency_key = ?
            AND status IN ('pending', 'claimed')
          ORDER BY created_at ASC, rowid ASC
          LIMIT 1`,
      )
      .get(idempotencyKey);
    return row ? mapWakeRequest(asRow<PipelineWakeRequestRow>(row)) : null;
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load pipeline wake request row: ${id}`);
  }
}

function mapWakeRequest(row: PipelineWakeRequestRow): PipelineWakeRequestRecord {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    reason: row.reason,
    targetType: row.target_type,
    targetId: row.target_id,
    projectId: row.project_id,
    threadId: row.thread_id,
    runId: row.run_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    scheduledAt: toIsoUtc(row.scheduled_at) ?? row.scheduled_at,
    claimedAt: toIsoUtc(row.claimed_at),
    claimedBy: row.claimed_by,
    completedAt: toIsoUtc(row.completed_at),
    failedAt: toIsoUtc(row.failed_at),
    lastError: row.last_error,
    coalescedCount: row.coalesced_count,
    payload: parsePayload(row.payload_json),
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
