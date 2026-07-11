import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase } from '../index';
import { AutomationQueries } from './automations';
import { ProjectQueries } from './projects';

function setup() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-db-automations-'));
  const db = getDatabase(dataDir);
  const projects = new ProjectQueries(db);
  const automations = new AutomationQueries(db);
  const project = projects.add(path.join(dataDir, 'project'));
  return { dataDir, db, projects, automations, project };
}

describe('AutomationQueries', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    closeDatabase();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates an automation with defaults and lists it', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const created = automations.create({
      projectId: project.id,
      name: 'Smoke',
      prompt: 'List 3 files',
      cronExpr: '0 * * * *',
    });

    expect(created.enabled).toBe(true);
    expect(created.runCount).toBe(0);
    expect(created.executorProvider).toBeNull();
    expect(created.lastStatus).toBeNull();

    expect(automations.list(project.id)).toHaveLength(1);
    expect(automations.listAll()).toHaveLength(1);
    expect(automations.listEnabled()).toHaveLength(1);
  });

  it('fails loudly when a newly inserted automation cannot be reloaded', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const getById = vi.spyOn(automations, 'getById').mockReturnValueOnce(null);
    expect(() =>
      automations.create({
        projectId: project.id,
        name: 'Broken',
        prompt: 'p',
        cronExpr: '0 * * * *',
      }),
    ).toThrow('Failed to create automation');
    getById.mockRestore();
  });

  it('creates an automation with explicit executor preferences and disabled state', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const created = automations.create({
      projectId: project.id,
      name: 'Nightly',
      prompt: 'Run the nightly fix loop',
      cronExpr: '0 2 * * *',
      enabled: false,
      executorProvider: 'codex',
      executorModelId: 'gpt-5.4',
      executorReasoningEffort: 'high',
    });

    expect(created).toMatchObject({
      enabled: false,
      executorProvider: 'codex',
      executorModelId: 'gpt-5.4',
      executorReasoningEffort: 'high',
    });
    expect(automations.listEnabled()).toHaveLength(0);
  });

  it('listEnabled excludes disabled automations', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    automations.create({
      projectId: project.id,
      name: 'B',
      prompt: 'p',
      cronExpr: '0 * * * *',
      enabled: false,
    });

    const enabledList = automations.listEnabled();
    expect(enabledList).toHaveLength(1);
    expect(enabledList[0].id).toBe(a.id);
  });

  it('listDue returns automations whose next_run_at has passed', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const past = automations.create({
      projectId: project.id,
      name: 'Past',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    const future = automations.create({
      projectId: project.id,
      name: 'Future',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    automations.setNextRunAt(past.id, '2020-01-01T00:00:00.000Z');
    automations.setNextRunAt(future.id, '2999-01-01T00:00:00.000Z');

    const due = automations.listDue(new Date().toISOString());
    expect(due.map((a) => a.id)).toEqual([past.id]);
  });

  it('listDue excludes disabled and unscheduled automations', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const unscheduled = automations.create({
      projectId: project.id,
      name: 'Unscheduled',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    const disabled = automations.create({
      projectId: project.id,
      name: 'Disabled',
      prompt: 'p',
      cronExpr: '0 * * * *',
      enabled: false,
    });
    automations.setNextRunAt(disabled.id, '2020-01-01T00:00:00.000Z');

    expect(automations.listDue('2026-05-09T00:00:00.000Z')).toEqual([]);
    expect(automations.getById(unscheduled.id)?.nextRunAt).toBeNull();
  });

  it('setEnabled toggles the flag', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    const off = automations.setEnabled(a.id, false);
    expect(off.enabled).toBe(false);
    expect(automations.listEnabled()).toHaveLength(0);

    const on = automations.setEnabled(a.id, true);
    expect(on.enabled).toBe(true);
  });

  it('recordRunStarted increments run_count and sets last_status=running', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    automations.recordRunStarted(a.id, 'thread-1');
    const after = automations.getById(a.id);
    if (!after) throw new Error('Expected automation after run started');
    expect(after.runCount).toBe(1);
    expect(after.lastStatus).toBe('running');
    expect(after.lastStartedAt).not.toBeNull();
    expect(after.lastCompletedAt).toBeNull();
  });

  it('recordRunFinished sets last_status and last_completed_at', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    automations.recordRunStarted(a.id, 'thread-1');

    automations.recordRunFinished(a.id, 'completed');
    const completed = automations.getById(a.id);
    if (!completed) throw new Error('Expected automation after run finished');
    expect(completed.lastStatus).toBe('completed');
    expect(completed.lastCompletedAt).not.toBeNull();

    automations.recordRunFinished(a.id, 'failed');
    expect(automations.getById(a.id)?.lastStatus).toBe('failed');
  });

  it('delete removes the row', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    automations.delete(a.id);
    expect(automations.getById(a.id)).toBeNull();
  });

  it('CASCADE: deleting a project removes its automations', () => {
    const { dataDir, db, projects, automations, project } = setup();
    tempDirs.push(dataDir);

    automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    expect(automations.list(project.id)).toHaveLength(1);

    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    expect(projects.getById(project.id)).toBeNull();
    expect(automations.listAll()).toHaveLength(0);
  });

  it('update changes only specified fields', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p1',
      cronExpr: '0 * * * *',
    });

    const updated = automations.update(a.id, { prompt: 'p2', cronExpr: '*/5 * * * *' });
    expect(updated.prompt).toBe('p2');
    expect(updated.cronExpr).toBe('*/5 * * * *');
    expect(updated.name).toBe('A');
    expect(updated.enabled).toBe(true);
  });

  it('update can clear executor preferences and rejects missing rows', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p1',
      cronExpr: '0 * * * *',
      executorProvider: 'claude',
      executorModelId: 'claude-opus-4-1',
      executorReasoningEffort: 'xhigh',
    });

    const updated = automations.update(a.id, {
      name: 'B',
      prompt: 'p2',
      cronExpr: '*/15 * * * *',
      enabled: false,
      executorProvider: null,
      executorModelId: null,
      executorReasoningEffort: null,
    });

    expect(updated).toMatchObject({
      name: 'B',
      prompt: 'p2',
      cronExpr: '*/15 * * * *',
      enabled: false,
      executorProvider: null,
      executorModelId: null,
      executorReasoningEffort: null,
    });
    expect(() => automations.update('missing-automation', { name: 'Nope' })).toThrow(
      'Automation missing-automation not found',
    );
  });

  it('fails loudly when an updated automation disappears before reload', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p1',
      cronExpr: '0 * * * *',
    });
    const getById = vi
      .spyOn(automations, 'getById')
      .mockReturnValueOnce(a)
      .mockReturnValueOnce(null);

    expect(() => automations.update(a.id, { name: 'B' })).toThrow(
      `Automation ${a.id} disappeared after update`,
    );
    getById.mockRestore();
  });

  it('create backfills a single target equal to the primary project', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    expect(a.projectId).toBe(project.id);
    expect(a.targets).toEqual([project.id]);
    expect(automations.listTargets(a.id)).toEqual([project.id]);
  });

  it('create with explicit targets stores all and lists under any target', () => {
    const { dataDir, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const a = automations.create({
      projectId: project.id,
      targets: [project.id, projectB.id, project.id], // duplicate is deduped
      name: 'Multi',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    expect(a.projectId).toBe(project.id);
    expect(a.targets).toEqual([project.id, projectB.id]);
    expect(automations.list(project.id).map((x) => x.id)).toContain(a.id);
    expect(automations.list(projectB.id).map((x) => x.id)).toContain(a.id);
  });

  it('addTarget and removeTarget mutate the set idempotently', () => {
    const { dataDir, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    automations.addTarget(a.id, projectB.id);
    automations.addTarget(a.id, projectB.id); // idempotent
    expect(automations.listTargets(a.id)).toEqual([project.id, projectB.id]);

    automations.removeTarget(a.id, projectB.id);
    expect(automations.listTargets(a.id)).toEqual([project.id]);
  });

  it('removeTarget realigns the primary projectId when the primary is removed', () => {
    const { dataDir, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const a = automations.create({
      projectId: project.id,
      targets: [project.id, projectB.id],
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    expect(a.projectId).toBe(project.id);

    // Removing the primary must not leave project_id pointing at a de-targeted
    // project — it realigns to the next remaining target (oldest first).
    automations.removeTarget(a.id, project.id);
    const reloaded = automations.getById(a.id);
    if (!reloaded) throw new Error('Expected automation after removeTarget');
    expect(reloaded.targets).toEqual([projectB.id]);
    expect(reloaded.projectId).toBe(projectB.id);
  });

  it('removeTarget refuses to empty the target set', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    // Removing the only target would strand the automation: zero rows makes
    // mapAutomation resurrect the removed project and the scheduler fire against
    // it forever, while list()'s INNER JOIN hides it from every project UI.
    expect(() => automations.removeTarget(a.id, project.id)).toThrow('at least one target');
    expect(automations.listTargets(a.id)).toEqual([project.id]);
    expect(automations.getById(a.id)?.projectId).toBe(project.id);
  });

  it('removeTarget of a non-target is a harmless no-op', () => {
    const { dataDir, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    automations.removeTarget(a.id, projectB.id);
    expect(automations.listTargets(a.id)).toEqual([project.id]);
    expect(automations.getById(a.id)?.projectId).toBe(project.id);
  });

  it('update applies a new target set atomically and realigns the primary', () => {
    const { dataDir, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    const updated = automations.update(a.id, {
      name: 'B',
      targets: [projectB.id, project.id],
    });
    expect(updated.name).toBe('B');
    expect(updated.targets).toEqual([projectB.id, project.id]);
    expect(updated.projectId).toBe(projectB.id);
    expect(automations.list(projectB.id).map((x) => x.id)).toContain(a.id);
  });

  it('update rejects an empty target set and rolls back column changes', () => {
    const { dataDir, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    expect(() => automations.update(a.id, { name: 'B', targets: [] })).toThrow(
      'at least one target',
    );
    // The column change must not survive a rejected target set.
    const reloaded = automations.getById(a.id);
    expect(reloaded?.name).toBe('A');
    expect(reloaded?.targets).toEqual([project.id]);
  });

  it('setTargets replaces the set and realigns the primary projectId', () => {
    const { dataDir, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });

    automations.setTargets(a.id, [projectB.id, project.id]);
    const reloaded = automations.getById(a.id);
    if (!reloaded) throw new Error('Expected automation after setTargets');
    expect(reloaded.targets).toEqual([projectB.id, project.id]);
    expect(reloaded.projectId).toBe(projectB.id);

    expect(() => automations.setTargets(a.id, [])).toThrow('at least one target');
  });

  it('hydrates targets to [projectId] when no target rows exist', () => {
    const { dataDir, db, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    db.prepare('DELETE FROM automation_targets WHERE automation_id = ?').run(a.id);

    expect(automations.getById(a.id)?.targets).toEqual([project.id]);
  });

  it('list paths batch target hydration into a single query (no N+1)', () => {
    const { dataDir, db, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    automations.create({ projectId: project.id, name: 'A', prompt: 'p', cronExpr: '0 * * * *' });
    automations.create({
      projectId: project.id,
      targets: [project.id, projectB.id],
      name: 'B',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    automations.create({ projectId: project.id, name: 'C', prompt: 'p', cronExpr: '0 * * * *' });

    const prepareSpy = vi.spyOn(db, 'prepare');
    const all = automations.listAll();
    const targetQueries = prepareSpy.mock.calls.filter(([sql]) =>
      /FROM automation_targets/.test(String(sql)),
    );
    prepareSpy.mockRestore();

    expect(all).toHaveLength(3);
    // One batched IN(...) query, not one SELECT per returned row (was 3 pre-refactor).
    expect(targetQueries).toHaveLength(1);
  });

  it('listAll hydrates multi-target and zero-target automations correctly', () => {
    const { dataDir, db, projects, automations, project } = setup();
    tempDirs.push(dataDir);
    const projectB = projects.add(path.join(dataDir, 'project-b'));

    const multi = automations.create({
      projectId: project.id,
      targets: [project.id, projectB.id],
      name: 'Multi',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    const orphan = automations.create({
      projectId: project.id,
      name: 'Orphan',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    // Strip the orphan's target rows to exercise the zero-target fallback.
    db.prepare('DELETE FROM automation_targets WHERE automation_id = ?').run(orphan.id);

    const byId = new Map(automations.listAll().map((a) => [a.id, a]));
    expect(byId.get(multi.id)?.targets).toEqual([project.id, projectB.id]);
    // Zero target rows falls back to the primary projectId, matching listTargets/hydrate.
    expect(byId.get(orphan.id)?.targets).toEqual([project.id]);
  });

  it('CASCADE: deleting an automation removes its targets', () => {
    const { dataDir, db, automations, project } = setup();
    tempDirs.push(dataDir);

    const a = automations.create({
      projectId: project.id,
      name: 'A',
      prompt: 'p',
      cronExpr: '0 * * * *',
    });
    expect(automations.listTargets(a.id)).toHaveLength(1);

    automations.delete(a.id);
    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM automation_targets WHERE automation_id = ?')
      .get(a.id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  // === project-removal reconciliation (regression: primary project_id was a
  // bare ON DELETE CASCADE FK, so removing the primary destroyed the whole
  // automation and wiped targets for OTHER still-existing projects) ===
  describe('project removal reconciliation', () => {
    it('reassigns a multi-repo automation off its removed primary instead of destroying it', () => {
      const { dataDir, automations, projects, project } = setup();
      tempDirs.push(dataDir);
      const projectY = projects.add(path.join(dataDir, 'project-y'));

      const a = automations.create({
        projectId: project.id,
        targets: [project.id, projectY.id], // primary = X, secondary = Y
        name: 'A',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });
      expect(a.projectId).toBe(project.id);

      projects.removeIfIdle(project.id);

      const reloaded = automations.getById(a.id);
      expect(reloaded).not.toBeNull();
      // Primary reassigned to the surviving target; the doomed target row is gone.
      expect(reloaded?.projectId).toBe(projectY.id);
      expect(reloaded?.targets).toEqual([projectY.id]);
    });

    it('reassigns to the oldest remaining target and keeps the rest', () => {
      const { dataDir, db, automations, projects, project } = setup();
      tempDirs.push(dataDir);
      const projectY = projects.add(path.join(dataDir, 'project-y'));
      const projectZ = projects.add(path.join(dataDir, 'project-z'));

      const a = automations.create({
        projectId: project.id,
        targets: [project.id, projectY.id, projectZ.id],
        name: 'A',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });
      // Force a deterministic created_at ordering: Y older than Z.
      db.prepare(
        "UPDATE automation_targets SET created_at = '2026-01-01T00:00:00.000Z' WHERE automation_id = ? AND project_id = ?",
      ).run(a.id, projectY.id);
      db.prepare(
        "UPDATE automation_targets SET created_at = '2026-01-02T00:00:00.000Z' WHERE automation_id = ? AND project_id = ?",
      ).run(a.id, projectZ.id);

      projects.removeIfIdle(project.id);

      const reloaded = automations.getById(a.id);
      expect(reloaded?.projectId).toBe(projectY.id);
      expect(reloaded?.targets).toEqual([projectY.id, projectZ.id]);
    });

    it('cascade-deletes an automation whose only target is the removed project', () => {
      const { dataDir, automations, projects, project } = setup();
      tempDirs.push(dataDir);

      const a = automations.create({
        projectId: project.id,
        name: 'Solo',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });

      expect(automations.listCascadingProjectRemoval(project.id)).toEqual([a.id]);

      projects.removeIfIdle(project.id);
      expect(automations.getById(a.id)).toBeNull();
    });

    it('leaves a secondary-target automation intact (FK drops only its target row)', () => {
      const { dataDir, automations, projects, project } = setup();
      tempDirs.push(dataDir);
      const projectX = projects.add(path.join(dataDir, 'project-x'));

      // Primary = Y (the setup project), secondary = X (to be removed).
      const a = automations.create({
        projectId: project.id,
        targets: [project.id, projectX.id],
        name: 'A',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });

      // X is only a secondary target, so it does not cascade the automation away.
      expect(automations.listCascadingProjectRemoval(projectX.id)).toEqual([]);

      projects.removeIfIdle(projectX.id);

      const reloaded = automations.getById(a.id);
      expect(reloaded?.projectId).toBe(project.id);
      expect(reloaded?.targets).toEqual([project.id]);
    });

    it('does NOT wipe a sibling automation on the surviving repo (core data-loss regression)', () => {
      const { dataDir, automations, projects, project } = setup();
      tempDirs.push(dataDir);
      const projectY = projects.add(path.join(dataDir, 'project-y'));

      // Shared automation: X primary + Y.
      const shared = automations.create({
        projectId: project.id,
        targets: [project.id, projectY.id],
        name: 'Shared',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });
      // Y-only automation that must be completely untouched by removing X.
      const yOnly = automations.create({
        projectId: projectY.id,
        name: 'Y only',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });

      projects.removeIfIdle(project.id);

      expect(automations.getById(shared.id)?.targets).toEqual([projectY.id]);
      const yReloaded = automations.getById(yOnly.id);
      expect(yReloaded).not.toBeNull();
      expect(yReloaded?.targets).toEqual([projectY.id]);
      expect(
        automations
          .list(projectY.id)
          .map((x) => x.id)
          .sort(),
      ).toEqual([shared.id, yOnly.id].sort());
    });

    it('rolls back reassignment when the project is not idle (removeIfIdle returns false)', () => {
      const { dataDir, db, automations, projects, project } = setup();
      tempDirs.push(dataDir);
      const projectY = projects.add(path.join(dataDir, 'project-y'));

      const a = automations.create({
        projectId: project.id,
        targets: [project.id, projectY.id],
        name: 'A',
        prompt: 'p',
        cronExpr: '0 * * * *',
      });
      // Live work blocks removal.
      db.prepare(
        "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t-live', ?, 'title', 'prompt', 'executing')",
      ).run(project.id);

      expect(projects.removeIfIdle(project.id)).toBe(false);

      // Reassignment must be fully undone: primary still X, both targets intact.
      const reloaded = automations.getById(a.id);
      expect(reloaded?.projectId).toBe(project.id);
      expect(reloaded?.targets).toEqual([project.id, projectY.id]);
    });
  });
});
