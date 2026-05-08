import {
  inspectProjectSetup,
  type RunningServer,
  ServerLifecycleManager,
} from '@shipcode/agents/source';
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
  if (!proc || proc.state === 'exited') {
    manualQaServers.delete(threadId);
    return null;
  }

  return { baseUrl: session.server.baseUrl, port: session.server.port };
}

export function registerFeatureQaHandlers({
  ipcMain,
  processManager,
  queries,
}: IpcHandlerDeps): void {
  ipcMain.handle('feature-qa:list-by-thread', (_event, args: { threadId: string }) => {
    return queries.featureQaResults.listByThread(args.threadId);
  });

  ipcMain.handle('feature-qa:latest-by-feature', (_event, args: { featureId: string }) => {
    return queries.featureQaResults.latestByFeature(args.featureId);
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
}
