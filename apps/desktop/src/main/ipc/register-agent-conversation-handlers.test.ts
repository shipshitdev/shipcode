import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAgentConversationHandlers } from './register-agent-conversation-handlers';

describe('registerAgentConversationHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const listByThread = vi.fn();

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    listByThread.mockReturnValue([{ id: 'conversation-1' }]);
  });

  it('registers the list-by-thread handler with phase and role filters', () => {
    registerAgentConversationHandlers({
      ipcMain,
      queries: {
        agentConversations: {
          listByThread,
        },
      },
    } as never);

    const handler = handlers.get('agent-conversations:list-by-thread');
    if (!handler) throw new Error('agent-conversations:list-by-thread handler missing');

    expect(handler(undefined, { threadId: 'thread-1', phase: 'plan', role: 'prompt' })).toEqual([
      { id: 'conversation-1' },
    ]);
    expect(listByThread).toHaveBeenCalledWith('thread-1', { phase: 'plan', role: 'prompt' });
  });
});
