import type { ProcessManager } from '@shipcode/agents';
import type { Pipeline, PipelineEmitter } from '@shipcode/pipeline';
import type { BrowserWindow, IpcMain } from 'electron';
import { transitionThreadPhase } from './ipc/helpers';
import { registerGitHubHandlers } from './ipc/register-github-handlers';
import { registerPipelineHandlers } from './ipc/register-pipeline-handlers';
import { registerProjectHandlers } from './ipc/register-project-handlers';
import { registerSkillsHandlers } from './ipc/register-skills-handlers';
import { registerSupportHandlers } from './ipc/register-support-handlers';
import type { Queries } from './ipc/types';
import log, { logEvent } from './logger.service';
import type { NotificationService } from './notification-service';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  queries: Queries,
  processManager: ProcessManager,
  pipeline: Pipeline,
  emitter: PipelineEmitter,
  notificationService: NotificationService,
): void {
  for (const thread of queries.threads.getOrphaned()) {
    transitionThreadPhase(mainWindow, queries, emitter, {
      threadId: thread.id,
      phase: 'failed',
      errorMessage: thread.lastError,
    });
    log.info(`[startup] reset orphaned thread ${thread.id} → failed`);
  }

  const deps = {
    ipcMain: (() => {
      const wrapped = Object.create(ipcMain) as IpcMain;
      wrapped.handle = ((channel, listener) =>
        ipcMain.handle(channel, async (event, ...args) => {
          const startedAt = Date.now();
          try {
            const result = await listener(event, ...args);
            const elapsedMs = Date.now() - startedAt;
            logEvent('ipc:handle', {
              channel,
              ok: true,
              elapsedMs,
            });
            if (elapsedMs >= 150) {
              log.info(`[ipc] ${channel} completed in ${elapsedMs}ms`);
            }
            return result;
          } catch (error) {
            const elapsedMs = Date.now() - startedAt;
            const message = error instanceof Error ? error.message : String(error);
            logEvent('ipc:handle', {
              channel,
              ok: false,
              elapsedMs,
              error: message,
            });
            throw error;
          }
        })) as IpcMain['handle'];
      return wrapped;
    })(),
    mainWindow,
    queries,
    processManager,
    pipeline,
    emitter,
    notificationService,
  } as const;

  ipcMain.on('diagnostics:renderer-ipc', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    logEvent('ipc:renderer', payload as Record<string, unknown>);
  });

  registerProjectHandlers(deps);
  registerGitHubHandlers(deps);
  registerPipelineHandlers(deps);
  registerSkillsHandlers(deps);
  registerSupportHandlers(deps);
}
