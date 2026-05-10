import type { DatabaseSync } from 'node:sqlite';
import {
  clampTextBlock,
  MAX_PIPELINE_RAW_OUTPUT_CHARS,
  type PlanReview,
  type ReviewRecord,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface ReviewRow {
  id: string;
  plan_id: string;
  decision: ReviewRecord['decision'];
  confidence: ReviewRecord['confidence'];
  raw_output: string;
  structured: string | null;
  created_at: string;
}

export class ReviewQueries {
  constructor(private db: DatabaseSync) {}

  getByPlanId(planId: string): ReviewRecord | null {
    const row = this.db
      .prepare('SELECT * FROM reviews WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(planId);
    return row ? mapReview(asRow<ReviewRow>(row)) : null;
  }

  listByPlanIds(planIds: string[]): Record<string, ReviewRecord> {
    if (planIds.length === 0) return {};
    const placeholders = planIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT *
           FROM reviews
          WHERE plan_id IN (${placeholders})
          ORDER BY plan_id ASC, created_at DESC, rowid DESC`,
      )
      .all(...planIds);
    const result: Record<string, ReviewRecord> = {};
    for (const row of asRows<ReviewRow>(rows)) {
      if (result[row.plan_id]) continue;
      result[row.plan_id] = mapReview(row);
    }
    return result;
  }

  create(planId: string, rawOutput: string, structured: PlanReview | null): ReviewRecord {
    const id = nanoid();
    const now = new Date().toISOString();
    const decision = structured?.decision ?? 'request_changes';
    const confidence = structured?.confidence ?? 'low';
    const structuredJson = structured ? JSON.stringify(structured) : null;

    this.db
      .prepare(
        `INSERT INTO reviews (id, plan_id, decision, confidence, raw_output, structured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        planId,
        decision,
        confidence,
        clampTextBlock(rawOutput, MAX_PIPELINE_RAW_OUTPUT_CHARS),
        structuredJson,
        now,
      );

    return {
      id,
      planId,
      decision,
      confidence,
      rawOutput: clampTextBlock(rawOutput, MAX_PIPELINE_RAW_OUTPUT_CHARS),
      structured,
      createdAt: now,
    };
  }
}

function mapReview(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    planId: row.plan_id,
    decision: row.decision,
    confidence: row.confidence,
    rawOutput: row.raw_output,
    structured: row.structured ? JSON.parse(row.structured) : null,
    createdAt: toIsoUtc(row.created_at) as string,
  };
}
