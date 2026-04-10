import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { ActivityEntry, ActivityKind, ActivityActor } from '@shipcode/shared'

function mapRow(row: any): ActivityEntry {
  return {
    id: row.id,
    threadId: row.thread_id,
    projectId: row.project_id,
    kind: row.kind as ActivityKind,
    actor: row.actor as ActivityActor,
    title: row.title,
    subtitle: row.subtitle,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
  }
}

export interface CreateActivityEntry {
  threadId: string | null
  projectId: string | null
  kind: ActivityKind
  actor: ActivityActor
  title: string
  subtitle?: string | null
  metadata?: Record<string, unknown> | null
}

export class ActivityQueries {
  constructor(private db: DatabaseSync) {}

  create(entry: CreateActivityEntry): ActivityEntry {
    const id = nanoid()
    this.db.prepare(
      `INSERT INTO activity_log (id, thread_id, project_id, kind, actor, title, subtitle, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      entry.threadId,
      entry.projectId,
      entry.kind,
      entry.actor,
      entry.title,
      entry.subtitle ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    )

    const row = this.db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id) as any
    return mapRow(row)
  }

  listRecent(limit = 50, projectId?: string, offset = 0): ActivityEntry[] {
    const rows = projectId
      ? this.db.prepare(
          'SELECT * FROM activity_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(projectId, limit, offset) as any[]
      : this.db.prepare(
          'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as any[]

    return rows.map(mapRow)
  }

  countRecent(projectId?: string): number {
    const row = projectId
      ? this.db.prepare('SELECT COUNT(*) as n FROM activity_log WHERE project_id = ?').get(projectId) as { n: number }
      : this.db.prepare('SELECT COUNT(*) as n FROM activity_log').get() as { n: number }
    return row.n
  }

  listByThread(threadId: string, limit = 100): ActivityEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM activity_log WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(threadId, limit) as any[]
    return rows.map(mapRow)
  }
}
