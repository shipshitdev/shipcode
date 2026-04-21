import type { DatabaseSync } from 'node:sqlite';
import {
  clampTextBlock,
  MAX_PIPELINE_RAW_OUTPUT_CHARS,
  toIsoUtc,
  type VerificationRecord,
  type VerificationResult,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface VerificationRow {
  id: string;
  thread_id: string;
  plan_id: string;
  raw_output: string;
  structured: string | null;
  result: VerificationRecord['result'];
  retry_count: number;
  created_at: string;
}

export class VerificationQueries {
  constructor(private db: DatabaseSync) {}

  getByThreadId(threadId: string): VerificationRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM verifications WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId);
    return asRows<VerificationRow>(rows).map((r) => this.toRecord(r));
  }

  getLatest(threadId: string): VerificationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM verifications WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(threadId);
    return row ? this.toRecord(asRow<VerificationRow>(row)) : null;
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
    const compactRawOutput = clampTextBlock(rawOutput, MAX_PIPELINE_RAW_OUTPUT_CHARS);
    this.db
      .prepare(
        'INSERT INTO verifications (id, thread_id, plan_id, raw_output, structured, result, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        threadId,
        planId,
        compactRawOutput,
        structured ? JSON.stringify(structured) : null,
        result,
        retryCount,
      );
    const verification = this.getLatest(threadId);
    if (!verification) {
      throw new Error(`Failed to load verification after insert for thread ${threadId}`);
    }
    return verification;
  }

  private toRecord(row: VerificationRow): VerificationRecord {
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
