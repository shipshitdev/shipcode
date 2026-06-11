import { describe, expect, it } from 'vitest';
import {
  evaluateTriageRules,
  normalizeTriageRuleDraft,
  type TriageRule,
  type TriageRuleConditions,
  type TriageRuleDraft,
} from './triage-rules';

function makeRule(
  overrides: Partial<TriageRule> & { conditions: TriageRuleConditions },
): TriageRule {
  return {
    id: overrides.id ?? 'rule-1',
    projectId: overrides.projectId ?? 'project-1',
    orderIndex: overrides.orderIndex ?? 0,
    name: overrides.name ?? 'rule',
    enabled: overrides.enabled ?? true,
    conditions: overrides.conditions,
    actions: overrides.actions ?? { addLabels: ['agent:claude'], removeLabels: [] },
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('evaluateTriageRules', () => {
  it('returns the first enabled rule that matches (ordering precedence)', () => {
    const first = makeRule({
      id: 'a',
      name: 'first',
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'bug' }] },
      actions: { addLabels: ['complexity:low'], removeLabels: [] },
    });
    const second = makeRule({
      id: 'b',
      name: 'second',
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'bug' }] },
      actions: { addLabels: ['complexity:high'], removeLabels: [] },
    });

    const matched = evaluateTriageRules({ title: 'Bug: crash', labels: [] }, [first, second]);
    expect(matched?.id).toBe('a');
  });

  it('skips disabled rules even when they would match', () => {
    const disabled = makeRule({
      id: 'disabled',
      enabled: false,
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'bug' }] },
    });
    const enabled = makeRule({
      id: 'enabled',
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'bug' }] },
    });

    const matched = evaluateTriageRules({ title: 'bug report', labels: [] }, [disabled, enabled]);
    expect(matched?.id).toBe('enabled');
  });

  it('matches title_contains case-insensitively', () => {
    const rule = makeRule({
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'BuG' }] },
    });
    expect(evaluateTriageRules({ title: 'A nasty bUg', labels: [] }, [rule])?.id).toBe('rule-1');
  });

  it('handles label_includes and label_excludes', () => {
    const includes = makeRule({
      id: 'includes',
      conditions: { operator: 'any', items: [{ kind: 'label_includes', value: 'needs-triage' }] },
    });
    expect(evaluateTriageRules({ title: 'x', labels: ['needs-triage'] }, [includes])?.id).toBe(
      'includes',
    );
    expect(evaluateTriageRules({ title: 'x', labels: ['other'] }, [includes])).toBeNull();

    const excludes = makeRule({
      id: 'excludes',
      conditions: { operator: 'any', items: [{ kind: 'label_excludes', value: 'complexity:low' }] },
    });
    expect(evaluateTriageRules({ title: 'x', labels: ['agent:claude'] }, [excludes])?.id).toBe(
      'excludes',
    );
    expect(evaluateTriageRules({ title: 'x', labels: ['complexity:low'] }, [excludes])).toBeNull();
  });

  it('matches labels case-insensitively (consistent with title_contains)', () => {
    const includes = makeRule({
      id: 'includes',
      conditions: { operator: 'any', items: [{ kind: 'label_includes', value: 'Needs-Triage' }] },
    });
    expect(evaluateTriageRules({ title: 'x', labels: ['needs-triage'] }, [includes])?.id).toBe(
      'includes',
    );

    const excludes = makeRule({
      id: 'excludes',
      conditions: { operator: 'any', items: [{ kind: 'label_excludes', value: 'complexity:low' }] },
    });
    expect(evaluateTriageRules({ title: 'x', labels: ['Complexity:Low'] }, [excludes])).toBeNull();
  });

  it('matches body_contains case-insensitively', () => {
    const rule = makeRule({
      conditions: { operator: 'any', items: [{ kind: 'body_contains', value: 'STACK trace' }] },
    });
    expect(
      evaluateTriageRules({ title: 'x', labels: [], body: 'Full stack trace here' }, [rule])?.id,
    ).toBe('rule-1');
    expect(evaluateTriageRules({ title: 'x', labels: [], body: null }, [rule])).toBeNull();
    expect(evaluateTriageRules({ title: 'x', labels: [] }, [rule])).toBeNull();
  });

  it('matches assignee_is case-insensitively', () => {
    const rule = makeRule({
      conditions: { operator: 'any', items: [{ kind: 'assignee_is', value: 'OctoCat' }] },
    });
    expect(evaluateTriageRules({ title: 'x', labels: [], assignee: 'octocat' }, [rule])?.id).toBe(
      'rule-1',
    );
    expect(evaluateTriageRules({ title: 'x', labels: [], assignee: 'someone' }, [rule])).toBeNull();
    expect(evaluateTriageRules({ title: 'x', labels: [], assignee: null }, [rule])).toBeNull();
  });

  it('matches author_is case-insensitively', () => {
    const rule = makeRule({
      conditions: { operator: 'any', items: [{ kind: 'author_is', value: 'OctoCat' }] },
    });
    expect(evaluateTriageRules({ title: 'x', labels: [], author: 'octocat' }, [rule])?.id).toBe(
      'rule-1',
    );
    expect(evaluateTriageRules({ title: 'x', labels: [], author: 'someone' }, [rule])).toBeNull();
    expect(evaluateTriageRules({ title: 'x', labels: [], author: null }, [rule])).toBeNull();
  });

  it('matches title_matches / body_matches via case-insensitive regex', () => {
    const titleRule = makeRule({
      id: 'title',
      conditions: { operator: 'any', items: [{ kind: 'title_matches', value: '^\\[bug\\]' }] },
    });
    expect(evaluateTriageRules({ title: '[BUG] crash', labels: [] }, [titleRule])?.id).toBe(
      'title',
    );
    expect(evaluateTriageRules({ title: 'feature [bug]', labels: [] }, [titleRule])).toBeNull();

    const bodyRule = makeRule({
      id: 'body',
      conditions: { operator: 'any', items: [{ kind: 'body_matches', value: 'panic|segfault' }] },
    });
    expect(
      evaluateTriageRules({ title: 'x', labels: [], body: 'it threw a SEGFAULT' }, [bodyRule])?.id,
    ).toBe('body');
  });

  it('never matches (and never throws) on an invalid regex pattern', () => {
    const rule = makeRule({
      conditions: { operator: 'any', items: [{ kind: 'title_matches', value: '([unterminated' }] },
    });
    expect(() =>
      evaluateTriageRules({ title: '([unterminated', labels: [] }, [rule]),
    ).not.toThrow();
    expect(evaluateTriageRules({ title: '([unterminated', labels: [] }, [rule])).toBeNull();
  });

  it('requires every item to match for the all operator', () => {
    const rule = makeRule({
      conditions: {
        operator: 'all',
        items: [
          { kind: 'title_contains', value: 'bug' },
          { kind: 'label_excludes', value: 'complexity:low' },
        ],
      },
    });
    expect(evaluateTriageRules({ title: 'bug', labels: [] }, [rule])?.id).toBe('rule-1');
    expect(evaluateTriageRules({ title: 'bug', labels: ['complexity:low'] }, [rule])).toBeNull();
    expect(evaluateTriageRules({ title: 'feature', labels: [] }, [rule])).toBeNull();
  });

  it('requires only one item to match for the any operator', () => {
    const rule = makeRule({
      conditions: {
        operator: 'any',
        items: [
          { kind: 'title_contains', value: 'bug' },
          { kind: 'label_includes', value: 'urgent' },
        ],
      },
    });
    expect(evaluateTriageRules({ title: 'feature', labels: ['urgent'] }, [rule])?.id).toBe(
      'rule-1',
    );
    expect(evaluateTriageRules({ title: 'feature', labels: ['cosmetic'] }, [rule])).toBeNull();
  });

  it('never matches a rule with no conditions', () => {
    const rule = makeRule({ conditions: { operator: 'all', items: [] } });
    expect(evaluateTriageRules({ title: 'anything', labels: ['anything'] }, [rule])).toBeNull();
  });

  it('returns null when no rule matches', () => {
    const rule = makeRule({
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: 'zzz' }] },
    });
    expect(evaluateTriageRules({ title: 'hello', labels: [] }, [rule])).toBeNull();
  });
});

describe('normalizeTriageRuleDraft', () => {
  it('trims name, condition values, and labels', () => {
    const draft: TriageRuleDraft = {
      name: '  My rule  ',
      enabled: true,
      conditions: { operator: 'any', items: [{ kind: 'title_contains', value: '  bug  ' }] },
      actions: { addLabels: ['  agent:claude  '], removeLabels: ['  stale  '] },
    };
    const normalized = normalizeTriageRuleDraft(draft);
    expect(normalized.name).toBe('My rule');
    expect(normalized.conditions.items).toEqual([{ kind: 'title_contains', value: 'bug' }]);
    expect(normalized.actions.addLabels).toEqual(['agent:claude']);
    expect(normalized.actions.removeLabels).toEqual(['stale']);
  });

  it('drops empty condition values and dedupes conditions/labels', () => {
    const draft: TriageRuleDraft = {
      name: 'r',
      enabled: false,
      conditions: {
        operator: 'any',
        items: [
          { kind: 'title_contains', value: 'bug' },
          { kind: 'title_contains', value: 'bug' },
          { kind: 'label_includes', value: '   ' },
        ],
      },
      actions: { addLabels: ['a', 'a', 'b'], removeLabels: ['c', '', 'c'] },
    };
    const normalized = normalizeTriageRuleDraft(draft);
    expect(normalized.conditions.items).toEqual([{ kind: 'title_contains', value: 'bug' }]);
    expect(normalized.actions.addLabels).toEqual(['a', 'b']);
    expect(normalized.actions.removeLabels).toEqual(['c']);
  });

  it('coerces an unknown operator to all and preserves a trimmed id', () => {
    const draft = {
      id: '  rule-7  ',
      name: 'r',
      enabled: true,
      conditions: {
        operator: 'weird' as TriageRuleConditions['operator'],
        items: [{ kind: 'title_contains' as const, value: 'x' }],
      },
      actions: { addLabels: [], removeLabels: [] },
    } satisfies TriageRuleDraft;
    const normalized = normalizeTriageRuleDraft(draft);
    expect(normalized.conditions.operator).toBe('all');
    expect(normalized.id).toBe('rule-7');
  });
});
