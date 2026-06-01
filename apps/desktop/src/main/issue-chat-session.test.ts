import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  default: {
    error: vi.fn(),
  },
}));

import {
  sendIssueChatTurn,
  startIssueChatSession,
  stopIssueChatSessionIfLive,
} from './issue-chat-session';

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Issue chat',
    prompt: 'Original issue prompt',
    status: 'todo',
    kind: 'pipeline',
    worktreeBranch: 'shipcode/195-issue-chat',
    worktreePath: '/tmp/shipcode-worktree',
    githubIssueNumber: 195,
    ...overrides,
  };
}

function makeProject() {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    defaultBranch: 'develop',
    gitRemote: 'https://github.com/shipshitdev/shipcode.git',
    githubRepoFullName: 'shipshitdev/shipcode',
  };
}

function makeHarness() {
  const conversations: Array<Record<string, unknown>> = [];
  const terminalEvents: Array<Record<string, unknown>> = [];
  const emitter = new EventEmitter();
  const processManager = Object.assign(emitter, {
    spawnWithStdin: vi.fn(() => ({ id: 'proc-1' })),
    kill: vi.fn(),
  });
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };
  const queries = {
    projects: {
      getById: vi.fn(() => makeProject()),
    },
    threads: {
      getById: vi.fn(() => makeThread()),
      setWorktree: vi.fn(),
      addTokenUsage: vi.fn(),
    },
    githubIssues: {
      getByNumber: vi.fn(() => ({
        id: 'issue-195',
        issueNumber: 195,
        title: 'Issue-scoped resumable chat',
        body: 'Issue body',
      })),
    },
    settings: {
      get: vi.fn(() => ({ worktreeRoot: null, worktreeBranchFormat: null })),
    },
    agentConversations: {
      listByThread: vi.fn((_threadId: string, filters?: { role?: string }) =>
        conversations.filter((row) => !filters?.role || row.role === filters.role),
      ),
      insert: vi.fn((input: Record<string, unknown>) => {
        const row = { id: `conversation-${conversations.length + 1}`, ...input };
        conversations.push(row);
        return row;
      }),
    },
    terminalEvents: {
      create: vi.fn((threadId: string, event: Record<string, unknown>) => {
        const row = { id: `terminal-${terminalEvents.length + 1}`, threadId, event };
        terminalEvents.push(row);
        return row;
      }),
    },
  };

  return { conversations, mainWindow, processManager, queries, terminalEvents };
}

describe('issue chat session', () => {
  beforeEach(() => {
    stopIssueChatSessionIfLive('thread-1', { kill: vi.fn() } as never);
  });

  it('starts idempotently without spawning or inserting conversation rows', async () => {
    const h = makeHarness();

    await expect(
      startIssueChatSession({
        args: { threadId: 'thread-1', provider: 'claude', modelId: 'claude-sonnet-4-6' },
        queries: h.queries as never,
      }),
    ).resolves.toMatchObject({
      threadId: 'thread-1',
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
      worktreePath: '/tmp/shipcode-worktree',
      reattached: false,
      activeProcessId: null,
    });

    await expect(
      startIssueChatSession({
        args: { threadId: 'thread-1', provider: 'claude' },
        queries: h.queries as never,
      }),
    ).resolves.toMatchObject({ reattached: true });

    expect(h.processManager.spawnWithStdin).not.toHaveBeenCalled();
    expect(h.conversations).toEqual([]);
  });

  it('persists a prompt and response with usage for a successful turn', async () => {
    const h = makeHarness();
    await startIssueChatSession({
      args: { threadId: 'thread-1', provider: 'claude', modelId: 'claude-sonnet-4-6' },
      queries: h.queries as never,
    });

    const resultPromise = sendIssueChatTurn({
      args: { threadId: 'thread-1', text: 'Implement the backend' },
      queries: h.queries as never,
      processManager: h.processManager as never,
      mainWindow: h.mainWindow as never,
    });

    await new Promise((resolve) => setImmediate(resolve));
    h.processManager.emit(
      'output',
      'proc-1',
      `${JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6' } })}\n`,
    );
    h.processManager.emit(
      'output',
      'proc-1',
      `${JSON.stringify({
        type: 'result',
        result: 'Done.',
        usage: { input_tokens: 12, output_tokens: 5 },
        total_cost_usd: 0.01,
      })}\n`,
    );
    h.processManager.emit('exit', 'proc-1', 0);

    await expect(resultPromise).resolves.toMatchObject({
      promptId: 'conversation-1',
      responseId: 'conversation-2',
      round: 1,
      exitCode: 0,
      content: 'Done.',
    });
    expect(h.conversations).toMatchObject([
      {
        phase: 'issue_chat',
        round: 1,
        speaker: 'user',
        role: 'prompt',
        content: 'Implement the backend',
      },
      {
        phase: 'issue_chat',
        round: 1,
        speaker: 'claude',
        role: 'response',
        parentId: 'conversation-1',
        model: 'claude-sonnet-4-6',
        tokensIn: 12,
        tokensOut: 5,
        costUsd: 0.01,
        content: 'Done.',
      },
    ]);
    expect(h.queries.threads.addTokenUsage).toHaveBeenCalledWith('thread-1', 12, 5, 0.01);
    expect(h.terminalEvents.map((record) => record.event)).not.toContainEqual({
      kind: 'raw',
      content: expect.any(String),
    });
    expect(h.mainWindow.webContents.send).toHaveBeenCalledWith(
      'terminal:event',
      expect.objectContaining({ threadId: 'thread-1' }),
    );
  });

  it('persists a GitHub-sourced prompt speaker for synced issue comments', async () => {
    const h = makeHarness();
    await startIssueChatSession({
      args: { threadId: 'thread-1', provider: 'claude' },
      queries: h.queries as never,
    });

    const resultPromise = sendIssueChatTurn({
      args: {
        threadId: 'thread-1',
        text: 'GitHub issue comment from @octocat (untrusted user input):\n\nExplain this',
        speaker: 'github:octocat',
      },
      queries: h.queries as never,
      processManager: h.processManager as never,
      mainWindow: h.mainWindow as never,
    });

    await new Promise((resolve) => setImmediate(resolve));
    h.processManager.emit(
      'output',
      'proc-1',
      `${JSON.stringify({ type: 'result', result: 'Explained.' })}\n`,
    );
    h.processManager.emit('exit', 'proc-1', 0);

    await expect(resultPromise).resolves.toMatchObject({ content: 'Explained.' });
    expect(h.conversations.at(0)).toMatchObject({
      phase: 'issue_chat',
      speaker: 'github:octocat',
      role: 'prompt',
      content: 'GitHub issue comment from @octocat (untrusted user input):\n\nExplain this',
    });
  });

  it('persists a synthetic error response when a turn exits non-zero', async () => {
    const h = makeHarness();
    await startIssueChatSession({
      args: { threadId: 'thread-1', provider: 'codex', modelId: 'gpt-5.4' },
      queries: h.queries as never,
    });

    const resultPromise = sendIssueChatTurn({
      args: { threadId: 'thread-1', text: 'Try the change' },
      queries: h.queries as never,
      processManager: h.processManager as never,
      mainWindow: h.mainWindow as never,
    });

    await new Promise((resolve) => setImmediate(resolve));
    h.processManager.emit('output', 'proc-1', 'fatal: no auth\n');
    h.processManager.emit('exit', 'proc-1', 1);

    await expect(resultPromise).rejects.toThrow('codex exited with code 1');
    expect(h.conversations).toMatchObject([
      { phase: 'issue_chat', role: 'prompt', content: 'Try the change' },
      {
        phase: 'issue_chat',
        role: 'response',
        parentId: 'conversation-1',
        content: expect.stringContaining('[error] codex exited with code 1'),
      },
    ]);
  });
});
