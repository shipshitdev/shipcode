import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import log from '../logger.service';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  stagePrdAttachments,
} from './prd-attachments';
import { registerInstantHandlers } from './register-instant-handlers';

const mockAssertPrdRewriteModelSupported = vi.hoisted(() => vi.fn());

vi.mock('./helpers', () => ({
  assertPrdRewriteModelSupported: mockAssertPrdRewriteModelSupported,
}));

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
  const attachmentSessions: string[] = [];
  const tmpFiles: string[] = [];

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

  afterEach(() => {
    for (const id of attachmentSessions) clearPrdAttachmentSession(id);
    attachmentSessions.length = 0;
    for (const file of tmpFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* already gone */
      }
    }
    tmpFiles.length = 0;
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
        prompt: 'Audit dotfiles',
        scope: 'user',
        cli: 'claude',
        reasoningEffort: 'high',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-3' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      [
        '-p',
        'Audit dotfiles',
        '--allowedTools',
        'Read,Glob,Grep',
        '--max-thinking-tokens',
        '32000',
      ],
      expect.any(String),
      'thread-created-3',
    );

    await expect(
      run(undefined, {
        projectId: 'project-1',
        prompt: 'Run tests',
        scope: 'custom',
        cli: 'codex',
        customSystemPrompt: 'Use focused verification.',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-4' });
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

    queries.projects.getById.mockReturnValueOnce(null);
    await expect(
      run(undefined, {
        projectId: 'missing-project',
        prompt: 'Missing project',
        scope: 'project',
        cli: 'codex',
      }),
    ).rejects.toThrow('Project not found: missing-project');
  });

  it('builds low-effort Claude run args without model or thinking flags', async () => {
    const run = handlers.get('instant:run');
    if (!run) throw new Error('instant:run handler not registered');

    await expect(
      run(undefined, {
        projectId: 'project-1',
        prompt: 'Small edit',
        scope: 'project',
        cli: 'claude',
        reasoningEffort: 'low',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-1' });

    expect(processManager.spawn).toHaveBeenCalledWith(
      'claude',
      'claude',
      [
        '-p',
        'Small edit',
        '--allowedTools',
        'Edit,Write,Bash,Glob,Grep,Read',
        '--dangerously-skip-permissions',
      ],
      '/tmp/repo',
      'thread-created-1',
    );
  });

  it('builds default-effort Claude run args and user-scope model args', async () => {
    const run = handlers.get('instant:run');
    if (!run) throw new Error('instant:run handler not registered');

    await expect(
      run(undefined, {
        projectId: 'project-1',
        prompt: 'Default effort edit',
        scope: 'project',
        cli: 'claude',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-1' });
    expect(processManager.spawn).toHaveBeenCalledWith(
      'claude',
      'claude',
      [
        '-p',
        'Default effort edit',
        '--allowedTools',
        'Edit,Write,Bash,Glob,Grep,Read',
        '--dangerously-skip-permissions',
        '--max-thinking-tokens',
        '32000',
      ],
      '/tmp/repo',
      'thread-created-1',
    );

    await expect(
      run(undefined, {
        prompt: 'Read home',
        scope: 'user',
        cli: 'claude',
        modelId: 'claude-sonnet-4-6',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-2' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      [
        '-p',
        'Read home',
        '--model',
        'claude-sonnet-4-6',
        '--allowedTools',
        'Read,Glob,Grep',
        '--max-thinking-tokens',
        '32000',
      ],
      expect.any(String),
      'thread-created-2',
    );
  });

  it('logs startup cleanup when stale instant threads are removed', () => {
    handlers.clear();
    queries.threads.deleteOlderThan.mockReturnValueOnce(2);

    registerInstantHandlers({
      ipcMain,
      queries,
      processManager,
    } as never);

    expect(log.info).toHaveBeenCalledWith(
      '[instant] cleaned up 2 instant threads older than 7 days',
    );
  });

  it('adds staged screenshot context to instant prompts', async () => {
    const run = handlers.get('instant:run');
    if (!run) throw new Error('instant:run handler not registered');
    const sessionId = createPrdAttachmentSession('sender-1', 'project-1');
    attachmentSessions.push(sessionId);
    const pngPath = path.join(os.tmpdir(), `shipcode-instant-${Date.now()}.png`);
    fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    tmpFiles.push(pngPath);
    const { staged } = stagePrdAttachments(sessionId, [pngPath]);

    await run(undefined, {
      projectId: 'project-1',
      prompt: 'Inspect screenshot',
      scope: 'project',
      cli: 'codex',
      attachmentSessionId: sessionId,
    });

    expect(queries.threads.create).toHaveBeenCalledWith(
      'project-1',
      expect.stringContaining(staged[0].stagedPath),
      'Inspect screenshot',
      'instant',
    );
    expect(processManager.spawn).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining([expect.stringContaining('Screenshot files available at:')]),
      '/tmp/repo',
      'thread-created-1',
    );

    await run(undefined, {
      projectId: 'project-1',
      prompt: 'No staged attachments',
      scope: 'project',
      cli: 'codex',
      attachmentSessionId: 'missing-session',
    });
    expect(queries.threads.create).toHaveBeenLastCalledWith(
      'project-1',
      'No staged attachments',
      'No staged attachments',
      'instant',
    );
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

    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'claude',
        reasoningEffort: 'medium',
        initialPrompt: 'Inspect medium',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-2' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      ['--effort', 'medium', 'Inspect medium'],
      '/tmp/repo',
      'thread-created-2',
      { outputMode: 'raw' },
    );

    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'claude',
        modelId: 'claude-sonnet-4-6',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-3' });
    expect(queries.threads.create).toHaveBeenLastCalledWith(
      'project-1',
      '',
      'Claude shell',
      'instant',
    );
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      ['--model', 'claude-sonnet-4-6', '--effort', 'high'],
      '/tmp/repo',
      'thread-created-3',
      { outputMode: 'raw' },
    );

    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'claude',
        reasoningEffort: 'low',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-4' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      [],
      '/tmp/repo',
      'thread-created-4',
      { outputMode: 'raw' },
    );

    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'codex',
        modelId: 'gpt-5.4-mini',
        reasoningEffort: 'medium',
        initialPrompt: 'Investigate failing tests',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-5' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'codex',
      'codex',
      [
        '-m',
        'gpt-5.4-mini',
        '-c',
        'model_reasoning_effort=medium',
        '--sandbox',
        'workspace-write',
        'Investigate failing tests',
      ],
      '/tmp/repo',
      'thread-created-5',
      { outputMode: 'raw' },
    );

    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'codex',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-6' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'codex',
      'codex',
      ['-c', 'model_reasoning_effort=high', '--sandbox', 'workspace-write'],
      '/tmp/repo',
      'thread-created-6',
      { outputMode: 'raw' },
    );

    queries.projects.getById.mockReturnValueOnce(null);
    await expect(
      shellStart(undefined, {
        projectId: 'missing-project',
        cli: 'codex',
      }),
    ).rejects.toThrow('Project not found: missing-project');
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

    shellResize(undefined, {
      threadId: 'thread-created-1',
      cols: 90,
      rows: Number.POSITIVE_INFINITY,
    });
    expect(processManager.resize).toHaveBeenLastCalledWith('proc-1', 90, 1);

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

    cancel(undefined, { threadId: 'unknown-thread' });
    shellResize(undefined, { threadId: 'unknown-thread', cols: 80, rows: 24 });
    expect(processManager.kill).toHaveBeenCalledTimes(1);
    expect(processManager.resize).toHaveBeenCalledTimes(2);

    queries.projects.getById.mockReturnValueOnce(null);
    await expect(bareShell(undefined, { projectId: 'missing-project' })).rejects.toThrow(
      'Project not found: missing-project',
    );

    queries.projects.getById.mockReturnValueOnce({
      id: 'project-1',
      name: null,
      path: '/tmp/fallback-repo',
    });
    await expect(bareShell(undefined, { projectId: 'project-1' })).resolves.toEqual({
      threadId: 'thread-created-2',
    });
    expect(queries.threads.create).toHaveBeenLastCalledWith(
      'project-1',
      '',
      'Terminal — fallback-repo',
      'instant',
    );
  });

  it('marks run sessions failed on non-zero exit and ignores unrelated process exits', async () => {
    const run = handlers.get('instant:run');
    if (!run) throw new Error('instant:run handler not registered');

    await run(undefined, {
      projectId: 'project-1',
      prompt: 'Failing run',
      scope: 'project',
      cli: 'codex',
    });

    exitHandlers.at(-1)?.('different-proc', 1);
    expect(queries.threads.updateStatus).not.toHaveBeenCalled();
    expect(processManager.removeListener).not.toHaveBeenCalled();

    exitHandlers.at(-1)?.('proc-1', 13);
    expect(queries.threads.updateStatus).toHaveBeenCalledWith(
      'thread-created-1',
      'failed',
      'Process exited with code 13',
    );
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

  it('builds terminal-fix prompts with project name fallback and empty plan lists', async () => {
    const fix = handlers.get('instant:fix-thread-failure');
    if (!fix) throw new Error('instant:fix-thread-failure handler not registered');
    queries.projects.getById.mockReturnValueOnce({
      id: 'project-1',
      name: null,
      path: '/tmp/repo',
    });
    queries.threads.getById.mockReturnValueOnce(
      makeThread({
        title: 'Fallback project task',
        prompt: null,
        worktreePath: null,
        githubIssueNumber: null,
        executorModel: 'codex',
      }),
    );
    queries.plans.getLatest.mockReturnValueOnce({
      structured: {
        objective: 'Fix without listed steps',
        version: 3,
        steps: [],
        acceptanceCriteria: [],
      },
    });

    await fix(undefined, { threadId: 'thread-1', failureOutput: 'failure' });

    const prompt = (processManager.spawnWithStdin.mock.calls.at(-1)?.[4] ?? '') as string;
    expect(prompt).toContain('- Project: Project');
    expect(prompt).toContain('Thread prompt:');
    expect(prompt).toContain('Latest plan:\nObjective: Fix without listed steps\nPlan version: 3');
    expect(prompt).not.toContain('Steps:');
    expect(prompt).not.toContain('Acceptance criteria:');
  });

  it('rejects terminal-fix sessions when the source thread or project is missing', async () => {
    const fix = handlers.get('instant:fix-thread-failure');
    if (!fix) throw new Error('instant:fix-thread-failure handler not registered');

    queries.threads.getById.mockReturnValueOnce(null);
    await expect(
      fix(undefined, { threadId: 'missing-thread', failureOutput: 'boom' }),
    ).rejects.toThrow('Thread missing-thread not found');

    queries.threads.getById.mockReturnValueOnce(makeThread({ projectId: 'missing-project' }));
    queries.projects.getById.mockReturnValueOnce(null);
    await expect(fix(undefined, { threadId: 'thread-1', failureOutput: 'boom' })).rejects.toThrow(
      'Project missing-project not found',
    );
  });

  it('truncates oversized issue context and failure output in terminal-fix prompts', async () => {
    const fix = handlers.get('instant:fix-thread-failure');
    if (!fix) throw new Error('instant:fix-thread-failure handler not registered');
    queries.githubIssues.getByNumber.mockReturnValueOnce({
      id: 'issue-42',
      title: 'Huge context issue',
      body: `${'a'.repeat(7_000)}\u001B[31mred\u001B[0m`,
    });

    await fix(undefined, {
      threadId: 'thread-1',
      failureOutput: `${'x'.repeat(9_000)}tail failure`,
    });

    const prompt = (processManager.spawnWithStdin.mock.calls.at(-1)?.[4] ?? '') as string;
    expect(prompt).toContain('[truncated]');
    expect(prompt).toContain('[Earlier terminal output truncated]');
    expect(prompt).toContain('tail failure');
    expect(prompt).not.toContain('\u001B[31m');
  });

  it('uses the default login shell when SHELL is not set', async () => {
    const bareShell = handlers.get('instant:bare-shell');
    if (!bareShell) throw new Error('instant:bare-shell handler not registered');
    const previousShell = process.env.SHELL;
    Reflect.deleteProperty(process.env, 'SHELL');

    try {
      await expect(bareShell(undefined, { projectId: 'project-1' })).resolves.toEqual({
        threadId: 'thread-created-1',
      });
    } finally {
      if (previousShell !== undefined) process.env.SHELL = previousShell;
    }

    expect(processManager.spawn).toHaveBeenCalledWith(
      'shell',
      '/bin/zsh',
      ['-l'],
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
    );
  });
});
