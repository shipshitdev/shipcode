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
const mockAssertRegistered = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@shipcode/git', () => ({
  WorktreeManager: class {
    assertRegistered = mockAssertRegistered;
  },
}));

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
    settings: {
      get: ReturnType<typeof vi.fn>;
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
    get: ReturnType<typeof vi.fn>;
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
      settings: {
        get: vi.fn(() => ({
          worktreeRoot: null,
          worktreeBranchFormat: null,
          agentRunModes: {
            claude: {
              issueTerminal: 'interactive',
              execute: 'interactive',
              terminalFix: 'interactive',
              instant: 'interactive',
            },
            codex: {
              issueTerminal: 'interactive',
              execute: 'interactive',
              terminalFix: 'interactive',
              instant: 'interactive',
            },
          },
        })),
      },
    };
    processManager = {
      spawn: vi.fn(() => ({ id: `proc-${createThreadCounter || 1}` })),
      spawnWithStdin: vi.fn(() => ({ id: `proc-${createThreadCounter || 1}` })),
      on: vi.fn((_event: string, handler: (processId: string, exitCode: number) => void) => {
        exitHandlers.push(handler);
      }),
      removeListener: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      get: vi.fn(() => null),
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
    expect(processManager.spawn).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining(['-s', 'workspace-write', '-a', 'on-request', '--no-alt-screen']),
      '/tmp/repo/.shipcode/worktrees/thread-1',
      'thread-created-1',
      {
        outputMode: 'raw',
        workspaceRoot: null,
        projectPath: '/tmp/repo',
      },
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
        '-s',
        'read-only',
        '-c',
        'model_reasoning_effort=medium',
      ]),
      expect.any(String),
      'thread-created-1',
      { outputMode: 'raw' },
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
      expect.arrayContaining(['--permission-mode', 'acceptEdits', '--model', 'claude-sonnet-4-6']),
      '/tmp/repo',
      'thread-created-2',
      { outputMode: 'raw' },
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
      expect.arrayContaining(['--permission-mode', 'default', '--tools', 'Read,Glob,Grep']),
      expect.any(String),
      'thread-created-3',
      { outputMode: 'raw' },
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
    ).rejects.toThrow('Project missing-project not found');
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
      expect.arrayContaining([
        '--permission-mode',
        'acceptEdits',
        '--tools',
        'Edit,Write,Bash,Glob,Grep,Read',
      ]),
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
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
      expect.arrayContaining([
        '--permission-mode',
        'acceptEdits',
        '--tools',
        'Edit,Write,Bash,Glob,Grep,Read',
      ]),
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
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
      expect.arrayContaining([
        '--permission-mode',
        'default',
        '--tools',
        'Read,Glob,Grep',
        '--model',
        'claude-sonnet-4-6',
      ]),
      expect.any(String),
      'thread-created-2',
      { outputMode: 'raw' },
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
      expect.arrayContaining(['-s', 'workspace-write', '-a', 'on-request', '--no-alt-screen']),
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
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

  it('starts structured assistant sessions and spawns resume processes for follow-ups', async () => {
    const shellStart = handlers.get('instant:shell-start');
    const shellInput = handlers.get('instant:shell-input');
    const shellResize = handlers.get('instant:shell-resize');
    if (!shellStart || !shellInput || !shellResize)
      throw new Error('shell handlers not registered');

    // Claude assistant session uses spawnWithStdin with structured output flags
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
      expect.arrayContaining([
        '--permission-mode',
        'acceptEdits',
        '--tools',
        'Edit,Write,Bash,Glob,Grep,Read',
        '--model',
        'claude-sonnet-4-6',
      ]),
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
    );

    // Resize still works (no-ops for pipe-based processes)
    shellResize(undefined, { threadId: 'thread-created-1', cols: 120.8, rows: 32.2 });
    expect(processManager.resize).toHaveBeenCalledWith('proc-1', 120, 32);

    // Exit tracking updates status
    exitHandlers.at(-1)?.('proc-1', 0);
    expect(processManager.removeListener).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(queries.threads.updateStatus).toHaveBeenCalledWith(
      'thread-created-1',
      'completed',
      undefined,
    );

    // Empty title when no prompt
    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'claude',
        modelId: 'claude-sonnet-4-6',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-2' });
    expect(queries.threads.create).toHaveBeenLastCalledWith(
      'project-1',
      '',
      'Claude assistant',
      'instant',
    );

    // Codex assistant session uses exec - --json
    await expect(
      shellStart(undefined, {
        projectId: 'project-1',
        cli: 'codex',
        modelId: 'gpt-5.4-mini',
        reasoningEffort: 'medium',
        initialPrompt: 'Investigate failing tests',
      }),
    ).resolves.toEqual({ threadId: 'thread-created-3' });
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'codex',
      'codex',
      expect.arrayContaining([
        '-m',
        'gpt-5.4-mini',
        '-s',
        'workspace-write',
        '-c',
        'model_reasoning_effort=medium',
      ]),
      '/tmp/repo',
      'thread-created-3',
      { outputMode: 'raw' },
    );

    queries.projects.getById.mockReturnValueOnce(null);
    await expect(
      shellStart(undefined, {
        projectId: 'missing-project',
        cli: 'codex',
      }),
    ).rejects.toThrow('Project missing-project not found');

    // No projectId falls back to __instant__ project with homedir cwd
    await expect(
      shellStart(undefined, {
        cli: 'claude',
        initialPrompt: 'Cross-project task',
      }),
    ).resolves.toEqual({ threadId: expect.any(String) });
    expect(queries.projects.getOrCreateInstantProject).toHaveBeenCalledWith(expect.any(String));
    expect(processManager.spawn).toHaveBeenLastCalledWith(
      'claude',
      'claude',
      expect.arrayContaining(['--permission-mode', 'acceptEdits']),
      expect.any(String),
      expect.any(String),
      { outputMode: 'raw' },
    );
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
      'Project missing-project not found',
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
    expect(processManager.spawn).toHaveBeenCalledWith(
      'claude',
      'claude',
      expect.arrayContaining([
        '--permission-mode',
        'acceptEdits',
        '--tools',
        'Edit,Write,Bash,Glob,Grep,Read',
      ]),
      '/tmp/repo',
      'thread-created-1',
      { outputMode: 'raw' },
    );
    expect(queries.threads.create).toHaveBeenCalledWith(
      'project-1',
      expect.stringContaining('Thread prompt:\nThread-only prompt'),
      'Fix Local failing task',
      'instant',
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

    const prompt = (queries.threads.create.mock.calls.at(-1)?.[1] ?? '') as string;
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

    const prompt = (queries.threads.create.mock.calls.at(-1)?.[1] ?? '') as string;
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
