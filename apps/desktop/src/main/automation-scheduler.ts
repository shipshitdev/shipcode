import type { AutomationQueries } from '@shipcode/db';
import type { Automation } from '@shipcode/shared';
import { Cron } from 'croner';
import log from './logger.service';
import type { PipelineScheduler } from './pipeline-scheduler';

export interface AutomationSchedulerLike {
  start(): void;
  stop(): void;
  schedule(automation: Automation): void;
  unschedule(id: string): void;
  fireNow(id: string): Promise<{ queued: boolean }>;
}

export interface AutomationSchedulerDeps {
  automations: AutomationQueries;
  pipelineScheduler: PipelineScheduler;
}

/**
 * Cron-driven launcher for persisted Automations.
 *
 * - On `start()`: schedules every enabled automation and skips any tick that
 *   would have fired while the app was closed (advances `next_run_at` to the
 *   next future occurrence without firing).
 * - In-flight guard: a single automation cannot have two concurrent runs.
 * - Capacity gate: routes every fire through `pipelineScheduler.startOrQueueAutomation`
 *   so the global `maxConcurrentPipelines` cap applies uniformly.
 */
export class AutomationScheduler implements AutomationSchedulerLike {
  private jobs = new Map<string, Cron>();
  // automationId -> (targetProjectId -> in-flight dispatch). Keyed per target so
  // a multi-repo automation can dispatch each repo independently while still
  // guarding against double-firing the same (automation, target) pair.
  private inFlight = new Map<string, Map<string, Promise<{ queued: boolean }>>>();

  constructor(private readonly deps: AutomationSchedulerDeps) {}

  start(): void {
    const nowIso = new Date().toISOString();
    const overdueAutomations = this.deps.automations.listDue(nowIso);
    const automations = this.deps.automations.listEnabled();

    for (const automation of automations) {
      this.schedule(automation);
    }

    for (const automation of overdueAutomations) {
      const job = this.jobs.get(automation.id);
      const next = job?.nextRun() ?? null;
      this.deps.automations.setNextRunAt(automation.id, next ? next.toISOString() : null);
      log.info(
        `[automation] skipping missed tick for ${automation.id} (${automation.name}); next at ${next?.toISOString() ?? 'none'}`,
      );
    }
  }

  schedule(automation: Automation): void {
    this.unschedule(automation.id);
    if (!automation.enabled) return;

    let job: Cron;
    try {
      job = new Cron(automation.cronExpr, { timezone: 'UTC' }, () => {
        this._fire(automation.id).catch((err) => {
          log.error(`[automation:${automation.id}] fire failed:`, err);
        });
      });
    } catch (err) {
      log.error(
        `[automation:${automation.id}] invalid cron expression "${automation.cronExpr}":`,
        err,
      );
      return;
    }

    this.jobs.set(automation.id, job);

    const next = job.nextRun();
    this.deps.automations.setNextRunAt(automation.id, next ? next.toISOString() : null);
  }

  unschedule(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  async fireNow(id: string): Promise<{ queued: boolean }> {
    return this._fire(id);
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  private _advanceNextRun(automationId: string): void {
    const job = this.jobs.get(automationId);
    const next = job?.nextRun() ?? null;
    this.deps.automations.setNextRunAt(automationId, next ? next.toISOString() : null);
  }

  private _fire(automationId: string): Promise<{ queued: boolean }> {
    const automation = this.deps.automations.getById(automationId);
    if (!automation?.enabled) {
      this._advanceNextRun(automationId);
      return Promise.resolve({ queued: false });
    }

    const targets = automation.targets.length > 0 ? automation.targets : [automation.projectId];
    const inner =
      this.inFlight.get(automationId) ?? new Map<string, Promise<{ queued: boolean }>>();
    this.inFlight.set(automationId, inner);

    const dispatched: Array<Promise<{ queued: boolean }>> = [];
    for (const projectId of targets) {
      if (inner.has(projectId)) continue; // per-target in-flight guard
      const promise = this.deps.pipelineScheduler
        .startOrQueueAutomation(automationId, projectId)
        .finally(() => {
          inner.delete(projectId);
          if (inner.size === 0) this.inFlight.delete(automationId);
        });
      inner.set(projectId, promise);
      dispatched.push(promise);
    }

    // Advance the cron cursor once targets are dispatched (not awaited), so the
    // missed-tick skip logic at startup sees the next future occurrence.
    this._advanceNextRun(automationId);

    if (dispatched.length === 0) return Promise.resolve({ queued: false });
    return Promise.all(dispatched).then((results) => ({
      queued: results.every((r) => r.queued),
    }));
  }
}
