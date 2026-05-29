import type { DatabaseSync } from 'node:sqlite';
import { TRIAGE_RULE_LIMIT, type TriageRuleDraft } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { TriageRuleQueries } from './triage-rules';

describe('TriageRuleQueries', () => {
  let db: DatabaseSync;
  let rules: TriageRuleQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    rules = new TriageRuleQueries(db);
    projectId = new ProjectQueries(db).add('/tmp/triage').id;
  });

  afterEach(() => {
    db.close();
  });

  function makeDraft(overrides: Partial<TriageRuleDraft> = {}): TriageRuleDraft {
    return {
      name: overrides.name ?? 'rule',
      enabled: overrides.enabled ?? true,
      conditions: overrides.conditions ?? {
        operator: 'any',
        items: [{ kind: 'title_contains', value: 'bug' }],
      },
      actions: overrides.actions ?? { addLabels: ['agent:claude'], removeLabels: [] },
      ...(overrides.id ? { id: overrides.id } : {}),
    };
  }

  it('creates a rule at the next order index and round-trips conditions/actions', () => {
    const first = rules.create(projectId, makeDraft({ name: 'first' }));
    const second = rules.create(
      projectId,
      makeDraft({
        name: 'second',
        conditions: { operator: 'all', items: [{ kind: 'label_includes', value: 'urgent' }] },
        actions: { addLabels: ['complexity:high'], removeLabels: ['stale'] },
      }),
    );

    expect(first.orderIndex).toBe(0);
    expect(second.orderIndex).toBe(1);
    expect(second.conditions).toEqual({
      operator: 'all',
      items: [{ kind: 'label_includes', value: 'urgent' }],
    });
    expect(second.actions).toEqual({ addLabels: ['complexity:high'], removeLabels: ['stale'] });

    const listed = rules.list(projectId);
    expect(listed.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it('normalizes drafts on create (trim + dedupe)', () => {
    const created = rules.create(
      projectId,
      makeDraft({
        name: '  spaced  ',
        actions: { addLabels: ['  a  ', 'a'], removeLabels: [] },
      }),
    );
    expect(created.name).toBe('spaced');
    expect(created.actions.addLabels).toEqual(['a']);
  });

  it('getById returns the rule or null', () => {
    const created = rules.create(projectId, makeDraft());
    expect(rules.getById(created.id)?.id).toBe(created.id);
    expect(rules.getById('missing')).toBeNull();
  });

  it('updates name, enabled, conditions, and actions', () => {
    const created = rules.create(projectId, makeDraft({ name: 'before', enabled: true }));
    const updated = rules.update(created.id, {
      id: created.id,
      name: 'after',
      enabled: false,
      conditions: { operator: 'all', items: [{ kind: 'title_contains', value: 'feat' }] },
      actions: { addLabels: ['x'], removeLabels: ['y'] },
    });
    expect(updated.name).toBe('after');
    expect(updated.enabled).toBe(false);
    expect(updated.conditions.operator).toBe('all');
    expect(updated.actions).toEqual({ addLabels: ['x'], removeLabels: ['y'] });
  });

  it('deletes a rule and compacts remaining order indexes', () => {
    const a = rules.create(projectId, makeDraft({ name: 'a' }));
    const b = rules.create(projectId, makeDraft({ name: 'b' }));
    const c = rules.create(projectId, makeDraft({ name: 'c' }));

    expect(rules.delete(b.id)).toBe(true);
    expect(rules.delete('missing')).toBe(false);

    const remaining = rules.list(projectId);
    expect(remaining.map((r) => r.id)).toEqual([a.id, c.id]);
    expect(remaining.map((r) => r.orderIndex)).toEqual([0, 1]);
  });

  it('replaceForProject overwrites all rules and reorders by array index', () => {
    rules.create(projectId, makeDraft({ name: 'old' }));

    const replaced = rules.replaceForProject(projectId, [
      makeDraft({ name: 'one' }),
      makeDraft({ name: 'two' }),
    ]);

    expect(replaced.map((r) => r.name)).toEqual(['one', 'two']);
    expect(replaced.map((r) => r.orderIndex)).toEqual([0, 1]);
    expect(rules.list(projectId).map((r) => r.name)).toEqual(['one', 'two']);
  });

  it('isolates rules per project', () => {
    const otherProjectId = new ProjectQueries(db).add('/tmp/other').id;
    rules.create(projectId, makeDraft({ name: 'mine' }));
    rules.create(otherProjectId, makeDraft({ name: 'theirs' }));

    expect(rules.list(projectId).map((r) => r.name)).toEqual(['mine']);
    expect(rules.list(otherProjectId).map((r) => r.name)).toEqual(['theirs']);
  });

  it('rejects create beyond TRIAGE_RULE_LIMIT', () => {
    const drafts = Array.from({ length: TRIAGE_RULE_LIMIT }, (_, i) =>
      makeDraft({ name: `rule-${i}` }),
    );
    rules.replaceForProject(projectId, drafts);
    expect(() => rules.create(projectId, makeDraft({ name: 'overflow' }))).toThrow(
      /at most 50 triage rules/,
    );
  });

  it('rejects replaceForProject beyond TRIAGE_RULE_LIMIT', () => {
    const drafts = Array.from({ length: TRIAGE_RULE_LIMIT + 1 }, (_, i) =>
      makeDraft({ name: `rule-${i}` }),
    );
    expect(() => rules.replaceForProject(projectId, drafts)).toThrow(/at most 50 triage rules/);
  });
});
