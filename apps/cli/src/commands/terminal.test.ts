import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminalCommand, terminalCommentCommand, terminalSummaryCommand } from './terminal';

const { createCliContextMock } = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
}));

vi.mock('../context', () => ({
  createCliContext: createCliContextMock,
}));

vi.mock('../adapters/cli-emitter', () => ({
  sanitizeCliText: (value: string) => value,
}));

vi.mock('@shipcode/git', () => ({
  WorktreeManager: vi.fn(),
}));

vi.mock('@shipcode/shared', () => ({
  PIPELINE_PHASE: {
    completed: 'completed',
    executing: 'executing',
    failed: 'failed',
  },
  resolveProviderReasoningEffort: () => ({ effective: 'medium' }),
  THREAD_KIND: {
    pipeline: 'pipeline',
  },
}));

describe('terminalCommand', () => {
  let tmpDir: string;
  let stdinDescriptors: Record<string, PropertyDescriptor | undefined>;
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-cli-terminal-'));
    stdinDescriptors = {
      isTTY: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
      isRaw: Object.getOwnPropertyDescriptor(process.stdin, 'isRaw'),
      setRawMode: Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode'),
      resume: Object.getOwnPropertyDescriptor(process.stdin, 'resume'),
    };
  });

  afterEach(async () => {
    for (const [key, descriptor] of Object.entries(stdinDescriptors)) {
      if (descriptor) {
        Object.defineProperty(process.stdin, key, descriptor);
      } else {
        Reflect.deleteProperty(process.stdin, key);
      }
    }
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  it('settles and restores stdin when the managed process exits during spawn', async () => {
    const processManager = new EventEmitter() as EventEmitter & {
      spawn: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
    };
    processManager.spawn = vi.fn(() => {
      processManager.emit('output', 'proc-1', 'fast failure\n');
      processManager.emit('exit', 'proc-1', 2);
      return { id: 'proc-1' };
    });
    processManager.write = vi.fn();
    const setRawMode = vi.fn();
    const resume = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'isRaw', { configurable: true, value: false });
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });
    Object.defineProperty(process.stdin, 'resume', { configurable: true, value: resume });

    const thread = {
      id: 'thread-1',
      worktreeBranch: 'shipcode/issue-123',
      worktreePath: tmpDir,
    };
    const issue = {
      body: 'Fix it',
      id: 'issue-1',
      issueNumber: 123,
      title: 'Fast failure',
    };
    const agentConversationInsert = vi.fn();
    const updateStatus = vi.fn();
    createCliContextMock.mockReturnValue({
      agentConversations: { insert: agentConversationInsert },
      githubIssues: { getByNumber: vi.fn(() => issue), linkThread: vi.fn() },
      processManager,
      project: { defaultBranch: 'develop', gitRemote: 'origin', id: 'project-1', path: tmpDir },
      settings: { get: vi.fn(() => ({ worktreeBranchFormat: null, worktreeRoot: null })) },
      terminalEvents: { create: vi.fn() },
      threads: {
        create: vi.fn(),
        getById: vi.fn(() => thread),
        getByProjectAndGithubIssue: vi.fn(() => thread),
        setGithubIssue: vi.fn(),
        setWorktree: vi.fn(),
        updateIssueContent: vi.fn(),
        updateStatus,
      },
    });

    await expect(terminalCommand('123', { provider: 'claude' })).resolves.toBeUndefined();

    expect(resume).not.toHaveBeenCalled();
    expect(setRawMode).not.toHaveBeenCalled();
    expect(processManager.listenerCount('output')).toBe(0);
    expect(processManager.listenerCount('exit')).toBe(0);
    expect(stdoutWrite).toHaveBeenCalledWith('fast failure\n');
    expect(agentConversationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Interactive claude session exited with code 2'),
        phase: 'interactive_terminal',
        role: 'response',
      }),
    );
    expect(updateStatus).toHaveBeenLastCalledWith(
      'thread-1',
      'failed',
      'Interactive claude exited with code 2',
    );
  });

  it('forwards stdin and records a successful codex terminal summary', async () => {
    const processManager = new EventEmitter() as EventEmitter & {
      spawn: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
    };
    processManager.spawn = vi.fn(() => ({ id: 'proc-2' }));
    processManager.write = vi.fn();
    const resume = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    Object.defineProperty(process.stdin, 'isRaw', { configurable: true, value: false });
    Object.defineProperty(process.stdin, 'resume', { configurable: true, value: resume });

    const thread = {
      id: 'thread-2',
      worktreeBranch: 'shipcode/issue-456',
      worktreePath: tmpDir,
    };
    const issue = {
      body: '',
      id: 'issue-2',
      issueNumber: 456,
      title: 'Interactive fix',
    };
    const agentConversationInsert = vi.fn();
    const updateStatus = vi.fn();
    createCliContextMock.mockReturnValue({
      agentConversations: { insert: agentConversationInsert },
      githubIssues: { getByNumber: vi.fn(() => issue), linkThread: vi.fn() },
      processManager,
      project: { defaultBranch: 'develop', gitRemote: 'origin', id: 'project-1', path: tmpDir },
      settings: { get: vi.fn(() => ({ worktreeBranchFormat: null, worktreeRoot: null })) },
      terminalEvents: { create: vi.fn() },
      threads: {
        create: vi.fn(),
        getById: vi.fn(() => thread),
        getByProjectAndGithubIssue: vi.fn(() => thread),
        setGithubIssue: vi.fn(),
        setWorktree: vi.fn(),
        updateIssueContent: vi.fn(),
        updateStatus,
      },
    });

    const runDir = path.join(tmpDir, '.shipcode', 'runs', 'thread-2');
    const command = terminalCommand('456', { model: 'gpt-5', provider: 'codex' });
    await vi.waitFor(() => expect(processManager.spawn).toHaveBeenCalled());
    await fs.writeFile(path.join(runDir, 'session-summary.md'), 'Changed files\n', 'utf8');

    process.stdin.emit('data', Buffer.from('continue\n'));
    processManager.emit('output', 'proc-2', 'terminal output\n');
    processManager.emit('exit', 'proc-2', 0);

    await expect(command).resolves.toBeUndefined();

    expect(processManager.spawn).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining(['-m', 'gpt-5', '-c', 'model_reasoning_effort=medium']),
      tmpDir,
      'thread-2',
      { outputMode: 'raw' },
    );
    expect(resume).toHaveBeenCalled();
    expect(processManager.write).toHaveBeenCalledWith('proc-2', 'continue\n');
    expect(stdoutWrite).toHaveBeenCalledWith('terminal output\n');
    expect(agentConversationInsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'Changed files',
        phase: 'interactive_terminal',
        provider: 'codex-cli',
        role: 'response',
      }),
    );
    expect(updateStatus).toHaveBeenLastCalledWith('thread-2', 'completed', undefined);
  });
});

describe('terminal summary commands', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const addIssueCommentMock = vi.fn();
  const listByThreadMock = vi.fn();
  const getThreadByIssueMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createCliContextMock.mockReturnValue({
      agentConversations: { listByThread: listByThreadMock },
      ghCli: { addIssueComment: addIssueCommentMock },
      project: { id: 'project-1' },
      threads: { getByProjectAndGithubIssue: getThreadByIssueMock },
    });
    getThreadByIssueMock.mockReturnValue({ id: 'thread-1' });
    listByThreadMock.mockReturnValue([{ content: 'Latest summary\u001b[2J' }]);
  });

  it('prints the latest saved terminal summary', async () => {
    await terminalSummaryCommand('77');

    expect(listByThreadMock).toHaveBeenCalledWith('thread-1', {
      phase: 'interactive_terminal',
      role: 'response',
    });
    expect(logSpy).toHaveBeenCalledWith('Latest summary\u001b[2J');
  });

  it('prints the default terminal summary when none has been saved', async () => {
    listByThreadMock.mockReturnValueOnce([]);

    await terminalSummaryCommand('77');

    expect(logSpy).toHaveBeenCalledWith('No interactive terminal summary saved yet.');
  });

  it('prints a GitHub comment preview by default', async () => {
    await terminalCommentCommand('77', {});

    expect(logSpy).toHaveBeenCalledWith(
      'ShipCode interactive terminal update for #77:\n\nLatest summary\u001b[2J',
    );
    expect(addIssueCommentMock).not.toHaveBeenCalled();
  });

  it('posts a GitHub comment when requested', async () => {
    await terminalCommentCommand('77', { post: true });

    expect(addIssueCommentMock).toHaveBeenCalledWith(
      77,
      'ShipCode interactive terminal update for #77:\n\nLatest summary\u001b[2J',
    );
    expect(logSpy).toHaveBeenCalledWith('Posted comment to issue #77.');
  });

  it('exits when no terminal thread exists for summary lookup', async () => {
    vi.spyOn(process, 'exit').mockImplementationOnce((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? ''}`);
    });
    getThreadByIssueMock.mockReturnValueOnce(null);

    await expect(terminalSummaryCommand('77')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('No thread found for issue #77.');
  });
});
