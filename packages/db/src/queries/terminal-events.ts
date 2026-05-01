import type { DatabaseSync } from 'node:sqlite';
import { type CanonicalTerminalEvent, type TerminalEventRecord, toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface TerminalEventRow {
  id: string;
  thread_id: string;
  event: string;
  created_at: string;
}

function mapRow(row: TerminalEventRow): TerminalEventRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    event: JSON.parse(row.event) as CanonicalTerminalEvent,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
  };
}

export class TerminalEventQueries {
  constructor(private db: DatabaseSync) {}

  create(threadId: string, event: CanonicalTerminalEvent): TerminalEventRecord {
    const id = nanoid();
    const row = asRow<TerminalEventRow>(
      this.db
        .prepare(
          `INSERT INTO terminal_events (id, thread_id, event)
           VALUES (?, ?, ?)
           RETURNING id, thread_id, event, created_at`,
        )
        .get(id, threadId, JSON.stringify(event)),
    );
    return mapRow(row);
  }

  listByThread(threadId: string, limit = 2000): TerminalEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, thread_id, event, created_at
           FROM (
             SELECT id, thread_id, event, created_at, seq
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
}
