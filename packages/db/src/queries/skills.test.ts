import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { SkillsQueries } from './skills';

describe('SkillsQueries', () => {
  let db: DatabaseSync;
  let skills: SkillsQueries;

  beforeEach(() => {
    db = createTestDb();
    skills = new SkillsQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for a phase with no override at any scope', () => {
    expect(skills.get(null, 'plan-generation')).toBeNull();
    expect(skills.get('proj-A', 'plan-generation')).toBeNull();
  });

  it('set() inserts a global override and get(null, phase) returns it', () => {
    skills.set(null, 'adversarial-review', '---\nname: x\n---\nbody', 'v1', 1);
    const row = skills.get(null, 'adversarial-review');
    expect(row?.projectId).toBeNull();
    expect(row?.content).toBe('---\nname: x\n---\nbody');
    expect(row?.baseVersion).toBe('v1');
    expect(row?.schemaVersion).toBe(1);
    expect(row?.status).toBe('ok');
  });

  it('falls back to the raw timestamp when updated_at is not ISO parseable', () => {
    skills.set(null, 'plan-generation', 'content', 'v1', 1);
    db.prepare(`UPDATE skills SET updated_at = '' WHERE phase = ?`).run('plan-generation');

    expect(skills.get(null, 'plan-generation')?.updatedAt).toBe('');
  });

  it('set() upserts: a second set replaces content', () => {
    skills.set(null, 'plan-generation', 'first', 'v1', 1);
    skills.set(null, 'plan-generation', 'second', 'v2', 2);
    const row = skills.get(null, 'plan-generation');
    expect(row?.content).toBe('second');
    expect(row?.baseVersion).toBe('v2');
  });

  it('global and project rows for the same phase coexist', () => {
    skills.set(null, 'plan-generation', 'global content', 'v1', 1);
    skills.set('proj-A', 'plan-generation', 'project content', 'v1', 1);
    expect(skills.get(null, 'plan-generation')?.content).toBe('global content');
    expect(skills.get('proj-A', 'plan-generation')?.content).toBe('project content');
  });

  it('two different projects do not collide', () => {
    skills.set('proj-A', 'plan-generation', 'A', 'v1', 1);
    skills.set('proj-B', 'plan-generation', 'B', 'v1', 1);
    expect(skills.get('proj-A', 'plan-generation')?.content).toBe('A');
    expect(skills.get('proj-B', 'plan-generation')?.content).toBe('B');
  });

  it('delete() removes only the row at the requested scope', () => {
    skills.set(null, 'plan-generation', 'global', 'v1', 1);
    skills.set('proj-A', 'plan-generation', 'project', 'v1', 1);
    skills.delete('proj-A', 'plan-generation');
    expect(skills.get('proj-A', 'plan-generation')).toBeNull();
    expect(skills.get(null, 'plan-generation')?.content).toBe('global');
  });

  it('markQuarantined() flips status and stores the reason', () => {
    skills.set(null, 'plan-generation', 'broken', 'v1', 1);
    skills.markQuarantined(null, 'plan-generation', 'missing slot {{X}}');
    const row = skills.get(null, 'plan-generation');
    expect(row?.status).toBe('quarantined');
    expect(row?.statusReason).toBe('missing slot {{X}}');
  });

  it('listAll() returns rows ordered by phase then project', () => {
    skills.set(null, 'plan-generation', 'a', 'v1', 1);
    skills.set('proj-A', 'plan-generation', 'b', 'v1', 1);
    skills.set(null, 'adversarial-review', 'c', 'v1', 1);
    const rows = skills.listAll();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.phase)).toEqual([
      'adversarial-review',
      'plan-generation',
      'plan-generation',
    ]);
  });

  it('listQuarantined() filters to broken rows only', () => {
    skills.set(null, 'plan-generation', 'ok', 'v1', 1);
    skills.set(null, 'adversarial-review', 'bad', 'v1', 1);
    skills.markQuarantined(null, 'adversarial-review', 'broken');
    const rows = skills.listQuarantined();
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('adversarial-review');
  });
});
