import type { DatabaseSync } from 'node:sqlite';
import { type DiffRecord, toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRows, transaction } from '../utils';

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

export type DiffInsert = Pick<
  DiffRecord,
  'filePath' | 'action' | 'diffContent' | 'beforeHash' | 'afterHash'
>;

export class DiffQueries {
  constructor(private db: DatabaseSync) {}

  list(threadId: string): DiffRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM diffs WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(threadId);
    return asRows<DiffRow>(rows).map(mapDiff);
  }

  create(
    threadId: string,
    filePath: string,
    action: DiffRecord['action'],
    diffContent: string | null,
    options?: {
      beforeHash?: string | null;
      afterHash?: string | null;
    },
  ): DiffRecord {
    const id = nanoid();
    const now = new Date().toISOString();
    const beforeHash = options?.beforeHash ?? null;
    const afterHash = options?.afterHash ?? null;

    this.db
      .prepare(
        `INSERT INTO diffs (id, thread_id, file_path, action, diff_content, before_hash, after_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, threadId, filePath, action, diffContent, beforeHash, afterHash, now);

    return {
      id,
      threadId,
      filePath,
      action,
      diffContent,
      beforeHash,
      afterHash,
      createdAt: now,
    };
  }

  replaceForThread(threadId: string, diffs: DiffInsert[]): DiffRecord[] {
    return transaction(this.db, () => {
      this.db.prepare('DELETE FROM diffs WHERE thread_id = ?').run(threadId);

      const created: DiffRecord[] = [];
      for (const diff of diffs) {
        created.push(
          this.create(threadId, diff.filePath, diff.action, diff.diffContent, {
            beforeHash: diff.beforeHash,
            afterHash: diff.afterHash,
          }),
        );
      }

      return created;
    });
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
