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
  fireNow(id: string): Promise<void>;
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
  private inFlight = new Map<string, Promise<void>>();

  constructor(private readonly deps: AutomationSchedulerDeps) {}

  start(): void {
    const automations = this.deps.automations.listEnabled();
    for (const automation of automations) {
      this.schedule(automation);
    }

    const nowIso = new Date().toISOString();
    const due = this.deps.automations.listDue(nowIso);
    for (const automation of due) {
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

  async fireNow(id: string): Promise<void> {
    await this._fire(id);
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  private _fire(automationId: string): Promise<void> {
    const existing = this.inFlight.get(automationId);
    if (existing) return existing;

    const promise = this.deps.pipelineScheduler
      .startOrQueueAutomation(automationId)
      .then(() => undefined)
      .finally(() => {
        this.inFlight.delete(automationId);
        const job = this.jobs.get(automationId);
        const next = job?.nextRun() ?? null;
        this.deps.automations.setNextRunAt(automationId, next ? next.toISOString() : null);
      });

    this.inFlight.set(automationId, promise);
    return promise;
  }
}
