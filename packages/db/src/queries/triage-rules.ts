import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  ISO_NOW_SQL,
  normalizeTriageRuleDraft,
  TRIAGE_RULE_LIMIT,
  type TriageRule,
  type TriageRuleActions,
  type TriageRuleConditions,
  type TriageRuleDraft,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows, transaction } from '../utils';

interface TriageRuleRow {
  id: string;
  project_id: string;
  order_index: number;
  name: string;
  enabled: number;
  conditions: string;
  actions: string;
  created_at: string;
  updated_at: string;
}

export class TriageRuleQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): TriageRule[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM triage_rules WHERE project_id = ? ORDER BY order_index ASC, created_at ASC',
      )
      .all(projectId);
    return asRows<TriageRuleRow>(rows).map(mapTriageRule);
  }

  getById(id: string): TriageRule | null {
    const row = this.db.prepare('SELECT * FROM triage_rules WHERE id = ?').get(id);
    return row ? mapTriageRule(asRow<TriageRuleRow>(row)) : null;
  }

  create(projectId: string, draft: TriageRuleDraft): TriageRule {
    const count = this.countForProject(projectId);
    if (count >= TRIAGE_RULE_LIMIT) {
      throw new Error(`A project can have at most ${TRIAGE_RULE_LIMIT} triage rules`);
    }

    const normalized = normalizeTriageRuleDraft(draft);
    const id = normalized.id ?? nanoid();
    this.insert(this.prepareInsert(), projectId, id, count, normalized);

    const created = this.getById(id);
    if (!created) throw new Error(`Failed to create triage rule ${id}`);
    return created;
  }

  update(id: string, draft: TriageRuleDraft): TriageRule {
    const normalized = normalizeTriageRuleDraft(draft);
    this.db
      .prepare(
        `UPDATE triage_rules
            SET name = ?,
                enabled = ?,
                conditions = ?,
                actions = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(
        normalized.name,
        normalized.enabled ? 1 : 0,
        JSON.stringify(normalized.conditions),
        JSON.stringify(normalized.actions),
        id,
      );

    const updated = this.getById(id);
    if (!updated) throw new Error(`Triage rule ${id} not found`);
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    return transaction(this.db, () => {
      const result = this.db.prepare('DELETE FROM triage_rules WHERE id = ?').run(id);
      this.compactOrder(existing.projectId);
      return Number(result.changes) > 0;
    });
  }

  replaceForProject(projectId: string, drafts: TriageRuleDraft[]): TriageRule[] {
    if (drafts.length > TRIAGE_RULE_LIMIT) {
      throw new Error(`A project can have at most ${TRIAGE_RULE_LIMIT} triage rules`);
    }

    return transaction(this.db, () => {
      this.db.prepare('DELETE FROM triage_rules WHERE project_id = ?').run(projectId);

      const insertRule = this.prepareInsert();
      drafts.forEach((draft, index) => {
        const normalized = normalizeTriageRuleDraft(draft);
        this.insert(insertRule, projectId, normalized.id ?? nanoid(), index, normalized);
      });

      return this.list(projectId);
    });
  }

  private countForProject(projectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM triage_rules WHERE project_id = ?')
      .get(projectId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Reusable INSERT — hoisted so batch writes prepare once, not once per rule. */
  private prepareInsert(): StatementSync {
    return this.db.prepare(
      `INSERT INTO triage_rules (
         id, project_id, order_index, name, enabled, conditions, actions
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  private insert(
    statement: StatementSync,
    projectId: string,
    id: string,
    orderIndex: number,
    draft: TriageRuleDraft,
  ): void {
    statement.run(
      id,
      projectId,
      orderIndex,
      draft.name,
      draft.enabled ? 1 : 0,
      JSON.stringify(draft.conditions),
      JSON.stringify(draft.actions),
    );
  }

  private compactOrder(projectId: string): void {
    const rules = this.list(projectId);
    const reorder = this.db.prepare(
      `UPDATE triage_rules SET order_index = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
    );
    rules.forEach((rule, index) => {
      reorder.run(index, rule.id);
    });
  }
}

function mapTriageRule(row: TriageRuleRow): TriageRule {
  return {
    id: row.id,
    projectId: row.project_id,
    orderIndex: row.order_index,
    name: row.name,
    enabled: row.enabled === 1,
    conditions: JSON.parse(
      row.conditions || '{"operator":"all","items":[]}',
    ) as TriageRuleConditions,
    actions: JSON.parse(row.actions || '{"addLabels":[],"removeLabels":[]}') as TriageRuleActions,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}
