import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { registerPipelineHandlers } from './register-pipeline-handlers';

function createIpcMainMock() {
  const handlers = new Map<string, Function>();
  return {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    invoke: async (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler for ${channel}`);
      return handler({}, ...args);
    },
  };
}

function makePlan() {
  return {
    id: 'plan-1',
    threadId: 't1',
    version: 1,
    objective: 'Ship it',
    files: [],
    steps: [],
    acceptanceCriteria: [],
    outOfScope: [],
    estimatedComplexity: 'low',
    dependencies: [],
  } as const;
}

describe('registerPipelineHandlers', () => {
  it('starts execution immediately when a slot is available', async () => {
    const ipcMain = createIpcMainMock();
    const scheduler = {
      startApprovedExecution: vi.fn(async () => ({ started: true as const })),
    } as any;
    const latestPlan = {
      id: 'plan-1',
      threadId: 't1',
      version: 1,
      rawOutput: '',
      structured: makePlan(),
      status: 'pending_review',
      createdAt: new Date().toISOString(),
    };
    const queries = {
      threads: {
        updateStatus: vi.fn(),
      },
      plans: {
        getLatest: vi.fn(() => latestPlan),
        updateStatus: vi.fn(),
        updateStructured: vi.fn(),
      },
    };
    const mainWindow = {
      webContents: {
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerPipelineHandlers(ipcMain as any, mainWindow, queries as any, scheduler);
    await ipcMain.invoke('pipeline:approve', { threadId: 't1' });

    expect(scheduler.startApprovedExecution).toHaveBeenCalledWith('t1', latestPlan.structured);
    expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
    expect(queries.threads.updateStatus).not.toHaveBeenCalled();
  });

  it('keeps the thread paused when execution capacity is full', async () => {
    const ipcMain = createIpcMainMock();
    const scheduler = {
      startApprovedExecution: vi.fn(async () => ({
        started: false as const,
        error: 'Cannot start execution: max concurrent pipelines (1) already reached.',
      })),
    } as any;
    const latestPlan = {
      id: 'plan-1',
      threadId: 't1',
      version: 1,
      rawOutput: '',
      structured: makePlan(),
      status: 'pending_review',
      createdAt: new Date().toISOString(),
    };
    const queries = {
      threads: {
        updateStatus: vi.fn(),
      },
      plans: {
        getLatest: vi.fn(() => latestPlan),
        updateStatus: vi.fn(),
        updateStructured: vi.fn(),
      },
    };
    const mainWindow = {
      webContents: {
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerPipelineHandlers(ipcMain as any, mainWindow, queries as any, scheduler);

    await expect(ipcMain.invoke('pipeline:approve', { threadId: 't1' })).rejects.toThrow(
      /max concurrent pipelines/,
    );
    expect(scheduler.startApprovedExecution).toHaveBeenCalledWith('t1', latestPlan.structured);
    expect(queries.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
    expect(queries.threads.updateStatus).toHaveBeenCalledWith(
      't1',
      'awaiting_approval',
      'Cannot start execution: max concurrent pipelines (1) already reached.',
    );
  });
});
