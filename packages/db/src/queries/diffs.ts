import type { DatabaseSync } from 'node:sqlite';
import { type DiffRecord, toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRows } from '../utils';

interface DiffRow {
  id: string;
  thread_id: string;
  file_path: string;
  action: DiffRecord['action'];
  diff_content: string | null;
  before_hash: string | null;
  after_hash: string | null;
  created_at: string;
}

export class DiffQueries {
  constructor(private db: DatabaseSync) {}

  list(threadId: string): DiffRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM diffs WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId);
    return asRows<DiffRow>(rows).map(mapDiff);
  }

  create(
    threadId: string,
    filePath: string,
    action: string,
    diffContent: string | null,
  ): DiffRecord {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO diffs (id, thread_id, file_path, action, diff_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, threadId, filePath, action, diffContent, now);

    return {
      id,
      threadId,
      filePath,
      action: action as DiffRecord['action'],
      diffContent,
      beforeHash: null,
      afterHash: null,
      createdAt: now,
    };
  }
}

function mapDiff(row: DiffRow): DiffRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    filePath: row.file_path,
    action: row.action,
    diffContent: row.diff_content,
    beforeHash: row.before_hash,
    afterHash: row.after_hash,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
  };
}
