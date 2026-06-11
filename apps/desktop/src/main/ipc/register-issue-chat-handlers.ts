import { startIssueChatCommentSync, stopIssueChatCommentSync } from '../issue-chat-comment-sync';
import {
  getIssueChatSessionMetadata,
  sendIssueChatTurn,
  startIssueChatSession,
  stopIssueChatSession,
} from '../issue-chat-session';
import type { IpcHandlerDeps } from './types';

export function registerIssueChatHandlers({
  ipcMain,
  mainWindow,
  processManager,
  queries,
}: IpcHandlerDeps): void {
  ipcMain.handle('issue-chat:get-session', (_event, { threadId }: { threadId: string }) =>
    getIssueChatSessionMetadata({ threadId, queries }),
  );

  ipcMain.handle('issue-chat:start', async (_event, args) => {
    const result = await startIssueChatSession({ args, queries });
    startIssueChatCommentSync({
      threadId: result.threadId,
      queries,
      processManager,
      mainWindow,
    });
    return result;
  });

  ipcMain.handle('issue-chat:turn', (_event, args) =>
    sendIssueChatTurn({ args, queries, processManager, mainWindow }),
  );

  ipcMain.handle('issue-chat:stop', (_event, { threadId }: { threadId: string }) => {
    stopIssueChatCommentSync(threadId);
    return stopIssueChatSession({ threadId, queries, processManager, mainWindow });
  });
}
