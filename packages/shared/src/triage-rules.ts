export const TRIAGE_RULE_LIMIT = 50;

export type TriageRuleConditionOperator = 'all' | 'any';
export type TriageRuleConditionKind = 'label_includes' | 'label_excludes' | 'title_contains';

export interface TriageRuleCondition {
  kind: TriageRuleConditionKind;
  value: string;
}

export interface TriageRuleConditions {
  operator: TriageRuleConditionOperator;
  items: TriageRuleCondition[];
}

export interface TriageRuleActions {
  addLabels: string[];
  removeLabels: string[];
}

export interface TriageRuleDraft {
  id?: string;
  name: string;
  enabled: boolean;
  conditions: TriageRuleConditions;
  actions: TriageRuleActions;
}

export interface TriageRule extends TriageRuleDraft {
  id: string;
  projectId: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface TriageRuleIssue {
  title: string;
  labels: readonly string[];
}

export function normalizeTriageRuleDraft(draft: TriageRuleDraft): TriageRuleDraft {
  const id = draft.id?.trim();
  return {
    ...(id ? { id } : {}),
    name: draft.name.trim(),
    enabled: draft.enabled,
    conditions: {
      operator: draft.conditions.operator === 'any' ? 'any' : 'all',
      items: uniqueConditions(
        draft.conditions.items
          .map((condition) => ({
            kind: condition.kind,
            value: condition.value.trim(),
          }))
          .filter((condition) => condition.value.length > 0),
      ),
    },
    actions: {
      addLabels: uniqueTrimmed(draft.actions.addLabels),
      removeLabels: uniqueTrimmed(draft.actions.removeLabels),
    },
  };
}

export function evaluateTriageRules(
  issue: TriageRuleIssue,
  rules: readonly TriageRule[],
): TriageRule | null {
  for (const rule of rules) {
    if (rule.enabled && matchesConditions(issue, rule.conditions)) {
      return rule;
    }
  }
  return null;
}

function matchesConditions(issue: TriageRuleIssue, conditions: TriageRuleConditions): boolean {
  if (conditions.items.length === 0) return false;
  const matcher = (condition: TriageRuleCondition) => matchesCondition(issue, condition);
  return conditions.operator === 'any'
    ? conditions.items.some(matcher)
    : conditions.items.every(matcher);
}

function matchesCondition(issue: TriageRuleIssue, condition: TriageRuleCondition): boolean {
  const labels = new Set(issue.labels);
  switch (condition.kind) {
    case 'label_includes':
      return labels.has(condition.value);
    case 'label_excludes':
      return !labels.has(condition.value);
    case 'title_contains':
      return issue.title.toLowerCase().includes(condition.value.toLowerCase());
  }
}

function uniqueTrimmed(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function uniqueConditions(conditions: readonly TriageRuleCondition[]): TriageRuleCondition[] {
  const seen = new Set<string>();
  const result: TriageRuleCondition[] = [];
  for (const condition of conditions) {
    const key = `${condition.kind}\0${condition.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(condition);
  }
  return result;
}
