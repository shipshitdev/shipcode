import type { ProcessManager } from '@shipcode/agents';
import type { GhSyncDeps, Pipeline, PipelineEmitter } from '@shipcode/pipeline';
import { clampError, PIPELINE_PHASE } from '@shipcode/shared';
import type { BrowserWindow, IpcMain } from 'electron';
import type { AutomationSchedulerLike } from './automation-scheduler';
import type { ChatNotificationService } from './chat-notification-service';
import { transitionThreadPhase } from './ipc/helpers';
import { validateIpcInvokeArgs } from './ipc/input-validation';
import { registerAgentConversationHandlers } from './ipc/register-agent-conversation-handlers';
import { registerAutomationHandlers } from './ipc/register-automation-handlers';
import { registerDeveloperHandlers } from './ipc/register-developer-handlers';
import { registerFeatureQaHandlers } from './ipc/register-feature-qa-handlers';
import { registerGitHubHandlers } from './ipc/register-github-handlers';
import { registerInstantHandlers } from './ipc/register-instant-handlers';
import { registerIssueChatHandlers } from './ipc/register-issue-chat-handlers';
import { registerIssueGraphHandlers } from './ipc/register-issue-graph-handlers';
import { registerIssueTerminalHandlers } from './ipc/register-issue-terminal-handlers';
import { registerPipelineHandlers } from './ipc/register-pipeline-handlers';
import { registerPullRequestHandlers } from './ipc/register-pr-handlers';
import { registerProjectHandlers } from './ipc/register-project-handlers';
import { registerQuickTaskHandlers } from './ipc/register-quick-task-handlers';
import { registerSkillsHandlers } from './ipc/register-skills-handlers';
import { registerSupportHandlers } from './ipc/register-support-handlers';
import type { Queries } from './ipc/types';
import log, { logEvent } from './logger.service';
import type { NotificationService } from './notification-service';
import type { ResourceMonitor } from './resource-monitor';
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
  resourceMonitor: ResourceMonitor,
  onProjectsChanged: () => void = () => {},
  ghSync?: GhSyncDeps,
): void {
  for (const thread of queries.threads.getOrphaned()) {
    transitionThreadPhase(
      mainWindow,
      queries,
      emitter,
      {
        threadId: thread.id,
        phase: PIPELINE_PHASE.failed,
        errorMessage: thread.lastError,
      },
      ghSync,
    );
    log.info(`[startup] reset orphaned thread ${thread.id} → failed`);
  }

  const deps = {
    ipcMain: (() => {
      const wrapped = Object.create(ipcMain) as IpcMain;
      wrapped.handle = ((channel, listener) =>
        ipcMain.handle(channel, async (event, ...args) => {
          const startedAt = Date.now();
          try {
            validateIpcInvokeArgs(String(channel), args);
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
            const message = clampError(error) || 'IPC request failed';
            console.error(`[ipc] ${String(channel)} failed`, error);
            captureIpcFailure(error, { channel: String(channel), elapsedMs });
            logEvent('ipc:handle', {
              channel,
              ok: false,
              elapsedMs,
              error: message,
            });
            throw new Error(message);
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
    resourceMonitor,
    automationScheduler,
    onProjectsChanged,
    ghSync,
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
  registerIssueChatHandlers(deps);
  registerIssueTerminalHandlers(deps);
  registerPullRequestHandlers(deps);
  registerAgentConversationHandlers(deps);
  registerFeatureQaHandlers(deps);
  registerAutomationHandlers(deps, automationScheduler);
  registerDeveloperHandlers(deps, updateService);
}
