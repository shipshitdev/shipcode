import type { BrowserWindow, IpcMain } from 'electron';
import type { PlanQueries, ThreadQueries } from '@shipcode/db';
import { StreamParser } from '@shipcode/agents';
import type { ShipCodePlan } from '@shipcode/shared';
import { PipelineScheduler } from '../pipeline-scheduler';

interface Queries {
  threads: ThreadQueries;
  plans: PlanQueries;
}

function tryParsePlan(rawOutput: string): ShipCodePlan | null {
  if (!rawOutput) return null;
  const parser = new StreamParser();
  parser.feed(rawOutput);
  const result = parser.extractPlan();
  return result.success ? result.data : null;
}

export function registerPipelineHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  queries: Queries,
  scheduler: PipelineScheduler,
): void {
  ipcMain.removeHandler('pipeline:approve');
  ipcMain.handle('pipeline:approve', async (_event, { threadId }: { threadId: string }) => {
    const latestPlan = queries.plans.getLatest(threadId);
    const structured = latestPlan?.structured ?? tryParsePlan(latestPlan?.rawOutput ?? '');
    if (!structured) {
      mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'failed' });
      return;
    }

    if (structured && latestPlan && !latestPlan.structured) {
      queries.plans.updateStructured(latestPlan.id, structured);
    }
    if (latestPlan) {
      queries.plans.updateStatus(latestPlan.id, 'approved');
    }

    const result = await scheduler.startApprovedExecution(threadId, structured);
    if (!result.started) {
      const error = result.error ?? 'Cannot start execution';
      queries.threads.updateStatus(threadId, 'awaiting_approval', error);
      throw new Error(error);
    }
  });
}
