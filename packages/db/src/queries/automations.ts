import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentType,
  type Automation,
  type AutomationLastStatus,
  type CreateAutomationInput,
  ISO_NOW_SQL,
  type ReasoningEffort,
  type UpdateAutomationInput,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows, transaction } from '../utils';

interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  cron_expr: string;
  enabled: number;
  executor_provider: AgentType | null;
  executor_model_id: string | null;
  executor_reasoning_effort: ReasoningEffort | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: AutomationLastStatus | null;
  next_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

function mapAutomation(row: AutomationRow, targets: string[]): Automation {
  return {
    id: row.id,
    projectId: row.project_id,
    targets: targets.length > 0 ? targets : [row.project_id],
    name: row.name,
    prompt: row.prompt,
    cronExpr: row.cron_expr,
    enabled: row.enabled === 1,
    executorProvider: row.executor_provider,
    executorModelId: row.executor_model_id,
    executorReasoningEffort: row.executor_reasoning_effort,
    lastStartedAt: row.last_started_at,
    lastCompletedAt: row.last_completed_at,
    lastStatus: row.last_status,
    nextRunAt: row.next_run_at,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationQueries {
  constructor(private db: DatabaseSync) {}

  /** Target project ids for an automation, oldest first (primary first). */
  listTargets(automationId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT project_id FROM automation_targets WHERE automation_id = ? ORDER BY created_at ASC',
      )
      .all(automationId);
    return asRows<{ project_id: string }>(rows).map((r) => r.project_id);
  }

  private hydrate(row: AutomationRow): Automation {
    return mapAutomation(row, this.listTargets(row.id));
  }

  list(projectId: string): Automation[] {
    // Automations that target this project (multi-repo aware), newest first.
    const rows = this.db
      .prepare(
        `SELECT a.* FROM automations a
            JOIN automation_targets t ON t.automation_id = a.id
           WHERE t.project_id = ?
           ORDER BY a.created_at DESC`,
      )
      .all(projectId);
    return asRows<AutomationRow>(rows).map((row) => this.hydrate(row));
  }

  listAll(): Automation[] {
    const rows = this.db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all();
    return asRows<AutomationRow>(rows).map((row) => this.hydrate(row));
  }

  listEnabled(): Automation[] {
    const rows = this.db
      .prepare('SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at DESC')
      .all();
    return asRows<AutomationRow>(rows).map((row) => this.hydrate(row));
  }

  /**
   * Returns enabled automations whose `next_run_at` has already passed. Used
   * once at app startup to advance missed ticks (we never fire historical
   * runs; only update next_run_at to the next future occurrence).
   */
  listDue(nowIso: string): Automation[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?',
      )
      .all(nowIso);
    return asRows<AutomationRow>(rows).map((row) => this.hydrate(row));
  }

  getById(id: string): Automation | null {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id);
    return row ? this.hydrate(asRow<AutomationRow>(row)) : null;
  }

  create(input: CreateAutomationInput): Automation {
    const id = nanoid();
    // Dedupe while preserving order; the first target becomes the primary
    // project_id so single-project callers keep working unchanged.
    const targets = [...new Set(input.targets?.length ? input.targets : [input.projectId])];
    const primary = targets[0] ?? input.projectId;

    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO automations (
             id, project_id, name, prompt, cron_expr, enabled,
             executor_provider, executor_model_id, executor_reasoning_effort,
             run_count, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${ISO_NOW_SQL}, ${ISO_NOW_SQL})`,
        )
        .run(
          id,
          primary,
          input.name,
          input.prompt,
          input.cronExpr,
          input.enabled === false ? 0 : 1,
          input.executorProvider ?? null,
          input.executorModelId ?? null,
          input.executorReasoningEffort ?? null,
        );

      const insertTarget = this.db.prepare(
        `INSERT OR IGNORE INTO automation_targets (id, automation_id, project_id, created_at)
         VALUES (?, ?, ?, ${ISO_NOW_SQL})`,
      );
      for (const projectId of targets) {
        insertTarget.run(nanoid(), id, projectId);
      }
    });

    const automation = this.getById(id);
    if (!automation) throw new Error(`Failed to create automation ${id}`);
    return automation;
  }

  /** Add a target project (idempotent on the automation×project pair). */
  addTarget(automationId: string, projectId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO automation_targets (id, automation_id, project_id, created_at)
         VALUES (?, ?, ?, ${ISO_NOW_SQL})`,
      )
      .run(nanoid(), automationId, projectId);
  }

  /** Remove a target project. */
  removeTarget(automationId: string, projectId: string): void {
    this.db
      .prepare('DELETE FROM automation_targets WHERE automation_id = ? AND project_id = ?')
      .run(automationId, projectId);
  }

  /** Replace the full target set, keeping `project_id` aligned to the first. */
  setTargets(automationId: string, projectIds: string[]): void {
    const targets = [...new Set(projectIds)];
    if (targets.length === 0) throw new Error('An automation must have at least one target');

    transaction(this.db, () => {
      this.db.prepare('DELETE FROM automation_targets WHERE automation_id = ?').run(automationId);
      const insertTarget = this.db.prepare(
        `INSERT OR IGNORE INTO automation_targets (id, automation_id, project_id, created_at)
         VALUES (?, ?, ?, ${ISO_NOW_SQL})`,
      );
      for (const projectId of targets) {
        insertTarget.run(nanoid(), automationId, projectId);
      }
      this.db
        .prepare(`UPDATE automations SET project_id = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
        .run(targets[0], automationId);
    });
  }

  update(id: string, patch: UpdateAutomationInput): Automation {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Automation ${id} not found`);

    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      values.push(patch.name);
    }
    if (patch.prompt !== undefined) {
      sets.push('prompt = ?');
      values.push(patch.prompt);
    }
    if (patch.cronExpr !== undefined) {
      sets.push('cron_expr = ?');
      values.push(patch.cronExpr);
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.executorProvider !== undefined) {
      sets.push('executor_provider = ?');
      values.push(patch.executorProvider);
    }
    if (patch.executorModelId !== undefined) {
      sets.push('executor_model_id = ?');
      values.push(patch.executorModelId);
    }
    if (patch.executorReasoningEffort !== undefined) {
      sets.push('executor_reasoning_effort = ?');
      values.push(patch.executorReasoningEffort);
    }
    sets.push(`updated_at = ${ISO_NOW_SQL}`);

    this.db.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);

    const updated = this.getById(id);
    if (!updated) throw new Error(`Automation ${id} disappeared after update`);
    return updated;
  }

  setEnabled(id: string, enabled: boolean): Automation {
    return this.update(id, { enabled });
  }

  setNextRunAt(id: string, nextRunAt: string | null): void {
    this.db
      .prepare(`UPDATE automations SET next_run_at = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(nextRunAt, id);
  }

  recordRunStarted(id: string, _threadId: string): void {
    this.db
      .prepare(
        `UPDATE automations
            SET last_started_at = ${ISO_NOW_SQL},
                last_status = 'running',
                run_count = run_count + 1,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(id);
  }

  recordRunFinished(id: string, status: AutomationLastStatus): void {
    this.db
      .prepare(
        `UPDATE automations
            SET last_completed_at = ${ISO_NOW_SQL},
                last_status = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(status, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  }
}
