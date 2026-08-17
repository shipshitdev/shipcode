import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssertRegistered = vi.hoisted(() => vi.fn(async () => undefined));
const mockCreateWorktree = vi.hoisted(() =>
  vi.fn(async () => ({
    branch: 'shipcode/12-issue-terminal',
    worktreePath: '/tmp/created-worktree',
  })),
);

vi.mock('@shipcode/git', () => ({
  WorktreeManager: class {
    assertRegistered = mockAssertRegistered;
    create = mockCreateWorktree;
  },
}));

import {
  buildIssueTerminalGithubComment,
  startIssueTerminalSession,
} from './issue-terminal-session';
import { unregisterInteractiveTerminalSession } from './terminal-session-registry';

function makeProject() {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    defaultBranch: 'master',
    gitRemote: 'https://github.com/shipshitdev/shipcode.git',
    githubRepoFullName: 'shipshitdev/shipcode',
  };
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-12',
    issueNumber: 12,
    title: 'Cover issue terminal',
    body: 'Issue body',
    labels: ['bug'],
    threadId: 'thread-1',
    ...overrides,
  };
}

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Cover issue terminal',
    prompt: 'Issue body',
    status: 'todo',
    kind: 'pipeline',
    worktreeBranch: 'shipcode/12-issue-terminal',
    worktreePath: '',
    githubIssueNumber: 12,
    ...overrides,
  };
}

async function makeHarness(overrides: { worktreePath?: string } = {}) {
  const worktreePath =
    overrides.worktreePath ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'sc-term-')));
  const conversations: Array<Record<string, unknown>> = [];
  const terminalEvents: Array<Record<string, unknown>> = [];
  let thread = makeThread({ worktreePath });
  const emitter = new EventEmitter();
  const processManager = Object.assign(emitter, {
    spawn: vi.fn(() => ({ id: 'proc-1' })),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  });
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  };
  const queries = {
    projects: {
      getById: vi.fn(() => makeProject()),
    },
    githubIssues: {
      getByNumber: vi.fn(() => makeIssue()),
      linkThread: vi.fn(),
    },
    threads: {
      getById: vi.fn(() => thread),
      getByProjectAndGithubIssue: vi.fn(() => thread),
      create: vi.fn(() => thread),
      updateIssueContent: vi.fn(),
      setGithubIssue: vi.fn(),
      setWorktree: vi.fn((id: string, branch: string, nextPath: string) => {
        thread = { ...thread, id, worktreeBranch: branch, worktreePath: nextPath };
        return thread;
      }),
      updateStatus: vi.fn((id: string, status: string, lastError?: string) => {
        thread = { ...thread, id, status, lastError: lastError ?? null };
        return thread;
      }),
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

  return {
    conversations,
    mainWindow,
    processManager,
    queries,
    terminalEvents,
    worktreePath,
    getThread: () => thread,
    setThread: (next: Record<string, unknown>) => {
      thread = { ...thread, ...next };
    },
  };
}

describe('issue terminal session', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    mockAssertRegistered.mockClear();
    mockCreateWorktree.mockClear();
    unregisterInteractiveTerminalSession('thread-1');
  });

  afterEach(async () => {
    unregisterInteractiveTerminalSession('thread-1');
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function harness() {
    const h = await makeHarness();
    tempDirs.push(h.worktreePath);
    return h;
  }

  it('rejects missing projects and uncached issues', async () => {
    const h = await harness();
    h.queries.projects.getById.mockReturnValueOnce(null);
    await expect(
      startIssueTerminalSession({
        args: { projectId: 'missing', issueNumber: 12, provider: 'claude' },
        queries: h.queries as never,
        processManager: h.processManager as never,
        mainWindow: h.mainWindow as never,
      }),
    ).rejects.toThrow('Project not found: missing');

    h.queries.githubIssues.getByNumber.mockReturnValueOnce(null);
    await expect(
      startIssueTerminalSession({
        args: { projectId: 'project-1', issueNumber: 99, provider: 'claude' },
        queries: h.queries as never,
        processManager: h.processManager as never,
        mainWindow: h.mainWindow as never,
      }),
    ).rejects.toThrow('GitHub issue #99 is not cached for this project');
  });

  it('creates a worktree when the linked thread has none, then starts Claude', async () => {
    const createdPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-term-created-'));
    tempDirs.push(createdPath);
    mockCreateWorktree.mockResolvedValueOnce({
      branch: 'shipcode/12-issue-terminal',
      worktreePath: createdPath,
    });
    const h = await harness();
    h.setThread({ worktreePath: null, worktreeBranch: null, threadId: null });
    h.queries.githubIssues.getByNumber.mockReturnValueOnce(
      makeIssue({ threadId: null, labels: [], body: '   ' }),
    );
    h.queries.threads.getById.mockImplementation(() => h.getThread());
    h.queries.threads.getByProjectAndGithubIssue.mockReturnValueOnce(null);
    h.queries.threads.create.mockReturnValueOnce(
      makeThread({ worktreePath: null, worktreeBranch: null }),
    );

    const result = await startIssueTerminalSession({
      args: {
        projectId: 'project-1',
        issueNumber: 12,
        provider: 'claude',
        modelId: 'claude-sonnet-4-6',
      },
      queries: h.queries as never,
      processManager: h.processManager as never,
      mainWindow: h.mainWindow as never,
    });

    expect(result).toMatchObject({
      threadId: 'thread-1',
      processId: 'proc-1',
      worktreePath: createdPath,
    });
    expect(mockCreateWorktree).toHaveBeenCalledWith(12, 'Cover issue terminal', 'master');
    expect(h.processManager.spawn).toHaveBeenCalledWith(
      'claude',
      'claude',
      expect.arrayContaining(['--permission-mode', 'acceptEdits', '--model', 'claude-sonnet-4-6']),
      createdPath,
      'thread-1',
      expect.objectContaining({ outputMode: 'raw', projectPath: '/tmp/shipcode' }),
    );
    const prompt = await fs.readFile(result.promptArtifactPath, 'utf8');
    expect(prompt).toContain('Labels: (none)');
    expect(prompt).toContain('(empty issue body)');
    expect(prompt).toContain('Issue Terminal Session');
  });

  it('starts a Codex session, forwards output, and imports a written summary on success', async () => {
    const h = await harness();
    const result = await startIssueTerminalSession({
      args: {
        projectId: 'project-1',
        issueNumber: 12,
        provider: 'codex',
        modelId: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      queries: h.queries as never,
      processManager: h.processManager as never,
      mainWindow: h.mainWindow as never,
    });

    expect(h.processManager.spawn).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining(['-s', 'workspace-write', '-m', 'gpt-5.4', '-c']),
      h.worktreePath,
      'thread-1',
      expect.objectContaining({ outputMode: 'raw' }),
    );
    expect(h.queries.threads.updateStatus).toHaveBeenCalledWith('thread-1', 'executing');

    const summaryPath = path.join(
      h.worktreePath,
      '.shipcode',
      'runs',
      'thread-1',
      'session-summary.md',
    );
    await fs.writeFile(summaryPath, '  Session finished cleanly.  \n', 'utf8');

    h.processManager.emit('output', 'other-proc', 'ignored');
    h.processManager.emit('output', 'proc-1', 'codex> working');
    expect(h.terminalEvents.map((row) => row.event)).toContainEqual({
      kind: 'raw',
      content: 'codex> working',
    });

    h.processManager.emit('exit', 'other-proc', 1);
    h.processManager.emit('exit', 'proc-1', 0);
    await vi.waitFor(() => {
      expect(h.queries.threads.updateStatus).toHaveBeenCalledWith(
        'thread-1',
        'completed',
        undefined,
      );
    });
    expect(h.conversations.at(-1)).toMatchObject({
      phase: 'interactive_terminal',
      speaker: 'codex',
      role: 'response',
      content: 'Session finished cleanly.',
    });
    expect(h.mainWindow.webContents.send).toHaveBeenCalledWith(
      'terminal:event',
      expect.objectContaining({ threadId: 'thread-1' }),
    );
    expect(result.worktreePath).toBe(h.worktreePath);
  });

  it('falls back to an exit summary and marks the thread failed when Codex exits non-zero', async () => {
    const h = await harness();
    await startIssueTerminalSession({
      args: { projectId: 'project-1', issueNumber: 12, provider: 'codex', reasoningEffort: 'none' },
      queries: h.queries as never,
      processManager: h.processManager as never,
      mainWindow: h.mainWindow as never,
    });

    const spawnArgs = h.processManager.spawn.mock.calls[0][2] as string[];
    expect(spawnArgs).toContain('workspace-write');
    expect(spawnArgs).toContain('model_reasoning_effort=low');

    h.processManager.emit('exit', 'proc-1', 3);
    await vi.waitFor(() => {
      expect(h.queries.threads.updateStatus).toHaveBeenCalledWith(
        'thread-1',
        'failed',
        'Interactive codex exited with code 3',
      );
    });
    expect(h.conversations.at(-1)?.content).toContain('exited with code 3');
  });

  it('throws when setup leaves the thread without a worktree path or branch', async () => {
    const h = await harness();
    h.setThread({ worktreePath: null, worktreeBranch: null });
    mockCreateWorktree.mockResolvedValueOnce({
      branch: 'shipcode/12-issue-terminal',
      worktreePath: '/tmp/created-worktree',
    });
    h.queries.threads.getById.mockImplementation(() =>
      makeThread({ worktreePath: null, worktreeBranch: null }),
    );

    await expect(
      startIssueTerminalSession({
        args: { projectId: 'project-1', issueNumber: 12, provider: 'claude' },
        queries: h.queries as never,
        processManager: h.processManager as never,
        mainWindow: h.mainWindow as never,
      }),
    ).rejects.toThrow('has no worktree path after setup');

    h.queries.threads.getById.mockImplementation(() =>
      makeThread({ worktreePath: '/tmp/worktree', worktreeBranch: null }),
    );
    await expect(
      startIssueTerminalSession({
        args: { projectId: 'project-1', issueNumber: 12, provider: 'claude' },
        queries: h.queries as never,
        processManager: h.processManager as never,
        mainWindow: h.mainWindow as never,
      }),
    ).rejects.toThrow('has no worktree branch after setup');
  });

  it('builds a GitHub comment from the latest response, with a fallback body', () => {
    const queries = {
      threads: {
        getById: vi.fn(() => makeThread()),
      },
      agentConversations: {
        listByThread: vi.fn(() => [{ content: '  Landed the coverage tests.  ' }]),
      },
    };

    expect(buildIssueTerminalGithubComment(queries as never, 'thread-1')).toBe(
      `ShipCode interactive terminal update for #12:

Landed the coverage tests.`,
    );

    queries.threads.getById.mockReturnValueOnce(makeThread({ githubIssueNumber: null }));
    queries.agentConversations.listByThread.mockReturnValueOnce([]);
    expect(buildIssueTerminalGithubComment(queries as never, 'thread-1')).toBe(
      `ShipCode interactive terminal update for the issue:

Interactive terminal session completed.`,
    );
  });
});
