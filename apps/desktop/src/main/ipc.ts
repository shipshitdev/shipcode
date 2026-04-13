import type { ProcessManager } from '@shipcode/agents';
import type { Pipeline } from '@shipcode/pipeline';
import type { BrowserWindow, IpcMain } from 'electron';
import { registerGitHubHandlers } from './ipc/register-github-handlers';
import { registerPipelineHandlers } from './ipc/register-pipeline-handlers';
import { registerProjectHandlers } from './ipc/register-project-handlers';
import { registerSkillsHandlers } from './ipc/register-skills-handlers';
import { registerSupportHandlers } from './ipc/register-support-handlers';
import type { Queries } from './ipc/types';
import log from './logger.service';
import type { NotificationService } from './notification-service';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  queries: Queries,
  processManager: ProcessManager,
  pipeline: Pipeline,
  notificationService: NotificationService,
): void {
  for (const thread of queries.threads.getOrphaned()) {
    queries.threads.updateStatus(thread.id, 'failed');
    const issue = queries.githubIssues.getByThreadId(thread.id);
    if (issue) queries.githubIssues.updatePipelineStatus(issue.id, 'failed');
    log.info(`[startup] reset orphaned thread ${thread.id} → failed`);
  }

  const deps = {
    ipcMain,
    mainWindow,
    queries,
    processManager,
    pipeline,
    notificationService,
  } as const;

  registerProjectHandlers(deps);
  registerGitHubHandlers(deps);
  registerPipelineHandlers(deps);
  registerSkillsHandlers(deps);
  registerSupportHandlers(deps);
}
