import type { Automation } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cronMocks = vi.hoisted(() => {
  const jobs: Array<{
    callback: () => void;
    nextRun: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    jobs,
    Cron: vi.fn(function MockCron(
      this: { nextRun: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> },
      _expr: string,
      _options: unknown,
      callback: () => void,
    ) {
      this.nextRun = vi.fn(() => null);
      this.stop = vi.fn();
      jobs.push({ callback, nextRun: this.nextRun, stop: this.stop });
    }),
  };
});

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('croner', () => ({
  Cron: cronMocks.Cron,
}));

vi.mock('./logger.service', () => ({
  default: loggerMock,
}));

import { AutomationScheduler } from './automation-scheduler';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    projectId: 'project-1',
    targets: ['project-1'],
    name: 'Hourly smoke',
    prompt: 'List 3 files',
    cronExpr: '0 * * * *',
    enabled: true,
    executorProvider: null,
    executorModelId: null,
    executorReasoningEffort: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastStatus: null,
    nextRunAt: null,
    runCount: 0,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('AutomationScheduler cron callback coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cronMocks.jobs.length = 0;
  });

  it('logs cron callback failures and records null next run values', async () => {
    const queries = {
      listEnabled: vi.fn(() => [] as Automation[]),
      listDue: vi.fn(() => [makeAutomation({ id: 'overdue' })]),
      setNextRunAt: vi.fn(),
      getById: vi.fn((id: string) => makeAutomation({ id })),
    };
    const pipelineScheduler = {
      startOrQueueAutomation: vi.fn(async () => {
        throw new Error('queue failed');
      }),
    };
    const scheduler = new AutomationScheduler({
      automations: queries as never,
      pipelineScheduler: pipelineScheduler as never,
    });

    scheduler.schedule(makeAutomation({ id: 'auto-1' }));
    expect(queries.setNextRunAt).toHaveBeenCalledWith('auto-1', null);

    cronMocks.jobs[0]?.callback();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledWith('auto-1', 'project-1');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[automation:auto-1] fire failed:',
      expect.any(Error),
    );

    scheduler.start();
    expect(queries.setNextRunAt).toHaveBeenCalledWith('overdue', null);
    expect(loggerMock.info).toHaveBeenCalledWith(
      '[automation] skipping missed tick for overdue (Hourly smoke); next at none',
    );
  });
});
