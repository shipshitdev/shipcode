import type { ProcessManager } from '@shipcode/agents/source';
import type { Pipeline, PipelineEmitter } from '@shipcode/pipeline';
import { PIPELINE_PHASE } from '@shipcode/shared';
import type { BrowserWindow, IpcMain } from 'electron';
import type { AutomationSchedulerLike } from './automation-scheduler';
import type { ChatNotificationService } from './chat-notification-service';
import { transitionThreadPhase } from './ipc/helpers';
import { registerAgentConversationHandlers } from './ipc/register-agent-conversation-handlers';
import { registerAutomationHandlers } from './ipc/register-automation-handlers';
import { registerDeveloperHandlers } from './ipc/register-developer-handlers';
import { registerGitHubHandlers } from './ipc/register-github-handlers';
import { registerInstantHandlers } from './ipc/register-instant-handlers';
import { registerIssueGraphHandlers } from './ipc/register-issue-graph-handlers';
import { registerPipelineHandlers } from './ipc/register-pipeline-handlers';
import { registerPullRequestHandlers } from './ipc/register-pr-handlers';
import { registerProjectHandlers } from './ipc/register-project-handlers';
import { registerQuickTaskHandlers } from './ipc/register-quick-task-handlers';
import { registerSkillsHandlers } from './ipc/register-skills-handlers';
import { registerSupportHandlers } from './ipc/register-support-handlers';
import type { Queries } from './ipc/types';
import log, { logEvent } from './logger.service';
import type { NotificationService } from './notification-service';
import { captureIpcFailure } from './telemetry';
import type { UpdateService } from './update-service';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  queries: Queries,
  processManager: ProcessManager,
  pipeline: Pipeline,
  emitter: PipelineEmitter,
  notificationService: NotificationService,
  chatNotificationService: ChatNotificationService,
  updateService: UpdateService,
  automationScheduler: AutomationSchedulerLike,
): void {
  for (const thread of queries.threads.getOrphaned()) {
    transitionThreadPhase(mainWindow, queries, emitter, {
      threadId: thread.id,
      phase: PIPELINE_PHASE.failed,
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
            captureIpcFailure(error, { channel: String(channel), elapsedMs });
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
    chatNotificationService,
  } as const;

  ipcMain.on('diagnostics:renderer-ipc', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    logEvent('ipc:renderer', payload as Record<string, unknown>);
  });

  registerProjectHandlers(deps);
  registerGitHubHandlers(deps);
  registerIssueGraphHandlers(deps);
  registerPipelineHandlers(deps);
  registerQuickTaskHandlers(deps);
  registerSkillsHandlers(deps);
  registerSupportHandlers(deps);
  registerInstantHandlers(deps);
  registerPullRequestHandlers(deps);
  registerAgentConversationHandlers(deps);
  registerAutomationHandlers(deps, automationScheduler);
  registerDeveloperHandlers(deps, updateService);
}
