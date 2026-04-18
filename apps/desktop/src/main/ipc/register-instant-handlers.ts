import os from 'node:os';
import type { InstantFixScope } from '@shipcode/shared';
import log from '../logger.service';
import { getPrdAttachmentSessionSummary } from './prd-attachments';
import type { IpcHandlerDeps } from './types';

/** threadId → processId mapping for cancel support. */
const runningInstants = new Map<string, string>();

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
      if (args.attachmentSessionId) {
        const session = getPrdAttachmentSessionSummary(args.attachmentSessionId);
        if (session && session.attachments.length > 0) {
          const paths = session.attachments.map((a) => a.stagedPath);
          fullPrompt += `\n\nScreenshot files available at:\n${paths.join('\n')}\nUse the Read tool to view them.`;
        }
      }

      // 4. Create thread
      const title = args.prompt.slice(0, 60);
      const thread = queries.threads.create(projectId, fullPrompt, title, 'instant');

      // 5. Build CLI args
      let cliArgs: string[];
      if (args.cli === 'claude') {
        if (args.scope === 'user') {
          // Read-only mode for user scope — no write access to $HOME
          cliArgs = ['-p', fullPrompt, '--allowedTools', 'Read,Glob,Grep'];
        } else {
          cliArgs = [
            '-p',
            fullPrompt,
            '--allowedTools',
            'Edit,Write,Bash,Glob,Grep,Read',
            '--dangerously-skip-permissions',
          ];
        }
      } else {
        // Codex
        const sandbox = args.scope === 'user' ? 'read-only' : 'workspace-write';
        cliArgs = ['exec', fullPrompt, '--sandbox', sandbox, '--json'];
      }

      // 6. Spawn process
      const proc = processManager.spawn(args.cli, args.cli, cliArgs, cwd, thread.id);
      runningInstants.set(thread.id, proc.id);

      log.info(
        `[instant] started ${args.cli} run for thread ${thread.id} (scope=${args.scope}, cwd=${cwd})`,
      );

      // 7. Listen for exit to update thread status and clean up map
      const exitHandler = (processId: string, exitCode: number) => {
        if (processId !== proc.id) return;
        processManager.removeListener('exit', exitHandler);
        runningInstants.delete(thread.id);
        queries.threads.updateStatus(
          thread.id,
          exitCode === 0 ? 'completed' : 'failed',
          exitCode === 0 ? undefined : `Process exited with code ${exitCode}`,
        );
        log.info(`[instant] thread ${thread.id} exited with code ${exitCode}`);
      };
      processManager.on('exit', exitHandler);

      return { threadId: thread.id };
    },
  );

  // --- instant:cancel ---
  ipcMain.handle('instant:cancel', (_event, { threadId }: { threadId: string }) => {
    const processId = runningInstants.get(threadId);
    if (processId) {
      processManager.kill(processId);
      runningInstants.delete(threadId);
      queries.threads.updateStatus(threadId, 'failed', 'Cancelled by user');
      log.info(`[instant] cancelled thread ${threadId}`);
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
