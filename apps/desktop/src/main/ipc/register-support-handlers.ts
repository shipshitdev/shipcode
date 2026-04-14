import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TerminalEvent } from '@shipcode/agents';
import {
  ClaudeNormalizer,
  CodexNormalizer,
  checkGhAuth,
  checkSystemHealthWithAuth,
  enhancePrdDraft,
  generateContextFiles,
  listContextFiles,
  readContextFile,
} from '@shipcode/agents';
import log, { logProcessOutput } from '../logger.service';
import type { IpcHandlerDeps } from './types';

const execAsync = promisify(exec);

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

  ipcMain.handle('onboarding:list-repos', async () => {
    try {
      const { stdout } = await execAsync(
        "gh api 'user/repos?per_page=100&affiliation=owner,collaborator,organization_member' --paginate --jq '.[] | [.full_name, (.private | tostring)] | join(\":\")'",
        { timeout: 20_000 },
      );

      const seen = new Set<string>();
      const repos: { name: string; private: boolean }[] = [];
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const lastColon = line.lastIndexOf(':');
        const name = line.slice(0, lastColon);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        repos.push({ name, private: line.slice(lastColon + 1) === 'true' });
      }
      return repos.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'ai:enhance-prd',
    async (_event, { projectId, draftBody }: { projectId: string; draftBody: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const skillPath = path.join(project.path, '.agents', 'skills', 'writing-prds', 'SKILL.md');
      let skillContent: string;
      try {
        skillContent = fs.readFileSync(skillPath, 'utf-8');
      } catch {
        skillContent =
          "You are drafting a PRD that will be consumed by the ShipCode pipeline's planner agent. " +
          'The PRD lives in a GitHub issue body. Required sections: Executive Summary, Problem Statement, ' +
          'Goals, Non-Goals, User Stories, Functional Requirements, Non-Functional Requirements, ' +
          'Success Criteria, Out of Scope, Dependencies, Verification Plan, Risks & Open Questions.';
      }

      const settings = queries.settings.get();
      const plannerModel: 'claude' | 'codex' =
        settings.plannerModel === 'codex' ? 'codex' : 'claude';

      try {
        return await enhancePrdDraft({
          draftBody: draftBody ?? '',
          skillContent,
          plannerModel,
          cwd: project.path,
        });
      } catch (err) {
        log.error('[ai:enhance-prd]', err);
        const short =
          err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'Enhancement failed';
        throw new Error(short);
      }
    },
  );

  ipcMain.handle('context:list', (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return listContextFiles(project.path);
  });

  ipcMain.handle(
    'context:generate',
    async (_event, { projectId, cli }: { projectId: string; cli: 'claude' | 'codex' }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      try {
        const result = await generateContextFiles(project.path, cli);
        return { success: result.success, error: result.error };
      } catch (err) {
        log.error('[context:generate]', err);
        const short =
          err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'Generation failed';
        return { success: false, error: short };
      }
    },
  );

  ipcMain.handle(
    'context:read',
    (_event, { projectId, name }: { projectId: string; name: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      return { content: readContextFile(project.path, name) };
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
      ensureNormalizer(processId, proc.type, proc.threadId);
      const normalizer = normalizers.get(processId);
      normalizer?.feed(data);
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
    if (state === 'running' || state === 'exited') {
      log.info(`[process:${type}] ${processId} → ${state}`);
    }
    const proc = processManager.get(processId);
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
      const ts = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const agentColor =
        type === 'claude' ? '\x1b[36m' : type === 'codex' ? '\x1b[33m' : '\x1b[35m';
      const exitColor = state === 'exited' ? '\x1b[2m' : '';
      emitTerminalEvent(proc.threadId, {
        kind: 'lifecycle',
        message: `\x1b[2m[${ts}]\x1b[0m ${exitColor}${agentColor}${type}\x1b[0m${exitColor} process ${state === 'running' ? 'started' : 'exited'}\x1b[0m`,
      });
    }
  });
}
