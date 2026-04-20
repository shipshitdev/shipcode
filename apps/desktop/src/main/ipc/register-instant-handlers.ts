import os from 'node:os';
import {
  type InstantFixScope,
  type ReasoningEffort,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import log from '../logger.service';
import { getPrdAttachmentSessionSummary } from './prd-attachments';
import type { IpcHandlerDeps } from './types';

type InstantCli = 'claude' | 'codex';
type RunningInstantSession = {
  cli: InstantCli;
  mode: 'run' | 'shell';
  processId: string;
};

/** threadId → process metadata mapping for cancel/input/resize support. */
const runningInstants = new Map<string, RunningInstantSession>();

function formatInstantCliLabel(cli: InstantCli): string {
  return cli === 'claude' ? 'Claude' : 'Codex';
}

function buildAttachmentContext(attachmentSessionId?: string): string {
  if (!attachmentSessionId) return '';
  const session = getPrdAttachmentSessionSummary(attachmentSessionId);
  if (!session || session.attachments.length === 0) return '';
  const paths = session.attachments.map((attachment) => attachment.stagedPath);
  return `\n\nScreenshot files available at:\n${paths.join('\n')}\nUse the Read tool to view them.`;
}

function buildClaudeShellEffort(
  reasoningEffort: ReasoningEffort | undefined,
  modelId?: string | null,
): 'medium' | 'high' | null {
  switch (resolveProviderReasoningEffort('claude', reasoningEffort ?? 'high', modelId).effective) {
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return null;
  }
}

function buildClaudeShellArgs(args: {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
  initialPrompt?: string | null;
}): string[] {
  const effort = buildClaudeShellEffort(args.reasoningEffort, args.modelId);
  return [
    ...(args.modelId ? ['--model', args.modelId] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(args.initialPrompt ? [args.initialPrompt] : []),
  ];
}

function buildCodexShellArgs(args: {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
  initialPrompt?: string | null;
}): string[] {
  const effort = resolveProviderReasoningEffort(
    'codex',
    args.reasoningEffort ?? 'high',
    args.modelId,
  ).effective;
  return [
    ...(args.modelId ? ['-m', args.modelId] : []),
    '-c',
    `model_reasoning_effort=${effort}`,
    '--sandbox',
    'workspace-write',
    ...(args.initialPrompt ? [args.initialPrompt] : []),
  ];
}

function registerExitTracking(
  processManager: IpcHandlerDeps['processManager'],
  queries: IpcHandlerDeps['queries'],
  threadId: string,
  processId: string,
  cli: InstantCli,
  mode: 'run' | 'shell',
) {
  const exitHandler = (exitedProcessId: string, exitCode: number) => {
    if (exitedProcessId !== processId) return;
    processManager.removeListener('exit', exitHandler);
    runningInstants.delete(threadId);
    queries.threads.updateStatus(
      threadId,
      exitCode === 0 ? 'completed' : 'failed',
      exitCode === 0 ? undefined : `Process exited with code ${exitCode}`,
    );
    log.info(`[instant] ${mode} thread ${threadId} (${cli}) exited with code ${exitCode}`);
  };
  processManager.on('exit', exitHandler);
}

export function registerInstantHandlers({
  ipcMain,
  queries,
  processManager,
}: IpcHandlerDeps): void {
  // --- Startup cleanup: delete instant threads older than 7 days ---
  const deleted = queries.threads.deleteOlderThan('instant', 7);
  if (deleted > 0) {
    log.info(`[instant] cleaned up ${deleted} instant threads older than 7 days`);
  }

  // --- Ensure the hidden __instant__ project exists ---
  queries.projects.getOrCreateInstantProject(os.homedir());

  // --- instant:run ---
  ipcMain.handle(
    'instant:run',
    (
      _event,
      args: {
        projectId?: string;
        prompt: string;
        scope: InstantFixScope;
        cli: 'claude' | 'codex';
        modelId?: string | null;
        reasoningEffort?: ReasoningEffort;
        attachmentSessionId?: string;
        customSystemPrompt?: string;
      },
    ) => {
      // 1. Resolve cwd and projectId
      let cwd: string;
      let projectId: string;

      if (args.scope === 'user') {
        cwd = os.homedir();
        const instantProject = queries.projects.getOrCreateInstantProject(os.homedir());
        projectId = instantProject.id;
      } else {
        if (!args.projectId) throw new Error('projectId is required for project/custom scope');
        const project = queries.projects.getById(args.projectId);
        if (!project) throw new Error(`Project not found: ${args.projectId}`);
        cwd = project.path;
        projectId = project.id;
      }

      // 2. Build prompt
      let fullPrompt = args.prompt;
      if (args.scope === 'custom' && args.customSystemPrompt) {
        fullPrompt = `${args.customSystemPrompt}\n\n${args.prompt}`;
      }

      // 3. Resolve attachments
      fullPrompt += buildAttachmentContext(args.attachmentSessionId);

      // 4. Create thread
      const title = args.prompt.slice(0, 60);
      const thread = queries.threads.create(projectId, fullPrompt, title, 'instant');

      // 5. Build CLI args
      let cliArgs: string[];
      if (args.cli === 'claude') {
        const effectiveEffort = resolveProviderReasoningEffort(
          'claude',
          args.reasoningEffort ?? 'high',
          args.modelId,
        ).effective;
        const thinkingArgs =
          effectiveEffort === 'medium'
            ? ['--max-thinking-tokens', '8000']
            : effectiveEffort === 'high'
              ? ['--max-thinking-tokens', '32000']
              : [];
        if (args.scope === 'user') {
          // Read-only mode for user scope — no write access to $HOME
          cliArgs = [
            '-p',
            fullPrompt,
            ...(args.modelId ? ['--model', args.modelId] : []),
            '--allowedTools',
            'Read,Glob,Grep',
            ...thinkingArgs,
          ];
        } else {
          cliArgs = [
            '-p',
            fullPrompt,
            ...(args.modelId ? ['--model', args.modelId] : []),
            '--allowedTools',
            'Edit,Write,Bash,Glob,Grep,Read',
            '--dangerously-skip-permissions',
            ...thinkingArgs,
          ];
        }
      } else {
        // Codex
        const sandbox = args.scope === 'user' ? 'read-only' : 'workspace-write';
        const effectiveEffort = resolveProviderReasoningEffort(
          'codex',
          args.reasoningEffort ?? 'high',
          args.modelId,
        ).effective;
        cliArgs = [
          ...(args.modelId ? ['-m', args.modelId] : []),
          '-c',
          `model_reasoning_effort=${effectiveEffort}`,
          'exec',
          fullPrompt,
          '--sandbox',
          sandbox,
          '--json',
        ];
      }

      // 6. Spawn process
      const proc = processManager.spawn(args.cli, args.cli, cliArgs, cwd, thread.id);
      runningInstants.set(thread.id, {
        processId: proc.id,
        cli: args.cli,
        mode: 'run',
      });

      log.info(
        `[instant] started ${args.cli} run for thread ${thread.id} (scope=${args.scope}, cwd=${cwd})`,
      );

      // 7. Listen for exit to update thread status and clean up map
      registerExitTracking(processManager, queries, thread.id, proc.id, args.cli, 'run');

      return { threadId: thread.id };
    },
  );

  ipcMain.handle(
    'instant:shell-start',
    (
      _event,
      args: {
        projectId: string;
        cli: InstantCli;
        modelId?: string | null;
        reasoningEffort?: ReasoningEffort;
        initialPrompt?: string;
        attachmentSessionId?: string;
      },
    ) => {
      const project = queries.projects.getById(args.projectId);
      if (!project) throw new Error(`Project not found: ${args.projectId}`);

      const initialPrompt = `${args.initialPrompt?.trim() ?? ''}${buildAttachmentContext(
        args.attachmentSessionId,
      )}`.trim();
      const title = initialPrompt
        ? initialPrompt.slice(0, 60)
        : `${formatInstantCliLabel(args.cli)} shell`;
      const thread = queries.threads.create(project.id, initialPrompt, title, 'instant');

      const cliArgs =
        args.cli === 'claude'
          ? buildClaudeShellArgs({
              modelId: args.modelId,
              reasoningEffort: args.reasoningEffort,
              initialPrompt: initialPrompt || null,
            })
          : buildCodexShellArgs({
              modelId: args.modelId,
              reasoningEffort: args.reasoningEffort,
              initialPrompt: initialPrompt || null,
            });

      const proc = processManager.spawn(args.cli, args.cli, cliArgs, project.path, thread.id, {
        outputMode: 'raw',
      });

      runningInstants.set(thread.id, {
        processId: proc.id,
        cli: args.cli,
        mode: 'shell',
      });

      log.info(`[instant] started ${args.cli} shell for thread ${thread.id} (cwd=${project.path})`);

      registerExitTracking(processManager, queries, thread.id, proc.id, args.cli, 'shell');

      return { threadId: thread.id };
    },
  );

  ipcMain.handle(
    'instant:shell-input',
    (_event, { threadId, data }: { threadId: string; data: string }) => {
      const session = runningInstants.get(threadId);
      if (!session || session.mode !== 'shell') return;
      processManager.write(session.processId, data);
    },
  );

  ipcMain.handle(
    'instant:shell-resize',
    (_event, { threadId, cols, rows }: { threadId: string; cols: number; rows: number }) => {
      const session = runningInstants.get(threadId);
      if (!session || session.mode !== 'shell') return;
      const safeCols = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 1;
      const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 1;
      processManager.resize(session.processId, safeCols, safeRows);
    },
  );

  // --- instant:cancel ---
  ipcMain.handle('instant:cancel', (_event, { threadId }: { threadId: string }) => {
    const session = runningInstants.get(threadId);
    if (session) {
      processManager.kill(session.processId);
      runningInstants.delete(threadId);
      queries.threads.updateStatus(threadId, 'failed', 'Cancelled by user');
      log.info(`[instant] cancelled ${session.mode} thread ${threadId}`);
    }
  });

  // --- instant:list ---
  ipcMain.handle('instant:list', () => {
    return queries.threads.listInstant();
  });

  // --- instant:cleanup ---
  ipcMain.handle('instant:cleanup', () => {
    const count = queries.threads.deleteOlderThan('instant', 7);
    return { deleted: count };
  });
}
