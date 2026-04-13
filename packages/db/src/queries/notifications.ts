import type { DatabaseSync } from 'node:sqlite';
import {
  ISO_NOW_SQL,
  type NotificationKind,
  type NotificationRecord,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';

interface NotificationRow {
  id: string;
  thread_id: string;
  project_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  created_at: string;
  dismissed_at: string | null;
}

function mapRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    dismissedAt: toIsoUtc(row.dismissed_at),
  };
}

export interface CreateNotificationInput {
  threadId: string;
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
}

export class NotificationsQueries {
  constructor(private db: DatabaseSync) {}

  create(input: CreateNotificationInput): NotificationRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO notifications (id, thread_id, project_id, kind, title, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.threadId, input.projectId, input.kind, input.title, input.body);

    const row = this.db
      .prepare('SELECT * FROM notifications WHERE id = ?')
      .get(id) as NotificationRow;
    return mapRow(row);
  }

  listActive(): NotificationRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM notifications WHERE dismissed_at IS NULL ORDER BY created_at DESC')
      .all() as NotificationRow[];
    return rows.map(mapRow);
  }

  listByThread(threadId: string): NotificationRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM notifications WHERE thread_id = ? AND dismissed_at IS NULL ORDER BY created_at DESC',
      )
      .all(threadId) as NotificationRow[];
    return rows.map(mapRow);
  }

  dismiss(id: string): void {
    this.db
      .prepare(
        `UPDATE notifications SET dismissed_at = ${ISO_NOW_SQL} WHERE id = ? AND dismissed_at IS NULL`,
      )
      .run(id);
  }

  dismissByThread(threadId: string): void {
    this.db
      .prepare(
        `UPDATE notifications SET dismissed_at = ${ISO_NOW_SQL} WHERE thread_id = ? AND dismissed_at IS NULL`,
      )
      .run(threadId);
  }

  dismissAll(): void {
    this.db
      .prepare(`UPDATE notifications SET dismissed_at = ${ISO_NOW_SQL} WHERE dismissed_at IS NULL`)
      .run();
  }

  activeCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as n FROM notifications WHERE dismissed_at IS NULL')
      .get() as { n: number };
    return row.n;
  }
}
