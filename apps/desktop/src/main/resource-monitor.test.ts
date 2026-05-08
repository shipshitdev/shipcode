import type { ProcessManager } from '@shipcode/agents/source';
import type { Pipeline } from '@shipcode/pipeline';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Queries } from './ipc/types';
import { ResourceMonitor } from './resource-monitor';

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
});
