import {
  type CreateAutomationInput,
  clampError,
  type UpdateAutomationInput,
} from '@shipcode/shared';
import { Cron } from 'croner';
import type { IpcMainInvokeEvent } from 'electron';
import type { AutomationSchedulerLike } from '../automation-scheduler';
import log from '../logger.service';
import type { IpcHandlerDeps } from './types';

function validateCron(expr: string): void {
  // `paused: true` makes croner validate the expression without scheduling it.
  // Throws on invalid input — caller wraps in try/catch + clampError.
  new Cron(expr, { paused: true });
}

export function registerAutomationHandlers(
  { ipcMain, queries }: IpcHandlerDeps,
  automationScheduler: AutomationSchedulerLike,
): void {
  const handleAutomation = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...(args as TArgs));
      } catch (err) {
        log.error(`[${channel}]`, err);
        throw new Error(clampError(err));
      }
    });
  };

  handleAutomation('automations:list-all', async () => {
    return queries.automations.listAll();
  });

  handleAutomation('automations:list', async (_e, { projectId }: { projectId: string }) => {
    return queries.automations.list(projectId);
  });

  handleAutomation('automations:get', async (_e, { id }: { id: string }) => {
    return queries.automations.getById(id);
  });

  handleAutomation('automations:create', async (_e, input: CreateAutomationInput) => {
    validateCron(input.cronExpr);
    const automation = queries.automations.create(input);
    automationScheduler.schedule(automation);
    return automation;
  });

  handleAutomation(
    'automations:update',
    async (_e, payload: { id: string } & UpdateAutomationInput) => {
      const { id, ...patch } = payload;
      if (patch.cronExpr !== undefined) validateCron(patch.cronExpr);
      const automation = queries.automations.update(id, patch);
      automationScheduler.schedule(automation);
      return automation;
    },
  );

  handleAutomation('automations:delete', async (_e, { id }: { id: string }) => {
    automationScheduler.unschedule(id);
    queries.automations.delete(id);
    return undefined;
  });

  handleAutomation(
    'automations:set-enabled',
    async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
      const automation = queries.automations.setEnabled(id, enabled);
      if (enabled) {
        automationScheduler.schedule(automation);
      } else {
        automationScheduler.unschedule(id);
        queries.automations.setNextRunAt(id, null);
      }
      return automation;
    },
  );

  handleAutomation('automations:run-now', async (_e, { id }: { id: string }) => {
    const automation = queries.automations.getById(id);
    if (!automation) throw new Error(`Automation ${id} not found`);
    // fireNow routes through pipelineScheduler so capacity caps still apply.
    // We deliberately don't await the full pipeline run — only the
    // start-or-queue decision — so the IPC call returns promptly.
    return automationScheduler.fireNow(id);
  });

  handleAutomation(
    'automations:run-history',
    async (_e, { automationId }: { automationId: string }) => {
      return queries.threads.listByAutomationId(automationId);
    },
  );
}
