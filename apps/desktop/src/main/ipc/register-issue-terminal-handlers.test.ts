import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockStartIssueTerminalSession,
  mockBuildIssueTerminalGithubComment,
  mockAddIssueComment,
  mockListIssueComments,
} = vi.hoisted(() => ({
  mockStartIssueTerminalSession: vi.fn(),
  mockBuildIssueTerminalGithubComment: vi.fn(),
  mockAddIssueComment: vi.fn(),
  mockListIssueComments: vi.fn(),
}));

vi.mock('../issue-terminal-session', () => ({
  startIssueTerminalSession: mockStartIssueTerminalSession,
  buildIssueTerminalGithubComment: mockBuildIssueTerminalGithubComment,
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    addIssueComment = mockAddIssueComment;
    listIssueComments = mockListIssueComments;
  },
}));

import { registerIssueTerminalHandlers } from './register-issue-terminal-handlers';

describe('registerIssueTerminalHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const queries = {
    threads: {
      getById: vi.fn(),
    },
    projects: {
      getById: vi.fn(),
    },
  };

  function getHandler(channel: string) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return handler;
  }

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mockStartIssueTerminalSession.mockResolvedValue({
      threadId: 'thread-1',
      processId: 'proc-1',
      worktreePath: '/tmp/worktree',
      promptArtifactPath: '/tmp/worktree/.shipcode/runs/thread-1/terminal-prompt.md',
    });
    mockBuildIssueTerminalGithubComment.mockReturnValue('preview body');
    mockAddIssueComment.mockResolvedValue(undefined);
    mockListIssueComments.mockResolvedValue([{ url: 'https://github.com/issue/1#comment-9' }]);
    queries.threads.getById.mockReturnValue({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 12,
    });
    queries.projects.getById.mockReturnValue({ id: 'project-1', path: '/tmp/project' });

    registerIssueTerminalHandlers({
      ipcMain,
      queries,
      processManager: {},
      mainWindow: {},
    } as never);
  });

  it('starts an issue terminal session through the shared helper', async () => {
    const args = { projectId: 'project-1', issueNumber: 12, provider: 'claude' };
    await expect(getHandler('issue-terminal:start')(undefined, args)).resolves.toMatchObject({
      threadId: 'thread-1',
      processId: 'proc-1',
    });
    expect(mockStartIssueTerminalSession).toHaveBeenCalledWith({
      args,
      queries,
      processManager: {},
      mainWindow: {},
    });
  });

  it('previews a GitHub comment from the latest session summary', () => {
    expect(
      getHandler('issue-terminal:github-comment-preview')(undefined, { threadId: 'thread-1' }),
    ).toEqual({ body: 'preview body' });
    expect(mockBuildIssueTerminalGithubComment).toHaveBeenCalledWith(queries, 'thread-1');
  });

  it('posts a GitHub comment and returns the latest comment URL', async () => {
    await expect(
      getHandler('issue-terminal:github-comment-post')(undefined, {
        threadId: 'thread-1',
        body: 'shipped',
      }),
    ).resolves.toEqual({ url: 'https://github.com/issue/1#comment-9' });
    expect(mockAddIssueComment).toHaveBeenCalledWith(12, 'shipped');
    expect(mockListIssueComments).toHaveBeenCalledWith(12);
  });

  it('returns a null URL when GitHub lists no comments after posting', async () => {
    mockListIssueComments.mockResolvedValueOnce([]);
    await expect(
      getHandler('issue-terminal:github-comment-post')(undefined, {
        threadId: 'thread-1',
        body: 'empty list',
      }),
    ).resolves.toEqual({ url: null });
  });

  it('rejects comment posts when the thread is not linked to an issue', async () => {
    queries.threads.getById.mockReturnValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: null,
    });

    await expect(
      getHandler('issue-terminal:github-comment-post')(undefined, {
        threadId: 'thread-1',
        body: 'no issue',
      }),
    ).rejects.toThrow('Thread thread-1 is not linked to an issue');
    expect(mockAddIssueComment).not.toHaveBeenCalled();
  });

  it('rejects comment posts when the thread is missing', async () => {
    queries.threads.getById.mockReturnValueOnce(null);
    await expect(
      getHandler('issue-terminal:github-comment-post')(undefined, {
        threadId: 'missing',
        body: 'gone',
      }),
    ).rejects.toThrow('Thread missing not found');
  });
});
