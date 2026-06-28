import type { Automation } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationSchedulerLike } from '../automation-scheduler';
import { registerAutomationHandlers } from './register-automation-handlers';

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
    registerAutomationHandlers(
      {
        ipcMain,
        queries: { automations, threads },
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
});
