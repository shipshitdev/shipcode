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

/** Per-target run bookkeeping row (the source of truth for run lifecycle). */
interface AutomationTargetRow {
  project_id: string;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: AutomationLastStatus | null;
  run_count: number;
}

interface RunStateAggregate {
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: AutomationLastStatus | null;
  runCount: number;
}

// Worst-of ordering for the rollup badge: an in-flight target dominates (there
// is still a run happening), then a failure, then success. ISO timestamps
// compare correctly as strings (same UTC millisecond format everywhere).
const RUN_STATUS_PRIORITY: Record<AutomationLastStatus, number> = {
  running: 3,
  failed: 2,
  completed: 1,
};

/**
 * Collapse per-target run bookkeeping into the automation-level summary the UI
 * renders. Multi-repo automations dispatch one pipeline per target, so the
 * badge/counter must aggregate rather than reflect whichever target's write
 * landed last: worst-of status, most-recent timestamps, summed run counts.
 */
function aggregateRunState(targets: AutomationTargetRow[]): RunStateAggregate {
  let lastStartedAt: string | null = null;
  let lastCompletedAt: string | null = null;
  let lastStatus: AutomationLastStatus | null = null;
  let bestPriority = 0;
  let runCount = 0;

  for (const target of targets) {
    runCount += target.run_count;
    if (target.last_started_at && (!lastStartedAt || target.last_started_at > lastStartedAt)) {
      lastStartedAt = target.last_started_at;
    }
    if (
      target.last_completed_at &&
      (!lastCompletedAt || target.last_completed_at > lastCompletedAt)
    ) {
      lastCompletedAt = target.last_completed_at;
    }
    if (target.last_status) {
      const priority = RUN_STATUS_PRIORITY[target.last_status];
      if (priority > bestPriority) {
        bestPriority = priority;
        lastStatus = target.last_status;
      }
    }
  }

  return { lastStartedAt, lastCompletedAt, lastStatus, runCount };
}

function mapAutomation(row: AutomationRow, targetRows: AutomationTargetRow[]): Automation {
  // Fall back to the (legacy) automation-level columns only when no target
  // rows exist — e.g. rows whose target set was externally deleted.
  const agg: RunStateAggregate =
    targetRows.length > 0
      ? aggregateRunState(targetRows)
      : {
          lastStartedAt: row.last_started_at,
          lastCompletedAt: row.last_completed_at,
          lastStatus: row.last_status,
          runCount: row.run_count,
        };

  return {
    id: row.id,
    projectId: row.project_id,
    targets: targetRows.length > 0 ? targetRows.map((t) => t.project_id) : [row.project_id],
    name: row.name,
    prompt: row.prompt,
    cronExpr: row.cron_expr,
    enabled: row.enabled === 1,
    executorProvider: row.executor_provider,
    executorModelId: row.executor_model_id,
    executorReasoningEffort: row.executor_reasoning_effort,
    lastStartedAt: agg.lastStartedAt,
    lastCompletedAt: agg.lastCompletedAt,
    lastStatus: agg.lastStatus,
    nextRunAt: row.next_run_at,
    runCount: agg.runCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationQueries {
  constructor(private db: DatabaseSync) {}

  /** Full target rows (with per-target run bookkeeping), oldest first. */
  private listTargetRows(automationId: string): AutomationTargetRow[] {
    const rows = this.db
      .prepare(
        `SELECT project_id, last_started_at, last_completed_at, last_status, run_count
           FROM automation_targets
          WHERE automation_id = ?
          ORDER BY created_at ASC`,
      )
      .all(automationId);
    return asRows<AutomationTargetRow>(rows);
  }

  /** Target project ids for an automation, oldest first (primary first). */
  listTargets(automationId: string): string[] {
    return this.listTargetRows(automationId).map((r) => r.project_id);
  }

  private hydrate(row: AutomationRow): Automation {
    return mapAutomation(row, this.listTargetRows(row.id));
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

  /**
   * Record that a run started for one target of an automation. Bookkeeping is
   * per (automation, target) so a multi-repo fan-out increments each target's
   * own counter instead of racing on a shared automation-level row. No-op when
   * `projectId` is not a target of the automation.
   */
  recordRunStarted(id: string, projectId: string, _threadId: string): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE automation_targets
              SET last_started_at = ${ISO_NOW_SQL},
                  last_status = 'running',
                  run_count = run_count + 1
            WHERE automation_id = ? AND project_id = ?`,
        )
        .run(id, projectId);
      this.db
        .prepare(`UPDATE automations SET updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
        .run(id);
    });
  }

  /**
   * Record that a run finished for one target of an automation. The
   * automation-level status the UI shows is derived worst-of across targets
   * (see `aggregateRunState`), so a sibling target failing is never masked by
   * this one completing later. No-op when `projectId` is not a target.
   */
  recordRunFinished(id: string, projectId: string, status: AutomationLastStatus): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE automation_targets
              SET last_completed_at = ${ISO_NOW_SQL},
                  last_status = ?
            WHERE automation_id = ? AND project_id = ?`,
        )
        .run(status, id, projectId);
      this.db
        .prepare(`UPDATE automations SET updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
        .run(id);
    });
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  }
}
