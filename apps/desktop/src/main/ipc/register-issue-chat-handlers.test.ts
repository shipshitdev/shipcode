import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetIssueChatSessionMetadata,
  mockStartIssueChatSession,
  mockSendIssueChatTurn,
  mockStopIssueChatSession,
  mockStartIssueChatCommentSync,
  mockStopIssueChatCommentSync,
} = vi.hoisted(() => ({
  mockGetIssueChatSessionMetadata: vi.fn(),
  mockStartIssueChatSession: vi.fn(),
  mockSendIssueChatTurn: vi.fn(),
  mockStopIssueChatSession: vi.fn(),
  mockStartIssueChatCommentSync: vi.fn(),
  mockStopIssueChatCommentSync: vi.fn(),
}));

vi.mock('../issue-chat-comment-sync', () => ({
  startIssueChatCommentSync: mockStartIssueChatCommentSync,
  stopIssueChatCommentSync: mockStopIssueChatCommentSync,
}));

vi.mock('../issue-chat-session', () => ({
  getIssueChatSessionMetadata: mockGetIssueChatSessionMetadata,
  sendIssueChatTurn: mockSendIssueChatTurn,
  startIssueChatSession: mockStartIssueChatSession,
  stopIssueChatSession: mockStopIssueChatSession,
}));

import { registerIssueChatHandlers } from './register-issue-chat-handlers';

describe('registerIssueChatHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;
  const deps = {
    ipcMain,
    queries: { threads: {} },
    processManager: { kill: vi.fn() },
    mainWindow: { webContents: { send: vi.fn() } },
  };

  function getHandler(channel: string) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return handler;
  }

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mockGetIssueChatSessionMetadata.mockReturnValue({ threadId: 'thread-1', provider: 'claude' });
    mockStartIssueChatSession.mockResolvedValue({ threadId: 'thread-1', provider: 'claude' });
    mockSendIssueChatTurn.mockResolvedValue({ threadId: 'thread-1', content: 'ok' });
    mockStopIssueChatSession.mockReturnValue({ threadId: 'thread-1', stopped: true });
    registerIssueChatHandlers(deps as never);
  });

  it('returns persisted session metadata', () => {
    expect(getHandler('issue-chat:get-session')(undefined, { threadId: 'thread-1' })).toEqual({
      threadId: 'thread-1',
      provider: 'claude',
    });
    expect(mockGetIssueChatSessionMetadata).toHaveBeenCalledWith({
      threadId: 'thread-1',
      queries: deps.queries,
    });
  });

  it('starts a session and begins comment sync', async () => {
    const args = { threadId: 'thread-1', provider: 'claude' };
    await expect(getHandler('issue-chat:start')(undefined, args)).resolves.toEqual({
      threadId: 'thread-1',
      provider: 'claude',
    });
    expect(mockStartIssueChatSession).toHaveBeenCalledWith({
      args,
      queries: deps.queries,
    });
    expect(mockStartIssueChatCommentSync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      queries: deps.queries,
      processManager: deps.processManager,
      mainWindow: deps.mainWindow,
    });
  });

  it('forwards a chat turn', async () => {
    const args = { threadId: 'thread-1', text: 'hello' };
    await expect(getHandler('issue-chat:turn')(undefined, args)).resolves.toEqual({
      threadId: 'thread-1',
      content: 'ok',
    });
    expect(mockSendIssueChatTurn).toHaveBeenCalledWith({
      args,
      queries: deps.queries,
      processManager: deps.processManager,
      mainWindow: deps.mainWindow,
    });
  });

  it('stops comment sync and the live session together', () => {
    expect(getHandler('issue-chat:stop')(undefined, { threadId: 'thread-1' })).toEqual({
      threadId: 'thread-1',
      stopped: true,
    });
    expect(mockStopIssueChatCommentSync).toHaveBeenCalledWith('thread-1');
    expect(mockStopIssueChatSession).toHaveBeenCalledWith({
      threadId: 'thread-1',
      queries: deps.queries,
      processManager: deps.processManager,
      mainWindow: deps.mainWindow,
    });
  });
});
