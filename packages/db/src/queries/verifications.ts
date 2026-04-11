import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { toIsoUtc, type VerificationResult, type VerificationRecord } from '@shipcode/shared';

export class VerificationQueries {
  constructor(private db: DatabaseSync) {}

  getByThreadId(threadId: string): VerificationRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM verifications WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as any[];
    return rows.map((r) => this.toRecord(r));
  }

  getLatest(threadId: string): VerificationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM verifications WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(threadId) as any | undefined;
    return row ? this.toRecord(row) : null;
  }

  create(
    threadId: string,
    planId: string,
    rawOutput: string,
    structured: VerificationResult | null,
  ): VerificationRecord {
    const id = nanoid();
    const result = structured?.result ?? 'failed';
    const retryCount = structured ? 0 : 0;
    this.db
      .prepare(
        'INSERT INTO verifications (id, thread_id, plan_id, raw_output, structured, result, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        threadId,
        planId,
        rawOutput,
        structured ? JSON.stringify(structured) : null,
        result,
        retryCount,
      );
    return this.getLatest(threadId)!;
  }

  private toRecord(row: any): VerificationRecord {
    return {
      id: row.id,
      threadId: row.thread_id,
      planId: row.plan_id,
      rawOutput: row.raw_output,
      structured: row.structured ? JSON.parse(row.structured) : null,
      result: row.result,
      retryCount: row.retry_count,
      createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    };
  }
}
