import type { Automation } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationScheduler } from './automation-scheduler';

vi.mock('./logger.service', () => ({
  default: {
    debug: vi.fn(),
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AutomationScheduler', () => {
  let queries: {
    listEnabled: ReturnType<typeof vi.fn>;
    listDue: ReturnType<typeof vi.fn>;
    setNextRunAt: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
  let pipelineScheduler: {
    startOrQueueAutomation: ReturnType<typeof vi.fn>;
  };
  let scheduler: AutomationScheduler;

  beforeEach(() => {
    queries = {
      listEnabled: vi.fn(() => [] as Automation[]),
      listDue: vi.fn(() => [] as Automation[]),
      setNextRunAt: vi.fn(),
      getById: vi.fn((id: string) => makeAutomation({ id })),
    };
    pipelineScheduler = {
      startOrQueueAutomation: vi.fn(async () => ({ queued: false })),
    };
    scheduler = new AutomationScheduler({
      automations: queries as never,
      pipelineScheduler: pipelineScheduler as never,
    });
  });

  it('start() schedules every enabled automation', () => {
    queries.listEnabled.mockReturnValue([
      makeAutomation({ id: 'a' }),
      makeAutomation({ id: 'b', cronExpr: '*/5 * * * *' }),
    ]);

    scheduler.start();

    // Two next_run_at writes (one per scheduled automation)
    expect(queries.setNextRunAt).toHaveBeenCalledWith('a', expect.any(String));
    expect(queries.setNextRunAt).toHaveBeenCalledWith('b', expect.any(String));
  });

  it('start() advances next_run_at for missed ticks without firing', () => {
    const overdue = makeAutomation({ id: 'overdue' });
    queries.listEnabled.mockReturnValue([overdue]);
    queries.listDue.mockReturnValue([overdue]);

    scheduler.start();

    expect(pipelineScheduler.startOrQueueAutomation).not.toHaveBeenCalled();
    // setNextRunAt called once on schedule + once on missed-tick advance.
    expect(queries.setNextRunAt).toHaveBeenCalledTimes(2);
  });

  it('start() checks for missed ticks before schedule() overwrites next_run_at', () => {
    const events: string[] = [];
    const overdue = makeAutomation({ id: 'overdue' });
    queries.listEnabled.mockReturnValue([overdue]);
    queries.listDue.mockImplementation(() => {
      events.push(`listDue:${queries.setNextRunAt.mock.calls.length}`);
      return [overdue];
    });
    queries.setNextRunAt.mockImplementation(() => {
      events.push('setNextRunAt');
    });

    scheduler.start();

    expect(events[0]).toBe('listDue:0');
    expect(queries.setNextRunAt).toHaveBeenCalledTimes(2);
    expect(pipelineScheduler.startOrQueueAutomation).not.toHaveBeenCalled();
  });

  it('schedule() ignores disabled automations', () => {
    scheduler.schedule(makeAutomation({ enabled: false }));
    expect(queries.setNextRunAt).not.toHaveBeenCalled();
  });

  it('schedule() with invalid cron does not throw and does not register a job', () => {
    expect(() =>
      scheduler.schedule(makeAutomation({ id: 'bad', cronExpr: 'not a cron' })),
    ).not.toThrow();
    expect(queries.setNextRunAt).not.toHaveBeenCalled();
  });

  it('schedule() then unschedule() removes the job', () => {
    scheduler.schedule(makeAutomation({ id: 'a' }));
    scheduler.unschedule('a');
    // No throw on second unschedule
    expect(() => scheduler.unschedule('a')).not.toThrow();
  });

  it('fireNow() routes through pipelineScheduler.startOrQueueAutomation', async () => {
    const result = await scheduler.fireNow('auto-1');

    expect(result).toEqual({ queued: false });
    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledWith('auto-1', 'project-1');
    expect(queries.setNextRunAt).toHaveBeenCalledWith('auto-1', null);
  });

  it('fireNow() refreshes next_run_at from an existing scheduled job', async () => {
    scheduler.schedule(makeAutomation({ id: 'auto-1' }));
    queries.setNextRunAt.mockClear();

    await scheduler.fireNow('auto-1');

    expect(queries.setNextRunAt).toHaveBeenCalledWith('auto-1', expect.any(String));
  });

  it('fireNow() returns the scheduler queue decision', async () => {
    pipelineScheduler.startOrQueueAutomation.mockResolvedValueOnce({ queued: true });

    await expect(scheduler.fireNow('auto-queued')).resolves.toEqual({ queued: true });
  });

  it('in-flight guard: concurrent fires of same id share one promise', async () => {
    let resolveStart: (() => void) | undefined;
    pipelineScheduler.startOrQueueAutomation.mockImplementation(
      () =>
        new Promise<{ queued: boolean }>((resolve) => {
          resolveStart = () => resolve({ queued: false });
        }),
    );

    const first = scheduler.fireNow('auto-1');
    const second = scheduler.fireNow('auto-1');

    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledTimes(1);
    resolveStart?.();
    await Promise.all([first, second]);
  });

  it('fire bubbles errors from pipelineScheduler', async () => {
    pipelineScheduler.startOrQueueAutomation.mockRejectedValue(new Error('boom'));
    await expect(scheduler.fireNow('auto-1')).rejects.toThrow('boom');
  });

  it('stop() clears all jobs', () => {
    scheduler.schedule(makeAutomation({ id: 'a' }));
    scheduler.schedule(makeAutomation({ id: 'b' }));
    scheduler.stop();
    expect(() => scheduler.unschedule('a')).not.toThrow();
  });

  it('fans out one dispatch per target project', async () => {
    queries.getById.mockReturnValue(makeAutomation({ id: 'multi', targets: ['p1', 'p2', 'p3'] }));

    await scheduler.fireNow('multi');

    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledTimes(3);
    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledWith('multi', 'p1');
    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledWith('multi', 'p2');
    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledWith('multi', 'p3');
  });

  it('per-target guard: a second fire only dispatches not-yet-running targets', async () => {
    queries.getById.mockReturnValue(makeAutomation({ id: 'multi', targets: ['p1', 'p2'] }));
    const resolvers: Array<() => void> = [];
    pipelineScheduler.startOrQueueAutomation.mockImplementation(
      () =>
        new Promise<{ queued: boolean }>((resolve) =>
          resolvers.push(() => resolve({ queued: false })),
        ),
    );

    const first = scheduler.fireNow('multi'); // dispatches p1, p2 (pending)
    const second = scheduler.fireNow('multi'); // both in-flight → no new dispatch

    expect(pipelineScheduler.startOrQueueAutomation).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual({ queued: false });
    for (const r of resolvers) r();
    await first;
  });

  it('skips a disabled automation without dispatching', async () => {
    queries.getById.mockReturnValue(makeAutomation({ id: 'off', enabled: false }));

    const result = await scheduler.fireNow('off');

    expect(result).toEqual({ queued: false });
    expect(pipelineScheduler.startOrQueueAutomation).not.toHaveBeenCalled();
    expect(queries.setNextRunAt).toHaveBeenCalledWith('off', null);
  });
});
