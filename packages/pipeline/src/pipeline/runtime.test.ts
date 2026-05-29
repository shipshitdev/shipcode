import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AgentProvider, GhCli } from '@shipcode/agents/source';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext, PipelineDeps } from '../types';
import { snapshotProviderPhaseInput } from './context';
import { buildFrozenInstallFallback, createPipelineRuntime, resolveSetupShell } from './runtime';

const { mockExecFile, mockLoadRepoSetupContract, mockGhCli } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockLoadRepoSetupContract: vi.fn(),
  mockGhCli: {
    addIssueComment: vi.fn(),
    upsertIssueCommentByMarker: vi.fn(),
    createIssue: vi.fn(),
    closeIssue: vi.fn(),
    reopenIssue: vi.fn(),
    getIssue: vi.fn(),
    setIssueLabelPresence: vi.fn(),
    setIssueProjectMetadata: vi.fn(),
    getRepoMetadata: vi.fn(),
  },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

vi.mock('@shipcode/agents/source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/agents/source')>();
  return {
    ...actual,
    loadRepoSetupContract: mockLoadRepoSetupContract,
    GhCli: vi.fn(function GhCli() {
      return mockGhCli;
    }),
  };
});

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    threadId: 'thread-1',
    projectPath: '/repo',
    runId: null,
    projectId: 'project-1',
    worktreePath: '/repo-worktree',
    retryCount: 0,
    retryTimer: null,
    autonomous: true,
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    clarificationHistory: [],
    verificationRetries: 0,
    nodeVerificationRetries: 0,
    nodeAnchorSha: null,
    testRetries: 0,
    testOutput: null,
    githubIssueNumber: 42,
    githubIssueTitle: 'Issue',
    githubRepo: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'openrouter',
    executorModel: 'claude',
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffort: 'medium',
    reviewerReasoningEffort: 'medium',
    executorReasoningEffort: 'medium',
    verifierReasoningEffort: 'medium',
    executorModelOverride: null,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    activeProcessId: null,
    cancelled: false,
    verifiedSha: null,
    startedAt: 123,
    repoContext: null,
    repoPromptMaterials: null,
    phasePromptScopes: {
      plan: { mode: 'full' },
      review: { mode: 'full' },
      revision: { mode: 'full' },
      execute: { mode: 'full' },
      verify: { mode: 'full' },
    },
    phaseReasoningOverrides: {
      plan: 'medium',
      review: 'medium',
      revision: 'medium',
      execute: 'medium',
      verify: 'medium',
    },
    phaseReasoningEfforts: {
      plan: 'medium',
      review: 'medium',
      revision: 'medium',
      execute: 'medium',
      verify: 'medium',
    },
    promptMaterialSummaries: {},
    promptTelemetry: [],
    promptTelemetryDiagnostics: [],
    repoSetupContract: null,
    repoSetupLoaded: false,
    workflowPolicy: {
      path: null,
      config: {},
      promptTemplate: null,
      continuationPromptTemplate: null,
      agent: {
        maxConcurrentAgents: 1,
        maxRetryBackoffMs: 1000,
        maxConcurrentAgentsByState: {},
        maxTurns: 5,
      },
      warning: null,
    },
    workflowWarningEmitted: false,
    abort: new AbortController(),
    stabilizationFeedback: null,
    executionResumeContext: null,
    previousPlanRawOutput: null,
    turnCount: 0,
    featureQaState: null,
    runtimeQaCleanup: null,
    runtimeQaOutput: null,
    cpuQueueStartedAt: null,
    cpuQueueLastNotifiedAt: null,
    ...overrides,
  } as PipelineContext;
}

function makeDeps(provider?: AgentProvider) {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const deps = {
    emitter: { emit: vi.fn() },
    settings: {
      get: vi.fn(() => ({
        ...DEFAULT_SETTINGS,
        testCommand: ' bun test ',
        testingContext: 'unit',
      })),
    },
    processManager: {
      spawnWithStdin: vi.fn(() => ({ id: 'proc-1' })),
      kill: vi.fn(),
      get: vi.fn(() => ({ state: 'exited' })),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = [...(listeners[event] ?? []), handler];
      }),
      removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
      }),
    },
    providers: {
      for: vi.fn(() => provider),
    },
    threads: {
      updateStatus: vi.fn(),
      getById: vi.fn(() => ({
        id: 'thread-1',
        projectId: 'project-1',
        githubIssueNumber: 42,
      })),
      setResolvedModel: vi.fn(),
      addTokenUsage: vi.fn(),
    },
    githubIssues: {
      getByNumber: vi.fn(() => null),
      updatePipelineStatus: vi.fn(),
    },
    projects: {
      getById: vi.fn(() => null),
    },
    promptTelemetry: {
      create: vi.fn(),
    },
    pipelineSteps: {
      start: vi.fn(() => ({ id: 'step-1' })),
      complete: vi.fn(),
    },
    agentConversations: {
      insert: vi.fn(() => ({ id: 'conv-1' })),
    },
  } as unknown as PipelineDeps;

  return {
    deps,
    emitProcess(event: string, ...args: unknown[]) {
      for (const handler of listeners[event] ?? []) handler(...args);
    },
  };
}

const tempDirs: string[] = [];

function tempDir(name: string) {
  const dir = path.join(os.tmpdir(), `shipcode-runtime-${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe('createPipelineRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: 'gh-token\n', stderr: '' });
      },
    );
    mockLoadRepoSetupContract.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits terminal events and resolves phase agents', () => {
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext({ executorModel: undefined as never });

    runtime.emitTerminalRaw('thread-1', 'raw');
    runtime.emitTerminalLifecycle('thread-1', 'life');

    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'terminal:event',
      threadId: 'thread-1',
      event: { kind: 'raw', content: 'raw' },
    });
    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'terminal:event',
      threadId: 'thread-1',
      event: { kind: 'lifecycle', message: 'life' },
    });
    expect(runtime.resolveAgentForPhase(context, 'plan')).toBe('claude');
    expect(runtime.resolveAgentForPhase(context, 'review')).toBe('codex');
    expect(runtime.resolveAgentForPhase(context, 'verify')).toBe('openrouter');
    expect(runtime.resolveAgentForPhase(context, 'execute')).toBe('claude');
  });

  it('tags terminal events with the active run id when available', () => {
    const { deps } = makeDeps();
    const context = makeContext({ runId: 'run-1' });
    const runtime = createPipelineRuntime(deps, {
      activePipelines: new Map([['thread-1', context]]),
    } as never);

    runtime.emitTerminalRaw('thread-1', 'raw');

    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'terminal:event',
      threadId: 'thread-1',
      runId: 'run-1',
      event: { kind: 'raw', content: 'raw' },
    });
  });

  it('caches repo setup contracts and exposes testing/verification context', () => {
    const contract = {
      path: '/repo/.shipcode/setup.json',
      contract: {
        version: 1,
        setupCommands: ['bun install'],
        verifyCommands: ['bun test'],
        envFiles: [{ source: '.env.test', required: false }],
        setupBeforeVerify: false,
        testingContext: 'contract testing context',
      },
    };
    mockLoadRepoSetupContract.mockReturnValue(contract);
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    expect(runtime.ensureRepoSetupContract(context)).toBe(contract);
    expect(runtime.ensureRepoSetupContract(context)).toBe(contract);
    expect(mockLoadRepoSetupContract).toHaveBeenCalledTimes(1);
    expect(runtime.getTestingContext(context)).toBe('contract testing context');
    expect(runtime.getVerifyCommands(context)).toEqual(['bun test']);
    expect(runtime.buildRepoSetupPlannerNote(context)).toContain('Setup commands');
    expect(runtime.buildRepoSetupPlannerNote(context)).toContain('Verification commands');
    expect(runtime.buildRepoSetupPlannerNote(context)).toContain('.env.test');
  });

  it('falls back to settings when repo setup contract is absent', () => {
    mockLoadRepoSetupContract.mockReturnValue(null);
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    expect(runtime.prepareWorktree(context, 'execute')).resolves.toEqual({ ok: true });
    expect(runtime.getTestingContext(context)).toBe('unit');
    expect(runtime.getVerifyCommands(context)).toEqual(['bun test']);
    expect(runtime.buildRepoSetupPlannerNote(context)).toBe('');
  });

  it('returns empty verification commands when neither setup contract nor settings provide one', () => {
    mockLoadRepoSetupContract.mockReturnValue(null);
    const { deps } = makeDeps();
    deps.settings.get = vi.fn(() => ({ ...DEFAULT_SETTINGS, testCommand: '   ' })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    expect(runtime.getVerifyCommands(makeContext())).toEqual([]);
  });

  describe('buildFrozenInstallFallback', () => {
    it('strips --frozen-lockfile from bun install on lockfile drift', () => {
      expect(
        buildFrozenInstallFallback(
          'bun install --frozen-lockfile',
          'error: lockfile had changes, but lockfile is frozen',
        ),
      ).toBe('bun install');
    });

    it('strips --frozen-lockfile from bun install on min-release-age failure', () => {
      expect(
        buildFrozenInstallFallback(
          'bun install --frozen-lockfile',
          'min release age not satisfied for foo@1.2.3',
        ),
      ).toBe('bun install');
    });

    it('returns null when bun output does not match a known signature', () => {
      expect(
        buildFrozenInstallFallback('bun install --frozen-lockfile', 'EACCES: permission denied'),
      ).toBeNull();
    });

    it('strips --frozen-lockfile from pnpm install on ERR_PNPM', () => {
      expect(
        buildFrozenInstallFallback(
          'pnpm install --frozen-lockfile',
          'ERR_PNPM_OUTDATED_LOCKFILE specifiers in the lockfile',
        ),
      ).toBe('pnpm install');
    });

    it('strips --frozen-lockfile from yarn install on YN0028', () => {
      expect(
        buildFrozenInstallFallback(
          'yarn install --frozen-lockfile',
          'YN0028: The lockfile would have been modified by this install',
        ),
      ).toBe('yarn install');
    });

    it('rewrites npm ci → npm install on EUSAGE', () => {
      expect(
        buildFrozenInstallFallback(
          'npm ci',
          'EUSAGE The `npm ci` command can only install with an existing package-lock.json',
        ),
      ).toBe('npm install');
    });

    it('returns null for unrelated commands', () => {
      expect(buildFrozenInstallFallback('bun install', 'lockfile mismatch')).toBeNull();
      expect(buildFrozenInstallFallback('go mod download', 'lockfile mismatch')).toBeNull();
    });
  });

  it('selects trusted login shells with fallback to sh', () => {
    const preferred = resolveSetupShell((shell) => shell === '/bin/zsh', '/bin/zsh');
    expect(preferred.command).toBe('/bin/zsh');
    expect(preferred.args('echo ok')).toEqual(['-ilc', 'echo ok']);

    const fallbackLogin = resolveSetupShell((shell) => shell === '/bin/bash', '/usr/bin/fish');
    expect(fallbackLogin.command).toBe('/bin/bash');
    expect(fallbackLogin.args('echo ok')).toEqual(['-ilc', 'echo ok']);

    const fallbackSh = resolveSetupShell(() => false, '/usr/bin/fish');
    expect(fallbackSh.command).toBe('/bin/sh');
    expect(fallbackSh.args('echo ok')).toEqual(['-c', 'echo ok']);
  });

  it('omits repo setup planner notes when a contract has no planner-relevant bits', () => {
    mockLoadRepoSetupContract.mockReturnValue({
      path: '/repo/.shipcode/setup.json',
      contract: {
        version: 1,
        setupCommands: [],
        verifyCommands: [],
        envFiles: [],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    expect(runtime.buildRepoSetupPlannerNote(makeContext())).toBe('');
  });

  it('short-circuits verify setup when no setup or env propagation is required', async () => {
    mockLoadRepoSetupContract.mockReturnValue({
      path: '/repo/.shipcode/setup.json',
      contract: {
        version: 1,
        setupCommands: ['bun install'],
        verifyCommands: [],
        envFiles: [],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(runtime.prepareWorktree(makeContext(), 'verify')).resolves.toEqual({ ok: true });
    expect(deps.processManager.spawnWithStdin).not.toHaveBeenCalled();
  });

  it('formats setup planner notes for required env files', () => {
    mockLoadRepoSetupContract.mockReturnValue({
      path: '/repo/.shipcode/setup.json',
      contract: {
        version: 1,
        setupCommands: [],
        verifyCommands: [],
        envFiles: [{ source: '.env.required', required: true }],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    const note = runtime.buildRepoSetupPlannerNote(makeContext());

    expect(note).toContain('`.env.required`');
    expect(note).not.toContain('(optional)');
  });

  it('copies env files and runs setup commands before execution', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    writeFileSync(path.join(projectPath, '.env.test'), 'SECRET=1');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: ['printf setup'],
        verifyCommands: [],
        envFiles: [{ source: '.env.test', target: 'config/.env.test', required: true }],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps, emitProcess } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    const promise = runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute');
    emitProcess('output', 'proc-1', 'setup ok\n');
    emitProcess('exit', 'proc-1', 0);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(readFileSync(path.join(worktreePath, 'config/.env.test'), 'utf-8')).toBe('SECRET=1');
  });

  it('fails prepareWorktree for missing required env files and failed setup commands', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: [],
        verifyCommands: [],
        envFiles: [{ source: '.env.required', required: true }],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute'),
    ).resolves.toEqual({
      ok: false,
      error: 'required env file missing: .env.required',
    });

    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: ['bun test'],
        verifyCommands: [],
        envFiles: [],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const second = makeDeps();
    const secondRuntime = createPipelineRuntime(second.deps, {} as never);
    const promise = secondRuntime.prepareWorktree(
      makeContext({ projectPath, worktreePath }),
      'execute',
    );
    second.emitProcess('output', 'proc-1', 'failure one\nfailure two\nfailure three\n');
    second.emitProcess('exit', 'proc-1', 1);

    await expect(promise).resolves.toEqual({
      ok: false,
      error: 'command failed (1): bun test — failure one failure two failure three',
    });
  });

  it('formats failed setup commands without empty output snippets', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: ['bun install'],
        verifyCommands: [],
        envFiles: [],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps, emitProcess } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute');
    emitProcess('exit', 'proc-1', 2);

    await expect(promise).resolves.toEqual({
      ok: false,
      error: 'command failed (2): bun install',
    });
  });

  it('reports setup command spawn errors during worktree preparation', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: ['bun install'],
        verifyCommands: [],
        envFiles: [],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    deps.processManager.spawnWithStdin = vi.fn(() => {
      throw new Error('spawn failed');
    }) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute'),
    ).resolves.toEqual({
      ok: false,
      error: 'command error: bun install — spawn failed',
    });
  });

  it('formats non-Error setup preparation failures', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: ['bun install'],
        verifyCommands: [],
        envFiles: [],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    deps.processManager.spawnWithStdin = vi.fn(() => {
      throw 'spawn string failure';
    }) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute'),
    ).resolves.toEqual({
      ok: false,
      error: 'command error: bun install — spawn string failure',
    });
  });

  it('rejects env file targets that escape the worktree root', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    writeFileSync(path.join(projectPath, '.env.test'), 'SECRET=1');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: [],
        verifyCommands: [],
        envFiles: [{ source: '.env.test', target: '../outside.env', required: true }],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute'),
    ).resolves.toEqual({
      ok: false,
      error: 'env file target "../outside.env" escapes the project root',
    });
  });

  it('handles optional env files, escaped env paths, and verify setup opt-in', async () => {
    const projectPath = tempDir('project');
    const worktreePath = tempDir('worktree');
    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: ['printf setup'],
        verifyCommands: [],
        envFiles: [{ source: '.env.optional', required: false }],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'verify'),
    ).resolves.toEqual({ ok: true });
    expect(deps.processManager.spawnWithStdin).not.toHaveBeenCalled();
    expect(deps.emitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'terminal:event',
        event: expect.objectContaining({
          message: expect.stringContaining('Optional env file missing'),
        }),
      }),
    );

    mockLoadRepoSetupContract.mockReturnValue({
      path: path.join(projectPath, '.shipcode/setup.json'),
      contract: {
        version: 1,
        setupCommands: [],
        verifyCommands: [],
        envFiles: [{ source: '../outside.env', required: true }],
        setupBeforeVerify: false,
        testingContext: null,
      },
    });
    const secondRuntime = createPipelineRuntime(makeDeps().deps, {} as never);
    await expect(
      secondRuntime.prepareWorktree(makeContext({ projectPath, worktreePath }), 'execute'),
    ).resolves.toEqual({
      ok: false,
      error: 'env file source "../outside.env" escapes the project root',
    });
  });

  it('runs shell commands through the process manager and streams output', async () => {
    const { deps, emitProcess } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.runShellCommand(
      'thread-1',
      '/repo',
      'echo ok',
      new AbortController().signal,
    );

    emitProcess('output', 'other-proc', 'ignored');
    emitProcess('output', 'proc-1', 'ok\n');
    emitProcess('exit', 'proc-1', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0, output: 'ok\n' });
    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'terminal:event',
      threadId: 'thread-1',
      event: { kind: 'raw', content: 'ok\n' },
    });
  });

  it('aborts shell commands by killing the managed process', async () => {
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const abort = new AbortController();
    const promise = runtime.runShellCommand('thread-1', '/repo', 'sleep 10', abort.signal);

    abort.abort();

    await expect(promise).rejects.toThrow('Command aborted: sleep 10');
    expect(deps.processManager.kill).toHaveBeenCalledWith('proc-1');
  });

  it('times out shell commands and escalates to SIGKILL when still running', async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps();
    deps.processManager.get = vi.fn(() => ({ state: 'running' })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.runShellCommand(
      'thread-1',
      '/repo',
      'sleep 600',
      new AbortController().signal,
      { timeoutMs: 60_000 },
    );
    const rejection = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(rejection).resolves.toEqual(
      expect.objectContaining({ message: 'Command timed out after 1 minutes: sleep 600' }),
    );
    expect(deps.processManager.kill).toHaveBeenCalledWith('proc-1');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.processManager.kill).toHaveBeenCalledWith('proc-1', 'SIGKILL');
  });

  it('does not escalate timed-out shell commands after the process exits', async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps();
    deps.processManager.get = vi.fn(() => ({ state: 'exited' })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.runShellCommand(
      'thread-1',
      '/repo',
      'sleep 600',
      new AbortController().signal,
      { timeoutMs: 60_000 },
    );
    const rejection = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(rejection).resolves.toEqual(
      expect.objectContaining({ message: 'Command timed out after 1 minutes: sleep 600' }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.processManager.kill).toHaveBeenCalledTimes(1);
  });

  it('ignores late shell process events after a command has settled', async () => {
    const { deps, emitProcess } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const abort = new AbortController();
    const promise = runtime.runShellCommand('thread-1', '/repo', 'echo ok', abort.signal);

    emitProcess('exit', 'other-proc', 9);
    emitProcess('output', 'proc-1', 'ok\n');
    emitProcess('exit', 'proc-1', 0);
    emitProcess('exit', 'proc-1', 1);
    abort.abort();

    await expect(promise).resolves.toEqual({ exitCode: 0, output: 'ok\n' });
    expect(deps.processManager.kill).not.toHaveBeenCalled();
  });

  it('ignores shell abort callbacks after a command has already settled', async () => {
    const abortHandlerRef: { current?: () => void } = {};
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        abortHandlerRef.current = handler;
      }),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const { deps, emitProcess } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.runShellCommand('thread-1', '/repo', 'echo ok', signal);

    emitProcess('exit', 'proc-1', 0);
    expect(abortHandlerRef.current).toBeDefined();
    abortHandlerRef.current?.();

    await expect(promise).resolves.toEqual({ exitCode: 0, output: '' });
    expect(deps.processManager.kill).not.toHaveBeenCalled();
  });

  it('ignores duplicate shell abort callbacks after the first abort rejects', async () => {
    const abortHandlerRef: { current?: () => void } = {};
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        abortHandlerRef.current = handler;
      }),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.runShellCommand('thread-1', '/repo', 'sleep 10', signal);
    const rejection = promise.catch((error: unknown) => error);

    expect(abortHandlerRef.current).toBeDefined();
    abortHandlerRef.current?.();
    abortHandlerRef.current?.();

    await expect(rejection).resolves.toEqual(
      expect.objectContaining({ message: 'Command aborted: sleep 10' }),
    );
    expect(deps.processManager.kill).toHaveBeenCalledTimes(1);
  });

  it('ignores shell command timeout callbacks after a command has already settled', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
    const { deps, emitProcess } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const promise = runtime.runShellCommand(
      'thread-1',
      '/repo',
      'echo ok',
      new AbortController().signal,
      { timeoutMs: 60_000 },
    );

    emitProcess('exit', 'proc-1', 0);
    await expect(promise).resolves.toEqual({ exitCode: 0, output: '' });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.processManager.kill).not.toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('formats stabilization and test-fix feedback', () => {
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    const stabilization = runtime.formatStabilizationFeedback({
      prNumber: 7,
      prUrl: 'https://github.com/acme/repo/pull/7',
      failingChecks: [
        {
          workflowName: 'CI',
          name: 'test',
          status: 'failed',
          conclusion: 'failure',
          detailsUrl: 'https://ci.example/test',
        },
      ],
      unresolvedReviewComments: [
        {
          author: 'reviewer',
          body: 'Please fix this '.repeat(80),
          url: 'https://github.com/comment',
          createdAt: '2026-05-10T00:00:00.000Z',
          path: 'src/a.ts',
          line: 12,
        },
      ],
    });

    expect(stabilization).toContain('PR URL: https://github.com/acme/repo/pull/7');
    expect(stabilization).toContain('CI / test');
    expect(stabilization).toContain('reviewer');
    expect(runtime.formatTestFixFeedback('FAIL\n'.repeat(3000), 2)).toContain(
      'failed on attempt 2',
    );
  });

  it('formats minimal stabilization feedback without optional PR details', () => {
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    const feedback = runtime.formatStabilizationFeedback({
      prNumber: 8,
      prUrl: null,
      failingChecks: [],
      unresolvedReviewComments: [],
    });

    expect(feedback).toContain('linked draft PR #8');
    expect(feedback).not.toContain('PR URL:');
    expect(feedback).not.toContain('Failing checks:');
    expect(feedback).not.toContain('Unresolved review comments:');
  });

  it('formats stabilization feedback when optional check and comment fields are absent', () => {
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);

    const feedback = runtime.formatStabilizationFeedback({
      prNumber: 9,
      prUrl: null,
      failingChecks: [
        {
          workflowName: null,
          name: 'lint',
          status: 'failed',
          conclusion: null,
          detailsUrl: null,
        },
      ],
      unresolvedReviewComments: [
        {
          author: null,
          body: 'short body',
          url: '',
          createdAt: '',
          path: null,
          line: null,
        },
      ],
    });

    expect(feedback).toContain('- lint');
    expect(feedback).toContain('- Review comment: short body');
    expect(feedback).not.toContain('PR URL:');
  });

  it('records provider phase telemetry and token usage on success', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({
        rawOutput: 'done',
        exitCode: 0,
        resolvedModel: 'claude-opus',
        tokensUsed: { prompt: 10, completion: 5 },
        costUsd: 0.01,
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext({
      runId: 'run-1',
      promptMaterialSummaries: { plan: { totalMaterials: 0 } } as never,
    });

    const result = await runtime.runProviderPhase(context, 'plan', 'prompt', [], {});

    expect(result.rawOutput).toBe('done');
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'plan',
        prompt: 'prompt',
        cwd: '/repo-worktree',
        modelHint: undefined,
        workspaceRoot: DEFAULT_SETTINGS.worktreeRoot,
      }),
    );
    expect(deps.threads.setResolvedModel).toHaveBeenCalledWith('thread-1', 'plan', 'claude-opus');
    expect(deps.threads.addTokenUsage).toHaveBeenCalledWith('thread-1', 10, 5, 0.01);
    expect(deps.pipelineSteps?.start).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', runId: 'run-1', phase: 'plan' }),
    );
    expect(deps.agentConversations?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', runId: 'run-1', role: 'prompt' }),
    );
    expect(deps.promptTelemetry?.create).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', runId: 'run-1', phase: 'plan' }),
    );
  });

  it('passes executor model overrides and omits workspace roots outside worktrees', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['execute']),
      generate: vi.fn(async (request) => ({
        rawOutput: JSON.stringify({
          cwd: request.cwd,
          modelHint: request.modelHint,
          workspaceRoot: 'workspaceRoot' in request ? request.workspaceRoot : null,
          maxTurns: request.phaseHints?.maxTurns ?? null,
        }),
        exitCode: 0,
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    const result = await runtime.runProviderPhase(
      makeContext({
        worktreePath: null,
        executorModelOverride: 'claude-sonnet',
      }),
      'execute',
      'prompt',
      [],
      {},
    );

    expect(JSON.parse(result.rawOutput)).toEqual({
      cwd: '/repo',
      modelHint: 'claude-sonnet',
      workspaceRoot: null,
      maxTurns: null,
    });
  });

  it('passes revision model hints with planner turn limits', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['revision']),
      generate: vi.fn(async (request) => ({
        rawOutput: JSON.stringify({
          modelHint: request.modelHint,
          maxTurns: request.phaseHints?.maxTurns,
        }),
        exitCode: 0,
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    const result = await runtime.runProviderPhase(
      makeContext({ plannerModelIdOverride: 'claude-opus' }),
      'revision',
      'prompt',
      [],
      {},
    );

    expect(JSON.parse(result.rawOutput)).toEqual({
      modelHint: 'claude-opus',
      maxTurns: 1,
    });
  });

  it('keeps provider success nonfatal when step completion logging fails', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({
        rawOutput: 'done',
        exitCode: 0,
        resolvedModel: 'claude-opus',
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const pipelineSteps = {
      start: vi.fn(() => ({ id: 'step-1' })),
      complete: vi.fn(() => {
        throw new Error('step complete offline');
      }),
    };
    deps.pipelineSteps = pipelineSteps as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.runProviderPhase(makeContext(), 'plan', 'prompt', [], {}),
    ).resolves.toEqual(expect.objectContaining({ rawOutput: 'done', exitCode: 0 }));
    expect(pipelineSteps.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('provides GitHub GraphQL token/default repo helpers and terminal forwarding to providers', async () => {
    mockGhCli.getRepoMetadata.mockResolvedValue({ githubRepoFullName: 'acme/widgets' });
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async (request) => {
        request.onTerminalEvent?.({ kind: 'raw', content: 'provider output' });
        return {
          rawOutput: JSON.stringify({
            token: await request.githubGraphql?.getToken(),
            repo: await request.githubGraphql?.getDefaultRepo(),
          }),
          exitCode: 0,
        };
      }),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    const result = await runtime.runProviderPhase(makeContext(), 'plan', 'prompt', [], {});

    expect(JSON.parse(result.rawOutput)).toEqual({
      token: 'gh-token',
      repo: { owner: 'acme', repo: 'widgets' },
    });
    expect(mockExecFile).toHaveBeenCalledWith('gh', ['auth', 'token'], expect.any(Function));
    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'terminal:event',
      threadId: 'thread-1',
      event: { kind: 'raw', content: 'provider output' },
    });
  });

  it('returns null provider GitHub helpers when auth or repo metadata are unavailable', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _command: string,
        _args: string[],
        callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('not logged in'));
      },
    );
    mockGhCli.getRepoMetadata
      .mockResolvedValueOnce({ githubRepoFullName: 'missing-slash' })
      .mockRejectedValueOnce(new Error('metadata failed'));
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async (request) => ({
        rawOutput: JSON.stringify({
          token: await request.githubGraphql?.getToken(),
          invalidRepo: await request.githubGraphql?.getDefaultRepo(),
          failedRepo: await request.githubGraphql?.getDefaultRepo(),
        }),
        exitCode: 0,
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    const result = await runtime.runProviderPhase(makeContext(), 'plan', 'prompt', [], {});

    expect(JSON.parse(result.rawOutput)).toEqual({
      token: null,
      invalidRepo: null,
      failedRepo: null,
    });
  });

  it('returns null provider GitHub tokens when gh auth emits only whitespace', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _command: string,
        _args: string[],
        callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '   \n', stderr: '' });
      },
    );
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async (request) => ({
        rawOutput: JSON.stringify({ token: await request.githubGraphql?.getToken() }),
        exitCode: 0,
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    const result = await runtime.runProviderPhase(makeContext(), 'plan', 'prompt', [], {});

    expect(JSON.parse(result.rawOutput)).toEqual({ token: null });
  });

  it('records provider non-zero exits as failed steps', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['verify']),
      generate: vi.fn(async () => ({
        rawOutput: 'bad',
        exitCode: 1,
        resolvedModel: 'claude-opus',
        providerError: { kind: 'rate_limit' as const, message: 'slow down', retryable: true },
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    await runtime.runProviderPhase(makeContext(), 'verify', 'prompt', [], {});

    expect(deps.pipelineSteps?.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'failed',
        errorKind: 'rate_limit',
        errorMessage: 'slow down',
      }),
    );
  });

  it('records provider-aborted non-zero exits as aborted steps', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['verify']),
      generate: vi.fn(async () => ({
        rawOutput: 'aborted',
        exitCode: 1,
        providerError: { kind: 'aborted' as const, message: 'stopped', retryable: false },
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);

    await runtime.runProviderPhase(makeContext(), 'verify', 'prompt', [], {});

    expect(deps.pipelineSteps?.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'aborted',
        errorKind: 'aborted',
        errorMessage: 'stopped',
      }),
    );
  });

  it('treats aborted provider exceptions as aborted step logs', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['execute']),
      generate: vi.fn(async () => {
        throw new Error('AbortError: stopped');
      }),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();
    context.abort.abort();

    await expect(runtime.runProviderPhase(context, 'execute', 'prompt', [], {})).rejects.toThrow(
      'AbortError',
    );
    expect(deps.pipelineSteps?.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'aborted',
        errorKind: 'aborted',
      }),
    );
  });

  it('keeps provider success nonfatal when logging and telemetry persistence fail', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({
        rawOutput: 'done',
        exitCode: 0,
        resolvedModel: 'claude-sonnet',
        tokensUsed: { prompt: 1, completion: 2 },
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    deps.pipelineSteps = {
      start: vi.fn(() => {
        throw new Error('step start offline');
      }),
      complete: vi.fn(),
    } as never;
    deps.agentConversations = {
      insert: vi.fn(() => {
        throw new Error('conversation offline');
      }),
    } as never;
    deps.promptTelemetry = {
      create: vi.fn(() => {
        throw new Error('telemetry offline');
      }),
    } as never;
    deps.threads.setResolvedModel = vi.fn(() => {
      throw new Error('model write offline');
    }) as never;
    deps.threads.addTokenUsage = vi.fn(() => {
      throw new Error('usage write offline');
    }) as never;
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await expect(runtime.runProviderPhase(context, 'plan', 'prompt', [], {})).resolves.toEqual(
      expect.objectContaining({ rawOutput: 'done', exitCode: 0 }),
    );
    expect(context.promptTelemetryDiagnostics).toContainEqual(
      expect.objectContaining({ phase: 'plan', message: 'telemetry offline', nonFatal: true }),
    );
    expect(deps.emitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pipeline:model-resolved',
        resolvedModel: 'claude-sonnet',
      }),
    );
  });

  it('records non-Error prompt telemetry failures as nonfatal diagnostics', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({
        rawOutput: 'done',
        exitCode: 0,
      })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    deps.promptTelemetry = {
      create: vi.fn(() => {
        throw 'telemetry string failure';
      }),
    } as never;
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await expect(runtime.runProviderPhase(context, 'plan', 'prompt', [], {})).resolves.toEqual(
      expect.objectContaining({ rawOutput: 'done', exitCode: 0 }),
    );

    expect(context.promptTelemetryDiagnostics).toContainEqual({
      phase: 'plan',
      message: 'telemetry string failure',
      nonFatal: true,
    });
  });

  it('runProviderPhaseCore does not mutate context and returns telemetry deltas', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({ rawOutput: 'done', exitCode: 0 })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();
    const input = snapshotProviderPhaseInput(context, 'plan');

    const result = await runtime.runProviderPhaseCore(input, 'plan', 'prompt', [], {});

    // The pure core leaves the mutable context untouched...
    expect(context.promptTelemetry).toHaveLength(0);
    expect(context.promptTelemetryDiagnostics).toHaveLength(0);
    // ...and surfaces the mutation it would have made as deltas instead.
    expect(result.deltas.promptTelemetry).toBeDefined();
    expect(result.deltas.diagnosticEntry).toBeNull();
  });

  it('runProviderPhase wrapper applies the telemetry delta to context', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({ rawOutput: 'done', exitCode: 0 })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await runtime.runProviderPhase(context, 'plan', 'prompt', [], {});

    expect(context.promptTelemetry).toHaveLength(1);
  });

  it('threads the post-push telemetry counter into invocationId and attempt', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({ rawOutput: 'done', exitCode: 0 })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();
    // One prior telemetry entry → this invocation is attempt 2.
    context.promptTelemetry.push({} as never);

    await runtime.runProviderPhase(context, 'plan', 'prompt', [], {});

    expect(deps.promptTelemetry?.create).toHaveBeenCalledWith(
      expect.objectContaining({ invocationId: 'thread-1:plan:2', attempt: 2 }),
    );
    // Wrapper appended this invocation's entry on top of the pre-seeded one.
    expect(context.promptTelemetry).toHaveLength(2);
  });

  it('runProviderPhaseCore returns a diagnostic delta without mutating context', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['plan']),
      generate: vi.fn(async () => ({ rawOutput: 'done', exitCode: 0 })),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    deps.promptTelemetry = {
      create: vi.fn(() => {
        throw new Error('telemetry offline');
      }),
    } as never;
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();
    const input = snapshotProviderPhaseInput(context, 'plan');

    const result = await runtime.runProviderPhaseCore(input, 'plan', 'prompt', [], {});

    expect(result.deltas.diagnosticEntry).toEqual({
      phase: 'plan',
      message: 'telemetry offline',
      nonFatal: true,
    });
    expect(context.promptTelemetryDiagnostics).toHaveLength(0);
  });

  it('keeps provider exception handling nonfatal when error logging fails', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['execute']),
      generate: vi.fn(async () => {
        throw new Error('provider exploded');
      }),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    deps.agentConversations = {
      insert: vi.fn(() => {
        throw new Error('conversation write failed');
      }),
    } as never;
    deps.pipelineSteps = {
      start: vi.fn(() => ({ id: 'step-1' })),
      complete: vi.fn(() => {
        throw new Error('step complete failed');
      }),
    } as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.runProviderPhase(makeContext(), 'execute', 'prompt', [], {}),
    ).rejects.toThrow('provider exploded');
  });

  it('queues GitHub project status and pipeline label sync on phase changes', async () => {
    mockGhCli.getIssue.mockResolvedValue({
      labels: ['shipcode:pipeline:planning', 'bug'],
    });
    mockGhCli.setIssueProjectMetadata.mockResolvedValue(undefined);
    mockGhCli.setIssueLabelPresence.mockResolvedValue(undefined);
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'planning',
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({
      id: 'issue-1',
    })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo' },
        inProgress: { name: 'In Progress' },
        humanReview: { name: 'Human Review' },
        done: { name: 'Done' },
      },
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'executing');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: { status: 'In Progress' },
    });
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:planning',
      false,
    );
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:executing',
      true,
    );
  });

  it('swallows GitHub project and label sync failures', async () => {
    mockGhCli.setIssueProjectMetadata.mockRejectedValue(new Error('project offline'));
    mockGhCli.getIssue.mockRejectedValue(new Error('issue offline'));
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'planning',
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({ id: 'issue-1' })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo' },
        inProgress: { name: 'In Progress' },
        humanReview: { name: 'Human Review' },
        done: { name: 'Done' },
      },
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'executing');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalled();
    expect(mockGhCli.getIssue).toHaveBeenCalledWith(42);
  });

  it.each([
    ['todo', 'Todo'],
    ['approval', 'Human Review'],
    ['completed', 'Done'],
  ] as const)('syncs GitHub project status mapping for %s phases', async (phase, statusName) => {
    mockGhCli.getIssue.mockResolvedValue({ labels: [] });
    mockGhCli.setIssueProjectMetadata.mockResolvedValue(undefined);
    mockGhCli.setIssueLabelPresence.mockResolvedValue(undefined);
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: phase,
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({ id: 'issue-1' })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo' },
        inProgress: { name: 'In Progress' },
        humanReview: { name: 'Human Review' },
        done: { name: 'Done' },
      },
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', phase as never);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: { status: statusName },
    });
  });

  it('skips GitHub project metadata writes when no mapped status name exists', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: [] });
    mockGhCli.setIssueProjectMetadata.mockResolvedValue(undefined);
    mockGhCli.setIssueLabelPresence.mockResolvedValue(undefined);
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'executing',
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({ id: 'issue-1' })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {},
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'executing');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).not.toHaveBeenCalled();
    expect(mockGhCli.getIssue).toHaveBeenCalledWith(42);
  });

  it('keeps the current GitHub pipeline label when it already matches the emitted phase', async () => {
    mockGhCli.getIssue.mockResolvedValue({
      labels: ['shipcode:pipeline:executing', 'enhancement'],
    });
    mockGhCli.setIssueProjectMetadata.mockResolvedValue(undefined);
    mockGhCli.setIssueLabelPresence.mockResolvedValue(undefined);
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'executing',
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({ id: 'issue-1' })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        inProgress: { name: 'In Progress' },
      },
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'executing');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledTimes(1);
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:executing',
      true,
    );
  });

  it('syncs pipeline labels even when GitHub project status mapping is not configured', async () => {
    mockGhCli.getIssue.mockResolvedValue({
      labels: ['shipcode:pipeline:queued', 'enhancement'],
    });
    mockGhCli.setIssueLabelPresence.mockResolvedValue(undefined);
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'executing',
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({ id: 'issue-1' })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: null,
      githubStatusMapping: null,
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'paused');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).not.toHaveBeenCalled();
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:queued',
      false,
    );
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:paused',
      true,
    );
  });

  it('logs queued GitHub sync writer failures', async () => {
    vi.mocked(GhCli).mockImplementationOnce(function GhCli() {
      throw new Error('gh unavailable');
    } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = makeDeps();
    deps.threads.getById = vi.fn(() => ({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'planning',
    })) as never;
    deps.githubIssues.getByNumber = vi.fn(() => ({ id: 'issue-1' })) as never;
    deps.projects.getById = vi.fn(() => ({
      id: 'project-1',
      path: '/repo',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo' },
        inProgress: { name: 'In Progress' },
        humanReview: { name: 'Human Review' },
        done: { name: 'Done' },
      },
    })) as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'executing');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warn).toHaveBeenCalledWith(
      '[gh-status-sync] queued write failed',
      expect.objectContaining({ message: 'gh unavailable' }),
    );
  });

  it('swallows phase log transition failures before syncing thread state', () => {
    const { deps } = makeDeps();
    const phaseLogs = {
      transition: vi.fn(() => {
        throw new Error('phase log offline');
      }),
    };
    deps.phaseLogs = phaseLogs as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    runtime.emitPhase('thread-1', 'executing');

    expect(phaseLogs.transition).toHaveBeenCalledWith('thread-1', 'executing', null);
    expect(deps.threads.updateStatus).toHaveBeenCalledWith('thread-1', 'executing');
    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'executing',
    });
  });

  it('creates resumed runs with retry lineage from the latest prior run', () => {
    const { deps } = makeDeps();
    const context = makeContext({ runId: null });
    const pipelineRuns = {
      getCurrentForThread: vi.fn(() => null),
      listByThread: vi.fn(() => [{ id: 'run-old' }]),
      create: vi.fn(() => ({ id: 'run-new' })),
      start: vi.fn(),
      setPhase: vi.fn(),
      finish: vi.fn(),
      claimIssueExecution: vi.fn(),
    };
    deps.pipelineRuns = pipelineRuns as never;
    const runtime = createPipelineRuntime(deps, {
      activePipelines: new Map([['thread-1', context]]),
    } as never);

    runtime.emitPhase('thread-1', 'executing');

    expect(pipelineRuns.create).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', retryOfRunId: 'run-old' }),
    );
    expect(context.runId).toBe('run-new');
    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'executing',
      runId: 'run-new',
    });
  });

  it('records failed provider steps and rethrows provider exceptions', async () => {
    const provider: AgentProvider = {
      id: 'claude-cli',
      supports: new Set(['execute']),
      generate: vi.fn(async () => {
        throw new Error('provider exploded');
      }),
      healthCheck: vi.fn(async () => ({ ok: true })),
    };
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await expect(runtime.runProviderPhase(context, 'execute', 'prompt', [], {})).rejects.toThrow(
      'provider exploded',
    );
    expect(deps.pipelineSteps?.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'provider exploded',
      }),
    );
    expect(deps.agentConversations?.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'response',
        content: '[error] provider exploded',
      }),
    );
  });

  it('posts plan and task graph comments for real GitHub issues', async () => {
    mockGhCli.createIssue.mockResolvedValue({ number: 101 });
    mockGhCli.upsertIssueCommentByMarker.mockResolvedValue(undefined);
    mockGhCli.closeIssue.mockResolvedValue(undefined);
    mockGhCli.reopenIssue.mockResolvedValue(undefined);
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'github-subissues',
      status: 'active',
      riskScore: 0.4,
      assessment: {
        mode: 'github-subissues',
        shouldDecompose: true,
        riskScore: 0.4,
        reasons: ['two tasks'],
        suggestedNodeCount: 2,
        surfaces: [],
      },
      nodes: [
        {
          id: 'node-1',
          stableKey: 'step-1',
          title: 'Done node',
          description: 'done',
          status: 'completed',
          githubIssueNumber: null,
          order: 1,
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedReasoningEffort: 'medium',
        },
        {
          id: 'node-2',
          stableKey: 'step-2',
          title: 'Open node',
          description: 'open',
          status: 'in_progress',
          githubIssueNumber: 102,
          order: 2,
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedReasoningEffort: 'medium',
        },
      ],
      edges: [],
    };
    const updatedGraph = {
      ...graph,
      nodes: [{ ...graph.nodes[0], githubIssueNumber: 101 }, graph.nodes[1]],
    };
    const { deps } = makeDeps();
    const taskGraphs = {
      updateNodeGithubIssueNumber: vi.fn(() => updatedGraph),
    };
    deps.taskGraphs = taskGraphs as never;
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await runtime.postPlanComment(context, {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      objective: 'Ship it',
      files: [],
      steps: [],
      acceptanceCriteria: [],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    });
    await runtime.postTaskGraphComment(context, graph as never);

    expect(mockGhCli.addIssueComment).toHaveBeenCalledWith(42, expect.stringContaining('Ship it'));
    expect(mockGhCli.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ title: '[step-1] Done node' }),
    );
    expect(taskGraphs.updateNodeGithubIssueNumber).toHaveBeenCalledWith('node-1', 101);
    expect(mockGhCli.closeIssue).toHaveBeenCalledWith(101);
    expect(mockGhCli.reopenIssue).toHaveBeenCalledWith(102);
    expect(mockGhCli.upsertIssueCommentByMarker).toHaveBeenCalled();
  });

  it('swallows task subissue open-state sync failures', async () => {
    mockGhCli.createIssue.mockResolvedValue({ number: 101 });
    mockGhCli.upsertIssueCommentByMarker.mockResolvedValue(undefined);
    mockGhCli.closeIssue.mockRejectedValue(new Error('close failed'));
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'github-subissues',
      status: 'active',
      riskScore: 0,
      assessment: {
        mode: 'github-subissues',
        shouldDecompose: true,
        riskScore: 0,
        reasons: [],
        suggestedNodeCount: 1,
        surfaces: [],
      },
      nodes: [
        {
          id: 'node-1',
          stableKey: 'step-1',
          title: 'Done node',
          description: 'done',
          status: 'completed',
          githubIssueNumber: 101,
          order: 1,
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedReasoningEffort: 'medium',
        },
      ],
      edges: [],
    };
    const { deps } = makeDeps();
    deps.taskGraphs = {
      updateNodeGithubIssueNumber: vi.fn(),
    } as never;
    const runtime = createPipelineRuntime(deps, {} as never);

    await expect(
      runtime.postTaskGraphComment(makeContext(), graph as never),
    ).resolves.toBeUndefined();

    expect(mockGhCli.closeIssue).toHaveBeenCalledWith(101);
    expect(mockGhCli.upsertIssueCommentByMarker).toHaveBeenCalled();
  });

  it('skips task subissue status sync for nodes without real issue numbers', async () => {
    mockGhCli.upsertIssueCommentByMarker.mockResolvedValue(undefined);
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'github-subissues',
      status: 'active',
      riskScore: 0,
      assessment: {
        mode: 'github-subissues',
        shouldDecompose: true,
        riskScore: 0,
        reasons: [],
        suggestedNodeCount: 1,
        surfaces: [],
      },
      nodes: [
        {
          id: 'node-1',
          stableKey: 'step-1',
          title: 'No issue node',
          description: 'skip',
          status: 'completed',
          githubIssueNumber: null,
          order: 1,
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedReasoningEffort: 'medium',
        },
      ],
      edges: [],
    };
    const { deps } = makeDeps();
    deps.taskGraphs = undefined;
    const runtime = createPipelineRuntime(deps, {} as never);

    await runtime.postTaskGraphComment(makeContext(), graph as never);

    expect(mockGhCli.closeIssue).not.toHaveBeenCalled();
    expect(mockGhCli.reopenIssue).not.toHaveBeenCalled();
    expect(mockGhCli.upsertIssueCommentByMarker).toHaveBeenCalled();
  });

  it('skips and swallows GitHub comment posting edge cases', async () => {
    const { deps } = makeDeps();
    const runtime = createPipelineRuntime(deps, {} as never);
    await runtime.postPlanComment(makeContext({ githubIssueNumber: null }), {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      objective: 'Skip',
      files: [],
      steps: [],
      acceptanceCriteria: [],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    });
    expect(mockGhCli.addIssueComment).not.toHaveBeenCalled();

    mockGhCli.addIssueComment.mockRejectedValue(new Error('comment failed'));
    await expect(
      runtime.postPlanComment(makeContext(), {
        id: 'plan-1',
        threadId: 'thread-1',
        version: 1,
        objective: 'Fail quietly',
        files: [],
        steps: [],
        acceptanceCriteria: [],
        outOfScope: [],
        estimatedComplexity: 'low',
        dependencies: [],
      }),
    ).resolves.toBeUndefined();

    mockGhCli.upsertIssueCommentByMarker.mockRejectedValue(new Error('graph comment failed'));
    await expect(
      runtime.postTaskGraphComment(makeContext(), {
        id: 'graph-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        mode: 'direct',
        status: 'active',
        riskScore: 0,
        assessment: {
          mode: 'direct',
          shouldDecompose: false,
          riskScore: 0,
          reasons: [],
          suggestedNodeCount: 1,
          surfaces: [],
        },
        nodes: [],
        edges: [],
      } as never),
    ).resolves.toBeUndefined();
  });

  it('records provider failures without Error instances or provider metadata', async () => {
    const provider = {
      id: 'stub-provider',
      generate: vi.fn(async () => {
        throw 'provider string failure';
      }),
    } as unknown as AgentProvider;
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await expect(runtime.runProviderPhase(context, 'plan', 'prompt', [], {})).rejects.toBe(
      'provider string failure',
    );

    expect(deps.pipelineSteps?.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'failed',
        errorKind: 'unknown',
        errorMessage: 'provider string failure',
      }),
    );
    expect(deps.agentConversations?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ content: '[error] provider string failure' }),
    );
  });

  it('records nonzero provider exits without providerError details', async () => {
    const provider = {
      id: 'stub-provider',
      generate: vi.fn(async () => ({
        rawOutput: 'failed',
        exitCode: 2,
      })),
    } as unknown as AgentProvider;
    const { deps } = makeDeps(provider);
    const runtime = createPipelineRuntime(deps, {} as never);
    const context = makeContext();

    await expect(runtime.runProviderPhase(context, 'execute', 'prompt', [], {})).resolves.toEqual(
      expect.objectContaining({ rawOutput: 'failed', exitCode: 2 }),
    );

    expect(deps.pipelineSteps?.complete).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'failed',
        errorKind: 'unknown',
        errorMessage: null,
        resolvedModel: null,
      }),
    );
  });
});
