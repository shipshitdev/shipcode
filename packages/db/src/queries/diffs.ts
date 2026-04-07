import type Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { DiffRecord } from '@crosscode/shared'

export class DiffQueries {
  constructor(private db: Database.Database) {}

  list(threadId: string): DiffRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM diffs WHERE thread_id = ? ORDER BY created_at ASC'
    ).all(threadId) as any[]
    return rows.map(mapDiff)
  }

  create(threadId: string, filePath: string, action: string, diffContent: string | null): DiffRecord {
    const id = nanoid()
    const now = new Date().toISOString()

    this.db.prepare(
      `INSERT INTO diffs (id, thread_id, file_path, action, diff_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, threadId, filePath, action, diffContent, now)

    return { id, threadId, filePath, action: action as any, diffContent, beforeHash: null, afterHash: null, createdAt: now }
  }
}

function mapDiff(row: any): DiffRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    filePath: row.file_path,
    action: row.action,
    diffContent: row.diff_content,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    createdAt: row.created_at,
  }
}
