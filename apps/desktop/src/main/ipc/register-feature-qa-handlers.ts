import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { inspectProjectSetup, type RunningServer, ServerLifecycleManager } from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import { shell } from 'electron';
import type { IpcHandlerDeps } from './types';

interface ManualQaServerSession {
  lifecycle: ServerLifecycleManager;
  server: RunningServer;
}

const manualQaServers = new Map<string, ManualQaServerSession>();

function getLiveManualQaServer(
  threadId: string,
  processManager: IpcHandlerDeps['processManager'],
): { baseUrl: string; port: number } | null {
  const session = manualQaServers.get(threadId);
  if (!session) return null;

  const proc = processManager.get(session.server.processId);
  // `terminating` means the server was already signalled — it may still be
  // holding the port, but it is no longer a server we can hand to the user.
  if (!proc || proc.state === 'exited' || proc.state === 'terminating') {
    manualQaServers.delete(threadId);
    return null;
  }

  return { baseUrl: session.server.baseUrl, port: session.server.port };
}

function evidencePathsForThread(queries: IpcHandlerDeps['queries'], threadId: string): Set<string> {
  const paths = new Set<string>();
  for (const result of queries.featureQaResults.listByThread(threadId)) {
    for (const evidencePath of result.evidencePaths ?? []) {
      paths.add(path.resolve(evidencePath));
    }
    for (const flow of result.flowResults) {
      for (const evidencePath of flow.evidencePaths ?? []) {
        paths.add(path.resolve(evidencePath));
      }
      for (const assertion of flow.assertions ?? []) {
        if (assertion.evidencePath) paths.add(path.resolve(assertion.evidencePath));
      }
    }
  }
  return paths;
}

export function registerFeatureQaHandlers({
  ipcMain,
  processManager,
  queries,
}: IpcHandlerDeps): void {
  ipcMain.handle('feature-qa:list-by-thread', (_event, args: { threadId: string }) => {
    return queries.featureQaResults.listByThread(args.threadId);
  });

  ipcMain.handle('feature-qa:get-server', (_event, { threadId }: { threadId: string }) => {
    return getLiveManualQaServer(threadId, processManager);
  });

  ipcMain.handle(
    'feature-qa:start-server',
    async (_event, { projectId, threadId }: { projectId: string; threadId: string }) => {
      const existing = getLiveManualQaServer(threadId, processManager);
      if (existing) return existing;

      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const thread = queries.threads.getById(threadId);
      if (!thread || thread.projectId !== projectId) {
        throw new Error(`Thread ${threadId} not found for project ${projectId}`);
      }
      if (!thread.worktreePath) {
        throw new Error('Thread has no worktree for manual QA');
      }
      if (!thread.worktreeBranch) {
        throw new Error('Thread has no worktree branch for manual QA');
      }
      const settings = queries.settings.get();
      const worktreeManager = new WorktreeManager(project.path, {
        worktreeRoot: settings.worktreeRoot,
        branchFormat: settings.worktreeBranchFormat,
      });
      await worktreeManager.assertRegistered(thread.worktreePath, thread.worktreeBranch);

      const setup = inspectProjectSetup(project.path);
      const serverConfig = setup?.contract?.runtimeQa?.server;
      if (!serverConfig) {
        throw new Error('Configure a Runtime QA start command in Project Settings > Setup first');
      }

      const lifecycle = new ServerLifecycleManager(processManager, (message) => {
        console.info(`[manual-qa:${threadId}] ${message.trimEnd()}`);
      });
      const abort = new AbortController();
      const server = await lifecycle.start(
        serverConfig,
        thread.worktreePath,
        abort.signal,
        threadId,
        { workspaceRoot: settings.worktreeRoot, projectPath: project.path },
      );
      manualQaServers.set(threadId, { lifecycle, server });
      return { baseUrl: server.baseUrl, port: server.port };
    },
  );

  ipcMain.handle('feature-qa:stop-server', async (_event, { threadId }: { threadId: string }) => {
    const session = manualQaServers.get(threadId);
    if (!session) return;
    manualQaServers.delete(threadId);
    await session.lifecycle.stop(session.server);
  });

  ipcMain.handle(
    'feature-qa:open-evidence',
    async (_event, { threadId, path: rawPath }: { threadId: string; path: string }) => {
      const requestedPath = path.resolve(rawPath);
      if (!evidencePathsForThread(queries, threadId).has(requestedPath)) {
        throw new Error('Evidence path is not attached to this thread.');
      }
      if (!existsSync(requestedPath)) {
        throw new Error(`Evidence path no longer exists: ${requestedPath}`);
      }

      const targetPath = statSync(requestedPath).isDirectory()
        ? requestedPath
        : path.dirname(requestedPath);
      const openError = await shell.openPath(targetPath);
      if (openError) throw new Error(openError);
    },
  );
}
