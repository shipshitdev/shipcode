import os from 'node:os';
import type { ProcessManager } from '@shipcode/agents/source';
import type { CpuTaskGateDecision, Pipeline } from '@shipcode/pipeline';
import type { PipelinePhase, ProcessResourceTask, SystemResourceSnapshot } from '@shipcode/shared';
import type { Queries } from './ipc/types';

const HIGH_PROCESS_CPU_PERCENT = 50;

interface CpuTimes {
  idle: number;
  total: number;
}

function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}

function formatCpuPercent(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(1));
}

export class ResourceMonitor {
  private previousCpuTimes = readCpuTimes();
  private lastCpuPercent: number | null = null;

  constructor(
    private readonly processManager: ProcessManager,
    private readonly queries: Queries,
    private readonly pipeline: Pipeline,
  ) {}

  sampleSystemCpuPercent(): number | null {
    const current = readCpuTimes();
    const idleDelta = current.idle - this.previousCpuTimes.idle;
    const totalDelta = current.total - this.previousCpuTimes.total;
    this.previousCpuTimes = current;

    if (totalDelta <= 0) return this.lastCpuPercent;
    this.lastCpuPercent = formatCpuPercent((1 - idleDelta / totalDelta) * 100);
    return this.lastCpuPercent;
  }

  canStartCpuTask(): CpuTaskGateDecision {
    const settings = this.queries.settings.get();
    const cpuPercent = this.sampleSystemCpuPercent();
    const thresholdPercent = settings.cpuThrottleThresholdPercent ?? 85;

    if (cpuPercent != null && cpuPercent >= thresholdPercent) {
      return {
        allowed: false,
        reason: `System CPU is ${cpuPercent}% (threshold ${thresholdPercent}%)`,
        cpuPercent,
        thresholdPercent,
      };
    }

    return { allowed: true, cpuPercent, thresholdPercent };
  }

  async getSnapshot(): Promise<SystemResourceSnapshot> {
    const cpuPercent = this.sampleSystemCpuPercent();
    const settings = this.queries.settings.get();
    const activeByThread = new Map(this.pipeline.listActive().map((item) => [item.threadId, item]));
    const usages = await this.processManager.listResourceUsage();
    const tasks: ProcessResourceTask[] = usages.map((usage) => {
      const thread = usage.threadId ? this.queries.threads.getById(usage.threadId) : null;
      const project = thread ? this.queries.projects.getById(thread.projectId) : null;
      const active = usage.threadId ? activeByThread.get(usage.threadId) : null;
      const phase = (active?.phase ?? thread?.status ?? null) as PipelinePhase | null;

      return {
        processId: usage.processId,
        type: usage.type,
        state: usage.state,
        pid: usage.pid,
        childPids: usage.childPids,
        threadId: usage.threadId,
        projectId: project?.id ?? thread?.projectId ?? null,
        projectName: project?.name ?? null,
        threadTitle: thread?.title ?? null,
        phase,
        cwd: usage.cwd,
        command: usage.command,
        cpuPercent: usage.cpuPercent,
        memoryBytes: usage.memoryBytes,
        startedAt: usage.startedAt,
        lastEventAt: usage.lastEventAt,
        highCpu: usage.cpuPercent >= HIGH_PROCESS_CPU_PERCENT,
      };
    });

    return {
      capturedAt: new Date().toISOString(),
      cpuPercent,
      cpuCoreCount: os.cpus().length,
      highCpu:
        (cpuPercent != null && cpuPercent >= (settings.cpuThrottleThresholdPercent ?? 85)) ||
        tasks.some((task) => task.highCpu),
      tasks,
    };
  }
}
