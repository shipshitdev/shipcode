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
});
