import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS } from './defaults.generated';
import {
  interpolateSkill,
  resolveSkill,
  type SkillsRowSource,
  stripFrontmatter,
  validateSkill,
} from './skill-loader';

const VALID_SKILL = `---
name: adversarial-review
description: test
phase: review
schemaVersion: 1
requiredSlots:
  - PLAN_JSON
  - OUTPUT_SCHEMA
---

<role>test</role>

<plan>{{PLAN_JSON}}</plan>
<schema>{{OUTPUT_SCHEMA}}</schema>
`;

function makeSource(
  rows: Map<
    string,
    { content: string; baseVersion: string; schemaVersion: number; status: 'ok' | 'quarantined' }
  >,
): SkillsRowSource & { quarantined: Array<[string, string, string]> } {
  const quarantined: Array<[string, string, string]> = [];
  return {
    get(projectId, phase) {
      return rows.get(`${projectId ?? 'GLOBAL'}::${phase}`) ?? null;
    },
    markQuarantined(projectId, phase, reason) {
      quarantined.push([projectId ?? 'GLOBAL', phase, reason]);
    },
    quarantined,
  };
}

describe('stripFrontmatter', () => {
  it('removes the leading YAML block', () => {
    const stripped = stripFrontmatter(VALID_SKILL);
    expect(stripped.startsWith('---')).toBe(false);
    expect(stripped.startsWith('<role>')).toBe(true);
  });

  it('returns content unchanged when no frontmatter present', () => {
    expect(stripFrontmatter('plain text')).toBe('plain text');
  });
});

describe('validateSkill', () => {
  it('returns null for a valid skill', () => {
    expect(validateSkill('adversarial-review', VALID_SKILL)).toBeNull();
  });

  it('rejects content without frontmatter', () => {
    const err = validateSkill('adversarial-review', '<role>no frontmatter</role>');
    expect(err?.code).toBe('no_frontmatter');
  });

  it('rejects content missing a required slot', () => {
    const broken = VALID_SKILL.replace('{{PLAN_JSON}}', 'literal text');
    const err = validateSkill('adversarial-review', broken);
    expect(err?.code).toBe('missing_slot');
    expect(err?.message).toContain('PLAN_JSON');
  });

  it('lists multiple missing slots when more than one is gone', () => {
    const broken = VALID_SKILL.replace('{{PLAN_JSON}}', 'x').replace('{{OUTPUT_SCHEMA}}', 'y');
    const err = validateSkill('adversarial-review', broken);
    expect(err?.code).toBe('missing_slot');
    expect(err?.details?.missing).toEqual(['PLAN_JSON', 'OUTPUT_SCHEMA']);
  });

  it('validates every bundled default', () => {
    for (const [phase, bundled] of Object.entries(DEFAULT_SKILLS)) {
      const err = validateSkill(phase as never, bundled.content);
      expect(err, `bundled default for ${phase} should validate`).toBeNull();
    }
  });
});

describe('interpolateSkill', () => {
  it('replaces known slots', () => {
    const out = interpolateSkill('hello {{NAME}}!', [{ key: 'NAME', value: 'world' }]);
    expect(out).toBe('hello world!');
  });

  it('throws on unknown slot in dev mode', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(() => interpolateSkill('see {{MISSING}}', [])).toThrow(/MISSING/);
    process.env.NODE_ENV = orig;
  });

  it('clamps unknown slot in prod mode', () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const out = interpolateSkill('see {{MISSING}}', []);
    expect(out).toBe('see [unknown slot: MISSING]');
    process.env.NODE_ENV = orig;
  });
});

describe('resolveSkill', () => {
  it('returns the bundled default when no rows exist', () => {
    const source = makeSource(new Map());
    const result = resolveSkill('adversarial-review', null, { skills: source });
    expect(result.skill.source).toBe('default');
    expect(result.fallbackUsed).toBe(false);
    expect(result.skill.content.startsWith('---')).toBe(false);
  });

  it('prefers global override over default', () => {
    const rows = new Map();
    rows.set('GLOBAL::adversarial-review', {
      content: VALID_SKILL,
      baseVersion: 'abc123',
      schemaVersion: 1,
      status: 'ok',
    });
    const source = makeSource(rows);
    const result = resolveSkill('adversarial-review', null, { skills: source });
    expect(result.skill.source).toBe('global');
    expect(result.skill.baseVersion).toBe('abc123');
    expect(result.fallbackUsed).toBe(false);
  });

  it('prefers project override over global override', () => {
    const rows = new Map();
    rows.set('GLOBAL::adversarial-review', {
      content: VALID_SKILL,
      baseVersion: 'global',
      schemaVersion: 1,
      status: 'ok',
    });
    rows.set('proj-A::adversarial-review', {
      content: VALID_SKILL,
      baseVersion: 'project',
      schemaVersion: 1,
      status: 'ok',
    });
    const source = makeSource(rows);
    const result = resolveSkill('adversarial-review', 'proj-A', { skills: source });
    expect(result.skill.source).toBe('project');
    expect(result.skill.baseVersion).toBe('project');
  });

  it('falls back to default when global override is invalid and quarantines the row', () => {
    const broken = VALID_SKILL.replace('{{PLAN_JSON}}', 'gone');
    const rows = new Map();
    rows.set('GLOBAL::adversarial-review', {
      content: broken,
      baseVersion: 'g',
      schemaVersion: 1,
      status: 'ok',
    });
    const source = makeSource(rows);
    const result = resolveSkill('adversarial-review', null, { skills: source });
    expect(result.skill.source).toBe('default');
    expect(result.fallbackUsed).toBe(true);
    expect(result.error?.code).toBe('missing_slot');
    expect(source.quarantined).toEqual([
      ['GLOBAL', 'adversarial-review', expect.stringContaining('PLAN_JSON')],
    ]);
  });

  it('skips a row already marked quarantined without re-validating', () => {
    const rows = new Map();
    rows.set('GLOBAL::adversarial-review', {
      content: VALID_SKILL,
      baseVersion: 'g',
      schemaVersion: 1,
      status: 'quarantined',
    });
    const source = makeSource(rows);
    const result = resolveSkill('adversarial-review', null, { skills: source });
    expect(result.skill.source).toBe('default');
    expect(result.fallbackUsed).toBe(true);
    expect(source.quarantined).toEqual([]);
  });

  it('falls back from project to global when project row is invalid', () => {
    const rows = new Map();
    rows.set('proj-A::adversarial-review', {
      content: VALID_SKILL.replace('{{OUTPUT_SCHEMA}}', 'broken'),
      baseVersion: 'p',
      schemaVersion: 1,
      status: 'ok',
    });
    rows.set('GLOBAL::adversarial-review', {
      content: VALID_SKILL,
      baseVersion: 'g',
      schemaVersion: 1,
      status: 'ok',
    });
    const source = makeSource(rows);
    const result = resolveSkill('adversarial-review', 'proj-A', { skills: source });
    expect(result.skill.source).toBe('global');
    expect(result.skill.baseVersion).toBe('g');
    expect(result.fallbackUsed).toBe(true);
    expect(source.quarantined).toEqual([
      ['proj-A', 'adversarial-review', expect.stringContaining('OUTPUT_SCHEMA')],
    ]);
  });
});
