import type { IpcMain } from 'electron';
import { PipelineScheduler } from '../pipeline-scheduler';

export function registerGitHubHandlers(ipcMain: IpcMain, scheduler: PipelineScheduler): void {
  ipcMain.removeHandler('github:start-issue');
  ipcMain.handle(
    'github:start-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      return scheduler.startGitHubIssue(projectId, issueNumber);
    },
  );
}
