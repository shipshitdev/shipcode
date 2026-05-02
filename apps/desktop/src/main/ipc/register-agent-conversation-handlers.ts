import type { IpcHandlerDeps } from './types';

export function registerAgentConversationHandlers({ ipcMain, queries }: IpcHandlerDeps): void {
  ipcMain.handle(
    'agent-conversations:list-by-thread',
    (_event, args: { threadId: string; phase?: string; role?: 'prompt' | 'response' }) => {
      return queries.agentConversations.listByThread(args.threadId, {
        phase: args.phase,
        role: args.role,
      });
    },
  );
}
