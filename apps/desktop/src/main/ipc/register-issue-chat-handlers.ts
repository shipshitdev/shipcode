import {
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
  ipcMain.handle('issue-chat:start', (_event, args) => startIssueChatSession({ args, queries }));

  ipcMain.handle('issue-chat:turn', (_event, args) =>
    sendIssueChatTurn({ args, queries, processManager, mainWindow }),
  );

  ipcMain.handle('issue-chat:stop', (_event, { threadId }: { threadId: string }) =>
    stopIssueChatSession({ threadId, queries, processManager, mainWindow }),
  );
}
