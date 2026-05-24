import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminalCommand } from './terminal';

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
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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
});
