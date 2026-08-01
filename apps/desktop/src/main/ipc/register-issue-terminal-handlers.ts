import { GhCli } from '@shipcode/agents';
import {
  buildIssueTerminalGithubComment,
  startIssueTerminalSession,
  summarizeIssueTerminalSession,
} from '../issue-terminal-session';
import { requireProject, requireThread } from './lookups';
import type { IpcHandlerDeps } from './types';

export function registerIssueTerminalHandlers({
  ipcMain,
  mainWindow,
  processManager,
  queries,
}: IpcHandlerDeps): void {
  ipcMain.handle('issue-terminal:start', (_event, args) =>
    startIssueTerminalSession({ args, queries, processManager, mainWindow }),
  );

  ipcMain.handle('issue-terminal:summarize', (_event, { threadId }: { threadId: string }) =>
    summarizeIssueTerminalSession(queries, threadId),
  );

  ipcMain.handle(
    'issue-terminal:github-comment-preview',
    (_event, { threadId }: { threadId: string }) => ({
      body: buildIssueTerminalGithubComment(queries, threadId),
    }),
  );

  ipcMain.handle(
    'issue-terminal:github-comment-post',
    async (_event, { threadId, body }: { threadId: string; body: string }) => {
      const thread = requireThread(queries, threadId);
      if (!thread.githubIssueNumber)
        throw new Error(`Thread ${threadId} is not linked to an issue`);
      const project = requireProject(queries, thread.projectId);
      const gh = new GhCli(project.path);
      await gh.addIssueComment(thread.githubIssueNumber, body);
      const comments = await gh.listIssueComments(thread.githubIssueNumber);
      return { url: comments.at(-1)?.url ?? null };
    },
  );
}
