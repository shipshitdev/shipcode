import { ensureIssueThread } from '../ensure-issue-thread';
import { startIssueChatCommentSync, stopIssueChatCommentSync } from '../issue-chat-comment-sync';
import {
  getIssueChatSessionMetadata,
  sendIssueChatTurn,
  startIssueChatSession,
  stopIssueChatSession,
} from '../issue-chat-session';
import { requireProject } from './lookups';
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
    let threadId = args.threadId;
    if (!threadId) {
      if (!args.projectId || args.issueNumber == null) {
        throw new Error('issue-chat:start requires threadId or projectId and issueNumber');
      }
      const project = requireProject(queries, args.projectId);
      const issue = queries.githubIssues.getByNumber(args.projectId, args.issueNumber);
      if (!issue) throw new Error(`Issue #${args.issueNumber} not found in cache`);
      const thread = await ensureIssueThread({ queries, project, issue });
      threadId = thread.id;
    }

    const result = await startIssueChatSession({
      args: {
        threadId,
        provider: args.provider,
        modelId: args.modelId,
        reasoningEffort: args.reasoningEffort,
      },
      queries,
    });
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
