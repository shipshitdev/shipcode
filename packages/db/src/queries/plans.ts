import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { toIsoUtc, type PlanRecord, type PlanStatus, type ShipCodePlan } from '@shipcode/shared';

export class PlanQueries {
  constructor(private db: DatabaseSync) {}

  getMaxVersion(threadId: string): number {
    const row = this.db
      .prepare('SELECT MAX(version) as max_ver FROM plans WHERE thread_id = ?')
      .get(threadId) as { max_ver: number | null } | undefined;
    return Number(row?.max_ver ?? 0);
  }

  list(threadId: string): PlanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM plans WHERE thread_id = ? ORDER BY version DESC')
      .all(threadId) as any[];
    return rows.map(mapPlan);
  }

  getLatest(threadId: string): PlanRecord | null {
    const row = this.db
      .prepare('SELECT * FROM plans WHERE thread_id = ? ORDER BY version DESC LIMIT 1')
      .get(threadId) as any;
    return row ? mapPlan(row) : null;
  }

  getById(id: string): PlanRecord | null {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as any;
    return row ? mapPlan(row) : null;
  }

  create(
    threadId: string,
    rawOutput: string,
    structured: ShipCodePlan | null,
    version: number,
  ): PlanRecord {
    const id = nanoid();
    const now = new Date().toISOString();
    const structuredJson = structured ? JSON.stringify(structured) : null;

    this.db
      .prepare(
        `INSERT INTO plans (id, thread_id, version, raw_output, structured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, threadId, version, rawOutput, structuredJson, now);

    return this.getById(id)!;
  }

  updateStatus(id: string, status: PlanStatus): void {
    this.db.prepare('UPDATE plans SET status = ? WHERE id = ?').run(status, id);
  }

  updateStructured(id: string, structured: ShipCodePlan): void {
    this.db
      .prepare('UPDATE plans SET structured = ? WHERE id = ?')
      .run(JSON.stringify(structured), id);
  }

  supersedeAll(threadId: string): void {
    this.db
      .prepare(
        "UPDATE plans SET status = 'superseded' WHERE thread_id = ? AND status != 'superseded'",
      )
      .run(threadId);
  }
}

function mapPlan(row: any): PlanRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    version: row.version,
    rawOutput: row.raw_output,
    structured: row.structured ? JSON.parse(row.structured) : null,
    status: row.status as PlanStatus,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
  };
}
