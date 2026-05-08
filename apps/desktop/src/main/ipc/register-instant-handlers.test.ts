import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerInstantHandlers } from './register-instant-handlers';

vi.mock('../logger.service', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Fix terminal failure',
    prompt: 'Original task prompt',
    status: 'failed',
    kind: 'pipeline',
    worktreeBranch: 'shipcode/thread-1',
    worktreePath: '/tmp/repo/.shipcode/worktrees/thread-1',
    executorModel: 'codex',
    githubIssueNumber: 42,
    ...overrides,
  };
}

describe('registerInstantHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  let queries: {
    projects: {
      getOrCreateInstantProject: ReturnType<typeof vi.fn>;
      getById: ReturnType<typeof vi.fn>;
    };
    threads: {
      deleteOlderThan: ReturnType<typeof vi.fn>;
      getById: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateStatus: ReturnType<typeof vi.fn>;
      listInstant: ReturnType<typeof vi.fn>;
    };
    githubIssues: {
      getByNumber: ReturnType<typeof vi.fn>;
    };
    plans: {
      getLatest: ReturnType<typeof vi.fn>;
    };
  };
  let processManager: {
    spawn: ReturnType<typeof vi.fn>;
    spawnWithStdin: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
  let exitHandlers: Array<(processId: string, exitCode: number) => void>;
  let createThreadCounter: number;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    exitHandlers = [];
    createThreadCounter = 0;

    queries = {
      projects: {
        getOrCreateInstantProject: vi.fn(() => ({ id: 'instant-project' })),
        getById: vi.fn(() => ({
          id: 'project-1',
          name: 'ShipCode',
          path: '/tmp/repo',
        })),
      },
      threads: {
        deleteOlderThan: vi.fn(() => 0),
        getById: vi.fn(() => makeThread()),
        create: vi.fn(() => ({ id: `thread-created-${++createThreadCounter}` })),
        updateStatus: vi.fn(),
        listInstant: vi.fn(() => [makeThread({ id: 'instant-1', kind: 'instant' })]),
      },
      githubIssues: {
        getByNumber: vi.fn(() => ({
          id: 'issue-42',
          title: 'Broken terminal run',
          body: 'Issue body with task context',
        })),
      },
      plans: {
        getLatest: vi.fn(() => ({
          structured: {
            objective: 'Fix the task',
            version: 2,
            steps: [{ order: 1, description: 'Repair terminal failure' }],
            acceptanceCriteria: ['Terminal fix runs verification'],
          },
        })),
      },
    };
    processManager = {
      spawn: vi.fn(() => ({ id: `proc-${createThreadCounter || 1}` })),
      spawnWithStdin: vi.fn(() => ({ id: 'proc-1' })),
      on: vi.fn((_event: string, handler: (processId: string, exitCode: number) => void) => {
        exitHandlers.push(handler);
      }),
      removeListener: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };

    registerInstantHandlers({
      ipcMain,
      queries,
      processManager,
    } as never);
  });

  it('starts an embedded fix session in the source thread worktree with task context', async () => {
    const handler = handlers.get('instant:fix-thread-failure');
    if (!handler) throw new Error('instant:fix-thread-failure handler not registered');

    const result = await handler(undefined, {
      threadId: 'thread-1',
      failureOutput: 'ERROR codex_core::session: failed to record rollout items',
    });

    expect(queries.threads.create).toHaveBeenCalledWith(
      'project-1',
      expect.stringContaining('Issue body with task context'),
      'Fix #42',
      'instant',
    );
    expect(processManager.spawnWithStdin).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining(['exec', '-', '--sandbox', 'workspace-write']),
      '/tmp/repo/.shipcode/worktrees/thread-1',
      expect.stringContaining('ERROR codex_core::session: failed to record rollout items'),
      'thread-created-1',
    );
    expect(result).toEqual({ threadId: 'thread-created-1', cli: 'codex', title: 'Fix #42' });
  });

  it('runs instant Codex and Claude sessions across user, project, and custom scopes', async () => {
    const run = handlers.get('instant:run');
    if (!run) throw new Error('instant:run handler not registered');

    await expect(
      run(undefined, {
        prompt: 'Audit my shell setup',
        scope: 'user',
        cli: 'codex',
        modelId: 'gpt-5.4-mini',
        reasoningEffort: 'medium',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-1' });
    expect(queries.threads.create).toHaveBeenCalledWith(
      'instant-project',
      'Audit my shell setup',
      'Audit my shell setup',
      'instant',
    );
    expect(processManager.spawn).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining([
        '-m',
        'gpt-5.4-mini',
        '-c',
        'model_reasoning_effort=medium',
        'exec',
        'Audit my shell setup',
        '--sandbox',
        'read-only',
        '--json',
      ]),
      expect.any(String),
      'thread-created-1',
    );

    await expect(
      run(undefined, {
        projectId: 'project-1',
        prompt: 'Fix lint',
        scope: 'project',
        cli: 'claude',
        modelId: 'claude-sonnet-4-6',
        reasoningEffort: 'medium',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-2' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      expect.arrayContaining([
        '-p',
        'Fix lint',
        '--model',
        'claude-sonnet-4-6',
        '--allowedTools',
        'Edit,Write,Bash,Glob,Grep,Read',
        '--dangerously-skip-permissions',
        '--max-thinking-tokens',
        '8000',
      ]),
      '/tmp/repo',
      'thread-created-2',
    );

    await expect(
      run(undefined, {
        projectId: 'project-1',
        prompt: 'Run tests',
        scope: 'custom',
        cli: 'codex',
        customSystemPrompt: 'Use focused verification.',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-3' });
    expect(queries.threads.create).toHaveBeenLastCalledWith(
      'project-1',
      'Use focused verification.\n\nRun tests',
      'Run tests',
      'instant',
    );

    await expect(
      run(undefined, {
        prompt: 'Missing project',
        scope: 'project',
        cli: 'codex',
      }),
    ).rejects.toThrow('projectId is required for project/custom scope');
  });

  it('starts interactive shells, forwards terminal input and resize, and records exits', async () => {
    const shellStart = handlers.get('instant:shell-start');
    const shellInput = handlers.get('instant:shell-input');
    const shellResize = handlers.get('instant:shell-resize');
    if (!shellStart || !shellInput || !shellResize)
      throw new Error('shell handlers not registered');

    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'claude',
        modelId: 'claude-sonnet-4-6',
        reasoningEffort: 'high',
        initialPrompt: '  Inspect failures  ',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-1' });
    expect(queries.threads.create).toHaveBeenCalledWith(
      'project-1',
      'Inspect failures',
      'Inspect failures',
      'instant',
    );
    expect(processManager.spawn).toHaveBeenCalledWith(
      'claude',
      'claude',
      ['--model', 'claude-sonnet-4-6', '--effort', 'high', 'Inspect failures'],
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
    );

    shellInput(undefined, { threadId: 'thread-created-1', data: 'bun test\n' });
    shellResize(undefined, { threadId: 'thread-created-1', cols: 120.8, rows: 32.2 });
    expect(processManager.write).toHaveBeenCalledWith('proc-1', 'bun test\n');
    expect(processManager.resize).toHaveBeenCalledWith('proc-1', 120, 32);

    exitHandlers.at(-1)?.('proc-1', 0);
    expect(processManager.removeListener).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(queries.threads.updateStatus).toHaveBeenCalledWith(
      'thread-created-1',
      'completed',
      undefined,
    );

    shellInput(undefined, { threadId: 'thread-created-1', data: 'ignored' });
    expect(processManager.write).toHaveBeenCalledTimes(1);
  });

  it('starts bare shells, clamps unsafe resize values, cancels sessions, lists and cleans up', async () => {
    const bareShell = handlers.get('instant:bare-shell');
    const shellResize = handlers.get('instant:shell-resize');
    const cancel = handlers.get('instant:cancel');
    const list = handlers.get('instant:list');
    const cleanup = handlers.get('instant:cleanup');
    if (!bareShell || !shellResize || !cancel || !list || !cleanup) {
      throw new Error('instant utility handlers not registered');
    }

    await expect(bareShell(undefined, { projectId: 'project-1' })).resolves.toEqual({
      threadId: 'thread-created-1',
    });
    expect(processManager.spawn).toHaveBeenCalledWith(
      'shell',
      process.env.SHELL || '/bin/zsh',
      ['-l'],
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
    );

    shellResize(undefined, { threadId: 'thread-created-1', cols: Number.NaN, rows: -2 });
    expect(processManager.resize).toHaveBeenCalledWith('proc-1', 1, 1);

    cancel(undefined, { threadId: 'thread-created-1' });
    expect(processManager.kill).toHaveBeenCalledWith('proc-1');
    expect(queries.threads.updateStatus).toHaveBeenCalledWith(
      'thread-created-1',
      'failed',
      'Cancelled by user',
    );

    expect(list()).toEqual([makeThread({ id: 'instant-1', kind: 'instant' })]);
    queries.threads.deleteOlderThan.mockReturnValueOnce(3);
    expect(cleanup()).toEqual({ deleted: 3 });
  });

  it('uses thread prompt fallback, Claude executor, project cwd, and rejects empty failure output', async () => {
    const fix = handlers.get('instant:fix-thread-failure');
    if (!fix) throw new Error('instant:fix-thread-failure handler not registered');
    queries.threads.getById.mockReturnValueOnce(
      makeThread({
        title: 'Local failing task',
        prompt: 'Thread-only prompt',
        worktreePath: null,
        worktreeBranch: null,
        githubIssueNumber: null,
        executorModel: 'claude',
      }),
    );
    queries.plans.getLatest.mockReturnValueOnce({ structured: null });

    await expect(
      fix(undefined, { threadId: 'thread-1', failureOutput: '\u001B[31mboom\u001B[0m' }),
    ).resolves.toEqual({
      threadId: 'thread-created-1',
      cli: 'claude',
      title: 'Fix Local failing task',
    });
    expect(processManager.spawnWithStdin).toHaveBeenCalledWith(
      'claude',
      'claude',
      ['-p', '--allowedTools', 'Edit,Write,Bash,Glob,Grep,Read', '--dangerously-skip-permissions'],
      '/tmp/repo',
      expect.stringContaining('Thread prompt:\nThread-only prompt'),
      'thread-created-1',
    );

    await expect(fix(undefined, { threadId: 'thread-1', failureOutput: '   ' })).rejects.toThrow(
      'No failure output available',
    );
  });
});
