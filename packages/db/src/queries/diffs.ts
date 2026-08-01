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

const INSERT_DIFF_SQL = `INSERT INTO diffs (id, thread_id, file_path, action, diff_content, before_hash, after_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** Bind values for {@link INSERT_DIFF_SQL}, in column order. */
function diffInsertValues(record: DiffRecord) {
  return [
    record.id,
    record.threadId,
    record.filePath,
    record.action,
    record.diffContent,
    record.beforeHash,
    record.afterHash,
    record.createdAt,
  ] as const;
}

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
    const record: DiffRecord = {
      id: nanoid(),
      threadId,
      filePath,
      action,
      diffContent,
      beforeHash: options?.beforeHash ?? null,
      afterHash: options?.afterHash ?? null,
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(INSERT_DIFF_SQL).run(...diffInsertValues(record));

    return record;
  }

  replaceForThread(threadId: string, diffs: DiffInsert[]): DiffRecord[] {
    return transaction(this.db, () => {
      this.db.prepare('DELETE FROM diffs WHERE thread_id = ?').run(threadId);

      // Prepare once and reuse across the batch — `create()` per diff would
      // re-prepare the same INSERT for every row.
      const insertDiff = this.db.prepare(INSERT_DIFF_SQL);
      const created: DiffRecord[] = [];
      for (const diff of diffs) {
        const record: DiffRecord = {
          id: nanoid(),
          threadId,
          filePath: diff.filePath,
          action: diff.action,
          diffContent: diff.diffContent,
          beforeHash: diff.beforeHash ?? null,
          afterHash: diff.afterHash ?? null,
          createdAt: new Date().toISOString(),
        };
        insertDiff.run(...diffInsertValues(record));
        created.push(record);
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
