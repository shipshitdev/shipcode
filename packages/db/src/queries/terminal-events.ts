import type { DatabaseSync } from 'node:sqlite';
import { type CanonicalTerminalEvent, type TerminalEventRecord, toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface TerminalEventRow {
  id: string;
  thread_id: string;
  run_id: string | null;
  event: string;
  created_at: string;
}

function mapRow(row: TerminalEventRow): TerminalEventRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id,
    event: JSON.parse(row.event) as CanonicalTerminalEvent,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
  };
}

export class TerminalEventQueries {
  // Hot-path: one INSERT per terminal event line. Cache the prepared statement
  // to avoid re-parsing on every call.
  private _insertStmt: ReturnType<DatabaseSync['prepare']> | null = null;

  constructor(private db: DatabaseSync) {}

  private getInsertStmt(): ReturnType<DatabaseSync['prepare']> {
    if (!this._insertStmt) {
      this._insertStmt = this.db.prepare(
        `INSERT INTO terminal_events (id, thread_id, run_id, event)
         VALUES (?, ?, ?, ?)
         RETURNING id, thread_id, run_id, event, created_at`,
      );
    }
    return this._insertStmt;
  }

  create(
    threadId: string,
    event: CanonicalTerminalEvent,
    runId: string | null = null,
  ): TerminalEventRecord {
    const id = nanoid();
    const row = asRow<TerminalEventRow>(
      this.getInsertStmt().get(id, threadId, runId, JSON.stringify(event)),
    );
    return mapRow(row);
  }

  listByThread(threadId: string, limit = 2000): TerminalEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, run_id, event, created_at
           FROM (
             SELECT id, thread_id, run_id, event, created_at, seq
               FROM terminal_events
              WHERE thread_id = ?
              ORDER BY seq DESC
              LIMIT ?
           )
          ORDER BY seq ASC`,
      )
      .all(threadId, limit);
    return asRows<TerminalEventRow>(rows).map(mapRow);
  }

  listByRun(runId: string, limit = 2000): TerminalEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, run_id, event, created_at
           FROM (
             SELECT id, thread_id, run_id, event, created_at, seq
               FROM terminal_events
              WHERE run_id = ?
              ORDER BY seq DESC
              LIMIT ?
           )
          ORDER BY seq ASC`,
      )
      .all(runId, limit);
    return asRows<TerminalEventRow>(rows).map(mapRow);
  }
}
