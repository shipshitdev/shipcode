import type { IpcHandlerDeps } from './types';

export function registerFeatureQaHandlers({ ipcMain, queries }: IpcHandlerDeps): void {
  ipcMain.handle('feature-qa:list-by-thread', (_event, args: { threadId: string }) => {
    return queries.featureQaResults.listByThread(args.threadId);
  });

  ipcMain.handle('feature-qa:latest-by-feature', (_event, args: { featureId: string }) => {
    return queries.featureQaResults.latestByFeature(args.featureId);
  });
}
