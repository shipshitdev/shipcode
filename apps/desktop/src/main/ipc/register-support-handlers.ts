import fs from 'node:fs/promises';
import path from 'node:path';
import type { TerminalEvent } from '@shipcode/agents';
import {
  ClaudeNormalizer,
  CodexNormalizer,
  checkGhAuth,
  checkSystemHealthWithAuth,
  enhancePrdDraft,
  formatAutomationPrompt,
  generateMemoryFiles,
  inspectRepoMemory,
  readMemoryFile,
} from '@shipcode/agents';
import {
  type AgentType,
  clampError,
  type ExecutorModel,
  formatClockTime,
  type GeneratorCli,
  providerDisplay,
  type ReasoningEffort,
} from '@shipcode/shared';
import log, { logProcessOutput } from '../logger.service';
import { assertPrdRewriteModelSupported, resolvePrdRewriteContext } from './helpers';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  removePrdAttachment,
  stagePrdAttachments,
} from './prd-attachments';
import type { IpcHandlerDeps } from './types';

function supportHandlerError(err: unknown, fallback: string): string {
  if (err instanceof Error || typeof err === 'string') return clampError(err);
  return fallback;
}

export function registerSupportHandlers({
  ipcMain,
  mainWindow,
  queries,
  processManager,
  notificationService,
}: IpcHandlerDeps): void {
  ipcMain.handle('notification:list', () => {
    return notificationService.listActive();
  });

  ipcMain.handle('notification:dismiss', (_event, { id }: { id: string }) => {
    notificationService.dismiss(id);
  });

  ipcMain.handle('notification:dismiss-all', () => {
    notificationService.dismissAll();
  });

  ipcMain.handle('onboarding:check-auth', async () => {
    const [health, ghAuth] = await Promise.all([checkSystemHealthWithAuth(), checkGhAuth()]);
    return { ...health, ghAuth };
  });

  ipcMain.handle(
    'ai:enhance-prd',
    async (
      _event,
      {
        projectId,
        draftBody,
        attachmentSessionId,
      }: { projectId: string; draftBody: string; attachmentSessionId: string | null },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      if (attachmentSessionId) {
        throw new Error(
          'PRD enhancement with image attachments is not yet supported. Remove attachments before enhancing.',
        );
      }

      const settings = queries.settings.get();
      const rewriteContext = resolvePrdRewriteContext(settings);
      await assertPrdRewriteModelSupported(
        rewriteContext.cli,
        rewriteContext.modelId,
        rewriteContext.reasoningEffort,
      );

      const skillPath = path.join(project.path, 'skills', 'writing-prds', 'SKILL.md');
      let skillContent: string;
      try {
        skillContent = await fs.readFile(skillPath, 'utf-8');
      } catch {
        skillContent =
          "You are drafting a PRD that will be consumed by the ShipCode pipeline's planner agent. " +
          'The PRD lives in a GitHub issue body. Required sections: Executive Summary, Problem Statement, ' +
          'Goals, Non-Goals, User Stories, System Specification, Functional Requirements, ' +
          'Non-Functional Requirements, Feature Phase Breakdown, Success Criteria, Out of Scope, ' +
          'Dependencies, Verification Plan, Risks & Open Questions. Feature Phase Breakdown must contain exactly three ordered phases.';
      }

      try {
        return await enhancePrdDraft({
          draftBody: draftBody ?? '',
          skillContent,
          cwd: project.path,
          ...rewriteContext,
        });
      } catch (err) {
        log.error('[ai:enhance-prd]', err);
        throw new Error(supportHandlerError(err, 'Enhancement failed'));
      }
    },
  );

  ipcMain.handle(
    'ai:format-automation',
    async (
      _event,
      {
        projectId,
        prompt,
        provider,
        modelId,
        reasoningEffort,
      }: {
        projectId: string;
        prompt: string;
        provider?: AgentType | null;
        modelId?: string | null;
        reasoningEffort?: ReasoningEffort | null;
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const settings = queries.settings.get();
      const selectedProvider =
        provider === 'claude' || provider === 'codex' || provider === 'openrouter'
          ? provider
          : settings.prdRewriteCli;
      const selectedReasoningEffort =
        reasoningEffort ??
        (selectedProvider === 'openrouter'
          ? settings.executorReasoningEffort
          : settings.prdRewriteReasoningEffort);
      const selectedModelId =
        modelId?.trim() ||
        (selectedProvider === 'claude'
          ? settings.prdRewriteClaudeModel
          : selectedProvider === 'codex'
            ? settings.prdRewriteCodexModel
            : settings.openrouterDefaultPaidModel);

      if (selectedProvider !== 'openrouter') {
        await assertPrdRewriteModelSupported(
          selectedProvider,
          selectedModelId,
          selectedReasoningEffort,
        );
      }

      try {
        return await formatAutomationPrompt({
          rawPrompt: prompt ?? '',
          cwd: project.path,
          provider: selectedProvider,
          modelId: selectedModelId,
          reasoningEffort: selectedReasoningEffort,
          openRouterApiKey: process.env.OPENROUTER_API_KEY,
        });
      } catch (err) {
        log.error('[ai:format-automation]', err);
        throw new Error(supportHandlerError(err, 'Automation formatting failed'));
      }
    },
  );

  ipcMain.handle(
    'prd-attachments:create-session',
    async (_event, { senderId, projectId }: { senderId: string; projectId: string }) => {
      try {
        const sessionId = await createPrdAttachmentSession(senderId, projectId);
        return { sessionId };
      } catch (err) {
        log.error('[prd-attachments:create-session]', err);
        throw new Error(supportHandlerError(err, 'Could not start attachment session'));
      }
    },
  );

  ipcMain.handle(
    'prd-attachments:stage',
    async (_event, { sessionId, filePaths }: { sessionId: string; filePaths: string[] }) => {
      try {
        return await stagePrdAttachments(sessionId, filePaths);
      } catch (err) {
        log.error('[prd-attachments:stage]', err);
        throw new Error(supportHandlerError(err, 'Could not stage attachments'));
      }
    },
  );

  ipcMain.handle(
    'prd-attachments:remove',
    async (_event, { sessionId, filePath }: { sessionId: string; filePath: string }) => {
      try {
        await removePrdAttachment(sessionId, filePath);
      } catch (err) {
        log.error('[prd-attachments:remove]', err);
        throw new Error(supportHandlerError(err, 'Could not remove attachment'));
      }
    },
  );

  ipcMain.handle('prd-attachments:clear', async (_event, { sessionId }: { sessionId: string }) => {
    await clearPrdAttachmentSession(sessionId);
  });

  ipcMain.handle('memory:list', (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return inspectRepoMemory(project.path);
  });

  ipcMain.handle(
    'memory:generate',
    async (_event, { projectId, cli }: { projectId: string; cli: GeneratorCli }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      try {
        const result = await generateMemoryFiles(project.path, cli);
        return { success: result.success, error: result.error };
      } catch (err) {
        log.error('[memory:generate]', err);
        return { success: false, error: supportHandlerError(err, 'Generation failed') };
      }
    },
  );

  ipcMain.handle(
    'memory:read',
    (_event, { projectId, name }: { projectId: string; name: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      return { content: readMemoryFile(project.path, name) };
    },
  );

  const normalizers = new Map<string, ClaudeNormalizer | CodexNormalizer>();

  function emitTerminalEvent(threadId: string, event: TerminalEvent) {
    const record = queries.terminalEvents.create(threadId, event);
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    try {
      mainWindow.webContents.send('terminal:event', record);
    } catch {
      // webContents destroyed between check and send
    }
  }

  function ensureNormalizer(processId: string, type: string, threadId: string) {
    if (normalizers.has(processId)) return;
    const onEvent = (event: TerminalEvent) => emitTerminalEvent(threadId, event);
    if (type === 'claude') {
      normalizers.set(processId, new ClaudeNormalizer(onEvent));
    } else if (type === 'codex') {
      normalizers.set(processId, new CodexNormalizer(onEvent));
    }
  }

  processManager.on('output', (processId: string, data: string) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    const proc = processManager.get(processId);

    if (proc?.threadId) {
      if (proc.outputMode === 'raw') {
        if (proc.type === 'claude' || proc.type === 'codex') {
          ensureNormalizer(processId, proc.type, proc.threadId);
          normalizers.get(processId)?.feed(data);
        } else {
          emitTerminalEvent(proc.threadId, { kind: 'raw', content: data });
        }
      } else {
        ensureNormalizer(processId, proc.type, proc.threadId);
        const normalizer = normalizers.get(processId);
        normalizer?.feed(data);
      }
    }

    logProcessOutput(proc?.type ?? 'unknown', data);

    try {
      mainWindow.webContents.send('agent:output', {
        processId,
        chunk: data,
        threadId: proc?.threadId,
      });
    } catch {
      // webContents destroyed between check and send
    }
  });

  processManager.on('stateChange', (processId: string, type: string, state: string) => {
    if (state === 'exited') {
      normalizers.delete(processId);
    }
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    const proc = processManager.get(processId);
    const exitSuffix =
      state === 'exited' && proc?.exitCode != null ? ` (code ${proc.exitCode})` : '';
    if (state === 'running' || state === 'exited') {
      log.info(`[process:${type}] ${processId} → ${state}${exitSuffix}`);
    }
    try {
      mainWindow.webContents.send('agent:state', {
        processId,
        type,
        state,
        threadId: proc?.threadId,
      });
    } catch {
      // webContents destroyed between check and send
    }

    if ((state === 'running' || state === 'exited') && proc?.threadId) {
      const ts = formatClockTime(new Date());
      const agentColor =
        type === 'claude'
          ? '\x1b[36m'
          : type === 'codex'
            ? '\x1b[33m'
            : type === 'gemini'
              ? '\x1b[32m'
              : type === 'cursor'
                ? '\x1b[34m'
                : '\x1b[35m';
      const exitColor = state === 'exited' ? '\x1b[2m' : '';
      const typeLabel =
        type === 'claude' ||
        type === 'codex' ||
        type === 'gemini' ||
        type === 'cursor' ||
        type === 'openrouter'
          ? `${providerDisplay(type as ExecutorModel)}${type === 'openrouter' ? '' : ' CLI'}`
          : type;
      emitTerminalEvent(proc.threadId, {
        kind: 'lifecycle',
        message: `\x1b[2m[${ts}]\x1b[0m ${exitColor}${agentColor}${typeLabel}\x1b[0m${exitColor} process ${state === 'running' ? 'started' : 'exited'}${exitSuffix}\x1b[0m`,
      });
    }
  });
}
