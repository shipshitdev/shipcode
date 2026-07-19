import type { Automation } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationSchedulerLike } from '../automation-scheduler';
import { registerAutomationHandlers } from './register-automation-handlers';

const { assertCliPhaseModelsSupportedMock, resolveProjectPhaseModelsMock } = vi.hoisted(() => ({
  assertCliPhaseModelsSupportedMock: vi.fn(async () => undefined),
  resolveProjectPhaseModelsMock: vi.fn(() => ({
    plannerModel: 'claude',
    reviewerModel: 'claude',
    executorModel: 'codex',
    verifierModel: 'codex',
    plannerModelId: 'claude-sonnet-4-6',
    reviewerModelId: 'claude-sonnet-4-6',
    executorModelId: 'gpt-5.5',
    verifierModelId: 'gpt-5.5',
    plannerReasoningEffort: 'high',
    reviewerReasoningEffort: 'high',
    executorReasoningEffort: 'high',
    verifierReasoningEffort: 'high',
  })),
}));

vi.mock('./helpers', () => ({
  assertCliPhaseModelsSupported: assertCliPhaseModelsSupportedMock,
  resolveProjectPhaseModels: resolveProjectPhaseModelsMock,
}));

vi.mock('../logger.service', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    projectId: 'project-1',
    targets: ['project-1'],
    name: 'Nightly cleanup',
    prompt: 'Clean up stale worktrees',
    cronExpr: '0 0 * * *',
    enabled: true,
    executorProvider: null,
    executorModelId: null,
    executorReasoningEffort: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastStatus: null,
    nextRunAt: null,
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('registerAutomationHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const automations = {
    listAll: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setEnabled: vi.fn(),
    setNextRunAt: vi.fn(),
  };

  const threads = {
    listByAutomationId: vi.fn(),
  };

  const projects = {
    getById: vi.fn(),
  };

  const settings = {
    get: vi.fn(),
  };

  const automationScheduler: AutomationSchedulerLike = {
    start: vi.fn(),
    stop: vi.fn(),
    schedule: vi.fn(),
    unschedule: vi.fn(),
    fireNow: vi.fn(),
  };

  function getHandler(channel: string) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return handler;
  }

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    automations.getById.mockReturnValue(makeAutomation());
    projects.getById.mockImplementation((id: string) => ({ id, name: id }));
    settings.get.mockReturnValue({});
    assertCliPhaseModelsSupportedMock.mockResolvedValue(undefined);
    registerAutomationHandlers(
      {
        ipcMain,
        queries: { automations, threads, projects, settings },
      } as never,
      automationScheduler,
    );
  });

  it('run-now returns the scheduler queue decision', async () => {
    automations.getById.mockReturnValue(makeAutomation());
    vi.mocked(automationScheduler.fireNow).mockResolvedValueOnce({ queued: true });

    const handler = getHandler('automations:run-now');
    const result = await handler(null, { id: 'auto-1' });

    expect(result).toEqual({ queued: true });
    expect(automationScheduler.fireNow).toHaveBeenCalledWith('auto-1');
  });

  it('run-now rejects missing automations before firing', async () => {
    automations.getById.mockReturnValue(null);

    const handler = getHandler('automations:run-now');

    await expect(handler(null, { id: 'missing' })).rejects.toThrow('Automation missing not found');
    expect(automationScheduler.fireNow).not.toHaveBeenCalled();
  });

  it('lists, reads, creates, updates, deletes, and loads run history', async () => {
    const automation = makeAutomation();
    const updatedAutomation = makeAutomation({ name: 'Updated cleanup' });
    const runs = [{ id: 'thread-1' }];
    automations.listAll.mockReturnValue([automation]);
    automations.list.mockReturnValue([automation]);
    automations.getById.mockReturnValue(automation);
    automations.create.mockReturnValue(automation);
    automations.update.mockReturnValue(updatedAutomation);
    threads.listByAutomationId.mockReturnValue(runs);

    await expect(getHandler('automations:list-all')(null)).resolves.toEqual([automation]);
    await expect(getHandler('automations:list')(null, { projectId: 'project-1' })).resolves.toEqual(
      [automation],
    );
    await expect(getHandler('automations:get')(null, { id: 'auto-1' })).resolves.toEqual(
      automation,
    );
    await expect(
      getHandler('automations:create')(null, {
        projectId: 'project-1',
        name: 'Nightly cleanup',
        prompt: 'Clean up stale worktrees',
        cronExpr: '0 0 * * *',
        enabled: true,
      }),
    ).resolves.toEqual(automation);
    expect(automationScheduler.schedule).toHaveBeenCalledWith(automation);

    await expect(
      getHandler('automations:update')(null, {
        id: 'auto-1',
        name: 'Updated cleanup',
        cronExpr: '0 1 * * *',
      }),
    ).resolves.toEqual(updatedAutomation);
    expect(automations.update).toHaveBeenCalledWith('auto-1', {
      name: 'Updated cleanup',
      cronExpr: '0 1 * * *',
    });
    expect(automationScheduler.schedule).toHaveBeenCalledWith(updatedAutomation);

    await expect(
      getHandler('automations:run-history')(null, { automationId: 'auto-1' }),
    ).resolves.toEqual(runs);
    await expect(getHandler('automations:delete')(null, { id: 'auto-1' })).resolves.toBeUndefined();
    expect(automationScheduler.unschedule).toHaveBeenCalledWith('auto-1');
    expect(automations.delete).toHaveBeenCalledWith('auto-1');
  });

  it('forwards an edited target set through to update', async () => {
    const updated = makeAutomation({ targets: ['project-1', 'project-2'] });
    automations.update.mockReturnValue(updated);

    await expect(
      getHandler('automations:update')(null, {
        id: 'auto-1',
        name: 'Multi-repo',
        targets: ['project-1', 'project-2'],
      }),
    ).resolves.toEqual(updated);
    // `update` applies targets atomically with the column change (setTargets is
    // nested inside its transaction), so the handler just forwards them.
    expect(automations.update).toHaveBeenCalledWith('auto-1', {
      name: 'Multi-repo',
      targets: ['project-1', 'project-2'],
    });
    expect(automationScheduler.schedule).toHaveBeenCalledWith(updated);
  });

  it('schedules enabled automations and unschedules disabled automations', async () => {
    const automation = makeAutomation();
    automations.setEnabled.mockReturnValue(automation);

    await expect(
      getHandler('automations:set-enabled')(null, { id: 'auto-1', enabled: true }),
    ).resolves.toEqual(automation);
    expect(automationScheduler.schedule).toHaveBeenCalledWith(automation);

    await expect(
      getHandler('automations:set-enabled')(null, { id: 'auto-1', enabled: false }),
    ).resolves.toEqual(automation);
    expect(automationScheduler.unschedule).toHaveBeenCalledWith('auto-1');
    expect(automations.setNextRunAt).toHaveBeenCalledWith('auto-1', null);
  });

  it('wraps invalid cron errors for create and update', async () => {
    await expect(
      getHandler('automations:create')(null, {
        projectId: 'project-1',
        name: 'Bad cron',
        prompt: 'nope',
        cronExpr: 'not cron',
        enabled: true,
      }),
    ).rejects.toThrow();
    await expect(
      getHandler('automations:update')(null, { id: 'auto-1', cronExpr: 'still not cron' }),
    ).rejects.toThrow();
    expect(automations.create).not.toHaveBeenCalled();
    expect(automations.update).not.toHaveBeenCalled();
  });

  it('validates normalized model selections before creating or updating automations', async () => {
    const automation = makeAutomation({
      executorProvider: 'codex',
      executorModelId: 'gpt-5.6-sol',
    });
    automations.create.mockReturnValue(automation);
    automations.update.mockReturnValue(automation);

    await getHandler('automations:create')(null, {
      projectId: 'project-1',
      targets: ['project-1', 'project-2'],
      name: 'Frontier run',
      prompt: 'Run it',
      cronExpr: '0 0 * * *',
      executorProvider: 'codex',
      executorModelId: 'sol',
    });

    expect(projects.getById).toHaveBeenCalledTimes(4);
    expect(assertCliPhaseModelsSupportedMock).toHaveBeenCalledTimes(2);
    expect(assertCliPhaseModelsSupportedMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ executorModel: 'codex', executorModelId: 'gpt-5.6-sol' }),
    );
    expect(automations.create).toHaveBeenCalledWith(
      expect.objectContaining({ executorModelId: 'gpt-5.6-sol' }),
    );

    await getHandler('automations:update')(null, {
      id: 'auto-1',
      executorReasoningEffort: 'xhigh',
    });

    expect(assertCliPhaseModelsSupportedMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executorModel: 'codex',
        executorModelId: 'gpt-5.5',
        executorReasoningEffort: 'xhigh',
      }),
    );
    expect(automations.update).toHaveBeenCalled();
  });

  it('preserves Claude rolling aliases and rejects them for OpenRouter automations', async () => {
    automations.create.mockReturnValue(
      makeAutomation({ executorProvider: 'claude', executorModelId: 'opus' }),
    );

    await getHandler('automations:create')(null, {
      projectId: 'project-1',
      name: 'Latest Opus',
      prompt: 'Run it',
      cronExpr: '0 0 * * *',
      executorProvider: 'claude',
      executorModelId: '  OPUS  ',
    });

    expect(automations.create).toHaveBeenCalledWith(
      expect.objectContaining({ executorProvider: 'claude', executorModelId: 'opus' }),
    );
    await expect(
      getHandler('automations:create')(null, {
        projectId: 'project-1',
        name: 'Invalid OpenRouter alias',
        prompt: 'Run it',
        cronExpr: '0 0 * * *',
        executorProvider: 'openrouter',
        executorModelId: 'opus',
      }),
    ).rejects.toThrow('opus is a rolling Claude CLI alias');
  });

  it('does not persist an automation when model preflight fails', async () => {
    assertCliPhaseModelsSupportedMock.mockRejectedValueOnce(
      new Error('Executor: Codex CLI 1.0.3 cannot serve gpt-5.6-sol'),
    );

    await expect(
      getHandler('automations:create')(null, {
        projectId: 'project-1',
        name: 'Broken run',
        prompt: 'Run it',
        cronExpr: '0 0 * * *',
        executorProvider: 'codex',
        executorModelId: 'gpt-5.6-sol',
      }),
    ).rejects.toThrow('Executor: Codex CLI 1.0.3 cannot serve gpt-5.6-sol');

    expect(automations.create).not.toHaveBeenCalled();
    expect(automationScheduler.schedule).not.toHaveBeenCalled();
  });

  it('preflights a disabled automation before enabling it', async () => {
    automations.getById.mockReturnValue(
      makeAutomation({
        enabled: false,
        executorProvider: 'codex',
        executorModelId: 'gpt-5.6-sol',
      }),
    );
    assertCliPhaseModelsSupportedMock.mockRejectedValueOnce(
      new Error('Executor: Codex CLI cannot serve gpt-5.6-sol'),
    );

    await expect(
      getHandler('automations:set-enabled')(null, { id: 'auto-1', enabled: true }),
    ).rejects.toThrow('Executor: Codex CLI cannot serve gpt-5.6-sol');

    expect(automations.setEnabled).not.toHaveBeenCalled();
    expect(automationScheduler.schedule).not.toHaveBeenCalled();
  });

  it('rejects updates for automations that no longer exist', async () => {
    automations.getById.mockReturnValue(null);

    await expect(
      getHandler('automations:update')(null, { id: 'missing', name: 'Renamed' }),
    ).rejects.toThrow('Automation missing not found');
    expect(automations.update).not.toHaveBeenCalled();
    expect(automationScheduler.schedule).not.toHaveBeenCalled();
  });

  it('rejects enabling automations that no longer exist', async () => {
    automations.getById.mockReturnValue(null);

    await expect(
      getHandler('automations:set-enabled')(null, { id: 'missing', enabled: true }),
    ).rejects.toThrow('Automation missing not found');
    expect(automations.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects updates whose targets reference a missing project', async () => {
    automations.getById.mockReturnValue(makeAutomation({ targets: ['project-gone'] }));
    projects.getById.mockReturnValue(null);

    await expect(
      getHandler('automations:update')(null, { id: 'auto-1', name: 'Renamed' }),
    ).rejects.toThrow('Automation target project project-gone not found');
    expect(automations.update).not.toHaveBeenCalled();
  });

  it('rejects updates that select gh or shell as the automation executor', async () => {
    automations.getById.mockReturnValue(makeAutomation());

    await expect(
      getHandler('automations:update')(null, { id: 'auto-1', executorProvider: 'gh' }),
    ).rejects.toThrow('gh cannot be used as an automation executor');
    expect(automations.update).not.toHaveBeenCalled();
  });
});
