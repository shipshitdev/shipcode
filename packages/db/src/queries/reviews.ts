import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { toIsoUtc, type ReviewRecord, type PlanReview } from '@shipcode/shared';

export class ReviewQueries {
  constructor(private db: DatabaseSync) {}

  getByPlanId(planId: string): ReviewRecord | null {
    const row = this.db
      .prepare('SELECT * FROM reviews WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(planId) as any;
    return row ? mapReview(row) : null;
  }

  listByPlanIds(planIds: string[]): Record<string, ReviewRecord> {
    if (planIds.length === 0) return {};
    const result: Record<string, ReviewRecord> = {};
    for (const planId of planIds) {
      const review = this.getByPlanId(planId);
      if (review) result[planId] = review;
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
      .run(id, planId, decision, confidence, rawOutput, structuredJson, now);

    return { id, planId, decision, confidence, rawOutput, structured, createdAt: now };
  }
}

function mapReview(row: any): ReviewRecord {
  return {
    id: row.id,
    planId: row.plan_id,
    decision: row.decision,
    confidence: row.confidence,
    rawOutput: row.raw_output,
    structured: row.structured ? JSON.parse(row.structured) : null,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
  };
}
