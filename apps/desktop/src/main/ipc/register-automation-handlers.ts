import {
  type CreateAutomationInput,
  clampError,
  type UpdateAutomationInput,
} from '@shipcode/shared';
import { Cron } from 'croner';
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
  ipcMain.handle('automations:list-all', async () => {
    try {
      return queries.automations.listAll();
    } catch (err) {
      log.error('[automations:list-all]', err);
      throw new Error(clampError(err));
    }
  });

  ipcMain.handle('automations:list', async (_e, { projectId }: { projectId: string }) => {
    try {
      return queries.automations.list(projectId);
    } catch (err) {
      log.error('[automations:list]', err);
      throw new Error(clampError(err));
    }
  });

  ipcMain.handle('automations:get', async (_e, { id }: { id: string }) => {
    try {
      return queries.automations.getById(id);
    } catch (err) {
      log.error('[automations:get]', err);
      throw new Error(clampError(err));
    }
  });

  ipcMain.handle('automations:create', async (_e, input: CreateAutomationInput) => {
    try {
      validateCron(input.cronExpr);
      const automation = queries.automations.create(input);
      automationScheduler.schedule(automation);
      return automation;
    } catch (err) {
      log.error('[automations:create]', err);
      throw new Error(clampError(err));
    }
  });

  ipcMain.handle(
    'automations:update',
    async (_e, payload: { id: string } & UpdateAutomationInput) => {
      try {
        const { id, ...patch } = payload;
        if (patch.cronExpr !== undefined) validateCron(patch.cronExpr);
        const automation = queries.automations.update(id, patch);
        automationScheduler.schedule(automation);
        return automation;
      } catch (err) {
        log.error('[automations:update]', err);
        throw new Error(clampError(err));
      }
    },
  );

  ipcMain.handle('automations:delete', async (_e, { id }: { id: string }) => {
    try {
      automationScheduler.unschedule(id);
      queries.automations.delete(id);
      return undefined;
    } catch (err) {
      log.error('[automations:delete]', err);
      throw new Error(clampError(err));
    }
  });

  ipcMain.handle(
    'automations:set-enabled',
    async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
      try {
        const automation = queries.automations.setEnabled(id, enabled);
        if (enabled) {
          automationScheduler.schedule(automation);
        } else {
          automationScheduler.unschedule(id);
          queries.automations.setNextRunAt(id, null);
        }
        return automation;
      } catch (err) {
        log.error('[automations:set-enabled]', err);
        throw new Error(clampError(err));
      }
    },
  );

  ipcMain.handle('automations:run-now', async (_e, { id }: { id: string }) => {
    try {
      const automation = queries.automations.getById(id);
      if (!automation) throw new Error(`Automation ${id} not found`);
      // fireNow routes through pipelineScheduler so capacity caps still apply.
      // We deliberately don't await the full pipeline run — only the
      // start-or-queue decision — so the IPC call returns promptly.
      void automationScheduler.fireNow(id).catch((err) => {
        log.error(`[automations:run-now] fire failed for ${id}:`, err);
      });
      return { queued: false };
    } catch (err) {
      log.error('[automations:run-now]', err);
      throw new Error(clampError(err));
    }
  });
}
