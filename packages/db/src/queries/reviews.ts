import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { ReviewRecord, PlanReview } from '@shipcode/shared'

export class ReviewQueries {
  constructor(private db: DatabaseSync) {}

  getByPlanId(planId: string): ReviewRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM reviews WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(planId) as any
    return row ? mapReview(row) : null
  }

  create(planId: string, rawOutput: string, structured: PlanReview | null): ReviewRecord {
    const id = nanoid()
    const now = new Date().toISOString()
    const decision = structured?.decision ?? 'request_changes'
    const confidence = structured?.confidence ?? 'low'
    const structuredJson = structured ? JSON.stringify(structured) : null

    this.db.prepare(
      `INSERT INTO reviews (id, plan_id, decision, confidence, raw_output, structured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, planId, decision, confidence, rawOutput, structuredJson, now)

    return { id, planId, decision, confidence, rawOutput, structured, createdAt: now }
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
    createdAt: row.created_at,
  }
}
