import os from 'node:os';
import type { ProcessManager } from '@shipcode/agents/source';
import type { Pipeline } from '@shipcode/pipeline';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Queries } from './ipc/types';
import { ResourceMonitor } from './resource-monitor';

function makeCpuSnapshot(idle: number, total: number): ReturnType<typeof os.cpus> {
  return [
    {
      model: 'test-cpu',
      speed: 2400,
      times: {
        idle,
        user: total - idle,
        nice: 0,
        sys: 0,
        irq: 0,
      },
    },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResourceMonitor', () => {
  it('enriches managed process resource usage with thread and project context', async () => {
    const processManager = {
      listResourceUsage: vi.fn(async () => [
        {
          processId: 'proc-1',
          type: 'shell',
          state: 'running',
          pid: 1234,
          childPids: [1235],
          threadId: 'thread-1',
          cwd: '/tmp/shipcode',
          command: '/bin/zsh',
          cpuPercent: 72.5,
          memoryBytes: 256 * 1024 * 1024,
          startedAt: 1,
          lastEventAt: 2,
        },
      ]),
    } as unknown as ProcessManager;
    const queries = {
      settings: { get: vi.fn(() => DEFAULT_SETTINGS) },
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'project-1',
          title: 'Run all tests',
          status: 'testing',
        })),
      },
      projects: {
        getById: vi.fn(() => ({
          id: 'project-1',
          name: 'ShipCode',
        })),
      },
    } as unknown as Queries;
    const pipeline = {
      listActive: vi.fn(() => [
        {
          threadId: 'thread-1',
          projectId: 'project-1',
          projectPath: '/tmp/shipcode',
          worktreePath: '/tmp/shipcode-wt',
          phase: 'testing',
          startedAt: Date.now(),
          activeProcessId: 'proc-1',
        },
      ]),
    } as unknown as Pipeline;

    const snapshot = await new ResourceMonitor(processManager, queries, pipeline).getSnapshot();

    expect(snapshot.highCpu).toBe(true);
    expect(snapshot.tasks[0]).toMatchObject({
      processId: 'proc-1',
      projectName: 'ShipCode',
      threadTitle: 'Run all tests',
      phase: 'testing',
      cpuPercent: 72.5,
      highCpu: true,
    });
  });

  it('blocks CPU-gated tasks when sampled system CPU reaches the configured threshold', () => {
    vi.spyOn(os, 'cpus')
      .mockReturnValueOnce(makeCpuSnapshot(100, 200))
      .mockReturnValueOnce(makeCpuSnapshot(120, 400));
    const processManager = {
      listResourceUsage: vi.fn(async () => []),
    } as unknown as ProcessManager;
    const queries = {
      settings: {
        get: vi.fn(() => ({
          ...DEFAULT_SETTINGS,
          cpuThrottleThresholdPercent: 85,
        })),
      },
    } as unknown as Queries;
    const pipeline = { listActive: vi.fn(() => []) } as unknown as Pipeline;

    const decision = new ResourceMonitor(processManager, queries, pipeline).canStartCpuTask();

    expect(decision).toEqual({
      allowed: false,
      reason: 'System CPU is 90% (threshold 85%)',
      cpuPercent: 90,
      thresholdPercent: 85,
    });
  });

  it('allows CPU-gated tasks when sampled system CPU is below the configured threshold', () => {
    vi.spyOn(os, 'cpus')
      .mockReturnValueOnce(makeCpuSnapshot(100, 200))
      .mockReturnValueOnce(makeCpuSnapshot(190, 400));
    const processManager = {
      listResourceUsage: vi.fn(async () => []),
    } as unknown as ProcessManager;
    const queries = {
      settings: {
        get: vi.fn(() => ({
          ...DEFAULT_SETTINGS,
          cpuThrottleThresholdPercent: 85,
        })),
      },
    } as unknown as Queries;
    const pipeline = { listActive: vi.fn(() => []) } as unknown as Pipeline;

    const decision = new ResourceMonitor(processManager, queries, pipeline).canStartCpuTask();

    expect(decision).toEqual({
      allowed: true,
      cpuPercent: 55,
      thresholdPercent: 85,
    });
  });

  it('reuses the last CPU sample when the OS counter delta is not positive', () => {
    vi.spyOn(os, 'cpus')
      .mockReturnValueOnce(makeCpuSnapshot(100, 200))
      .mockReturnValueOnce(makeCpuSnapshot(150, 300))
      .mockReturnValueOnce(makeCpuSnapshot(150, 300));
    const processManager = {
      listResourceUsage: vi.fn(async () => []),
    } as unknown as ProcessManager;
    const queries = {
      settings: { get: vi.fn(() => DEFAULT_SETTINGS) },
    } as unknown as Queries;
    const pipeline = { listActive: vi.fn(() => []) } as unknown as Pipeline;
    const monitor = new ResourceMonitor(processManager, queries, pipeline);

    expect(monitor.sampleSystemCpuPercent()).toBe(50);
    expect(monitor.sampleSystemCpuPercent()).toBe(50);
  });

  it('uses fallback task metadata and default CPU threshold in snapshots', async () => {
    vi.spyOn(os, 'cpus')
      .mockReturnValueOnce(makeCpuSnapshot(100, 200))
      .mockReturnValueOnce(makeCpuSnapshot(110, 400))
      .mockReturnValueOnce(makeCpuSnapshot(110, 400));
    const processManager = {
      listResourceUsage: vi.fn(async () => [
        {
          processId: 'proc-thread',
          type: 'claude',
          state: 'running',
          pid: 1234,
          childPids: [],
          threadId: 'thread-1',
          cwd: '/tmp/shipcode',
          command: 'claude',
          cpuPercent: 10,
          memoryBytes: 128,
          startedAt: 1,
          lastEventAt: 2,
        },
        {
          processId: 'proc-orphan',
          type: 'shell',
          state: 'running',
          pid: 4321,
          childPids: [],
          threadId: null,
          cwd: '/tmp',
          command: 'zsh',
          cpuPercent: 5,
          memoryBytes: 64,
          startedAt: 3,
          lastEventAt: 4,
        },
      ]),
    } as unknown as ProcessManager;
    const queries = {
      settings: { get: vi.fn(() => ({ ...DEFAULT_SETTINGS, cpuThrottleThresholdPercent: null })) },
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'missing-project',
          title: 'Detached project task',
          status: 'executing',
        })),
      },
      projects: { getById: vi.fn(() => null) },
    } as unknown as Queries;
    const pipeline = { listActive: vi.fn(() => []) } as unknown as Pipeline;

    const monitor = new ResourceMonitor(processManager, queries, pipeline);
    expect(monitor.canStartCpuTask()).toEqual({
      allowed: false,
      reason: 'System CPU is 95% (threshold 85%)',
      cpuPercent: 95,
      thresholdPercent: 85,
    });

    const snapshot = await monitor.getSnapshot();

    expect(snapshot.highCpu).toBe(true);
    expect(snapshot.cpuPercent).toBe(95);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        processId: 'proc-thread',
        projectId: 'missing-project',
        projectName: null,
        threadTitle: 'Detached project task',
        phase: 'executing',
        highCpu: false,
      }),
      expect.objectContaining({
        processId: 'proc-orphan',
        projectId: null,
        projectName: null,
        threadTitle: null,
        phase: null,
        highCpu: false,
      }),
    ]);
  });
});
