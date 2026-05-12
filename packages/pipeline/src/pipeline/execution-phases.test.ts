import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import {
  buildContinuationPrompt,
  buildTestFailureFingerprint,
  createExecutionPhaseHandlers,
  extractExecutionErrorSnippet,
  extractImplicatedFiles,
  extractTestFailureSummary,
  normalizeFeatureQaResults,
  resolveWorktreeDiffBase,
  worktreeHasChanges,
} from './execution-phases';
import type { PipelineContextHelpers, PipelinePhaseHandlers, PipelineRuntime } from './shared';

const { mockExecFileSync } = vi.hoisted(() => ({ mockExecFileSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

const plan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Ship it',
  files: [],
  steps: [],
  acceptanceCriteria: ['works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
};

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    threadId: 'thread-1',
    projectPath: '/repo',
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
    forkPointSha: 'base',
    activeProcessId: null,
    cancelled: false,
    verifiedSha: null,
    startedAt: 1,
    repoContext: null,
    repoPromptMaterials: [],
    phasePromptScopes: {
      plan: { mode: 'full' },
      review: { mode: 'full' },
      revision: { mode: 'full' },
      execute: { mode: 'full' },
      verify: { mode: 'full' },
    } as never,
    phaseReasoningOverrides: {},
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

function makeExecutionHarness(context = makeContext()) {
  const activePipelines = new Map([[context.threadId, context]]);
  const emit = vi.fn();
  const deps = {
    settings: {
      get: vi.fn(() => ({
        maxConcurrentExecutions: 1,
        maxConcurrentCpuTasks: 1,
      })),
    },
    emitter: { emit },
    verifications: { getLatest: vi.fn(() => null) },
    plans: {
      getLatest: vi.fn(() => ({
        id: 'plan-record-1',
        status: 'approved',
        structured: plan,
      })),
    },
    threads: {
      getById: vi.fn(() => ({ id: 'thread-1', prompt: 'Prompt', title: 'Thread title' })),
    },
    checkpoints: {
      getLatest: vi.fn(() => null),
      create: vi.fn(),
    },
    projectFailures: null,
    cpuTaskGate: undefined,
  } as unknown as {
    plans: { getLatest: ReturnType<typeof vi.fn> };
    settings: { get: ReturnType<typeof vi.fn> };
    emitter: { emit: ReturnType<typeof vi.fn> };
    projectFailures: unknown;
  };
  const contextHelpers = {
    activePipelines,
    listActive: vi.fn(() => []),
    listActiveInPhases: vi.fn(() => []),
    skillCallSite: vi.fn(() => ({
      context: { projectId: context.projectId },
      deps: { skills: { get: vi.fn(() => null) }, onFallback: vi.fn(), onResolved: vi.fn() },
    })),
  } as unknown as PipelineContextHelpers;
  const runtime = {
    emitPhase: vi.fn((threadId: string, phase: string, error?: string) => {
      emit({ type: 'pipeline:phase', threadId, phase, error });
    }),
    emitTerminalLifecycle: vi.fn(),
    ensureRepoSetupContract: vi.fn(() => null),
    prepareWorktree: vi.fn(async () => ({ ok: true })),
    getVerifyCommands: vi.fn(() => []),
    getTestingContext: vi.fn(() => null),
    formatTestFixFeedback: vi.fn(
      (testOutput: string, attempt: number) => `Tests failed on attempt ${attempt}\n${testOutput}`,
    ),
    runShellCommand: vi.fn(),
    runProviderPhase: vi.fn(async () => ({ rawOutput: 'done', exitCode: 0 })),
    postTaskGraphComment: vi.fn(),
  } as unknown as PipelineRuntime;
  const handlers = {
    startExecution: vi.fn(),
    startTesting: vi.fn(),
    startVerification: vi.fn(),
  } as unknown as PipelinePhaseHandlers;
  const phaseHandlers = createExecutionPhaseHandlers({
    deps: deps as never,
    contextHelpers,
    runtime,
    handlers,
  });
  Object.assign(handlers, phaseHandlers);
  return { activePipelines, context, contextHelpers, deps, handlers, runtime };
}

describe('extractExecutionErrorSnippet', () => {
  it('returns empty when transcript ends with a shipcode-plan fence', () => {
    const raw = [
      'Some interim chatter',
      '```shipcode-plan',
      '{',
      '  "id": "plan-20260427T154500Z-issue56",',
      '  "threadId": "uKKI_0AnxPOjlKaSwMCkK",',
      '  "objective": "thing"',
      '}',
      '```',
    ].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Some interim chatter');
  });

  it('skips JSON-looking fields and finds the previous plain-text execution error', () => {
    const raw = ['Real failure message', '"result": "structured field"', ']', '}'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Real failure message');
  });

  it('extracts a structured error from a streaming JSON event', () => {
    const raw = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","is_error":true,"result":"Tool call denied: write file"}',
    ].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Tool call denied: write file');
  });

  it('skips malformed JSON events while scanning for execution errors', () => {
    const raw = ['Plain failure after malformed event', '{"type":"result",'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Plain failure after malformed event');
  });

  it('extracts subtype error streaming events', () => {
    const raw = '{"type":"result","subtype":"error","result":"Sandbox denied write"}';
    expect(extractExecutionErrorSnippet(raw)).toBe('Sandbox denied write');
  });

  it('extracts a top-level error field when present', () => {
    const raw = '{"error":"ENOENT: missing repo"}';
    expect(extractExecutionErrorSnippet(raw)).toBe('ENOENT: missing repo');
  });

  it('skips bare JSON braces and returns the last plain-text line', () => {
    const raw = ['Network timeout while pushing branch', '{', '  "type": "result"', '}'].join('\n');
    expect(extractExecutionErrorSnippet(raw)).toBe('Network timeout while pushing branch');
  });

  it('caps snippet at 280 characters', () => {
    const long = `${'x'.repeat(400)}`;
    expect(extractExecutionErrorSnippet(long).length).toBe(280);
  });

  it('returns empty when no usable text remains', () => {
    expect(extractExecutionErrorSnippet('```\n```\n{}\n[]\n')).toBe('');
  });
});

describe('execution phase helpers', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('builds default and custom continuation prompts', () => {
    const context = {
      turnCount: 3,
      workflowPolicy: {
        continuationPromptTemplate: null,
      },
    } as PipelineContext;

    expect(buildContinuationPrompt(context, 'Verifier failed')).toContain(
      'Prior failure reason: Verifier failed',
    );

    context.workflowPolicy.continuationPromptTemplate =
      'Turn {{ turn_count }}: {{ prior_failure_reason }}';
    expect(buildContinuationPrompt(context, 'Fix tests')).toBe('Turn 3: Fix tests');

    context.workflowPolicy.continuationPromptTemplate = 'No variables here';
    expect(buildContinuationPrompt(context, 'Ignored')).toBe('No variables here');
  });

  it('normalizes feature QA result evidence paths', () => {
    expect(
      normalizeFeatureQaResults([
        {
          flowId: 'flow-0',
          passed: true,
          summary: 'missing evidence',
        },
        {
          flowId: 'flow-1',
          passed: true,
          summary: 'ok',
          evidencePaths: null,
        },
        {
          flowId: 'flow-2',
          passed: false,
          summary: 'bad',
          evidencePaths: ['shot.png'],
        },
      ] as never),
    ).toEqual([
      {
        flowId: 'flow-0',
        passed: true,
        summary: 'missing evidence',
        evidencePaths: undefined,
      },
      {
        flowId: 'flow-1',
        passed: true,
        summary: 'ok',
        evidencePaths: undefined,
      },
      {
        flowId: 'flow-2',
        passed: false,
        summary: 'bad',
        evidencePaths: ['shot.png'],
      },
    ]);
  });

  it('extracts test failure summaries across common runners', () => {
    expect(extractTestFailureSummary('')).toBe('Tests failed (no output captured)');
    expect(extractTestFailureSummary('  FAIL packages/foo.test.ts\nstack')).toBe(
      'FAIL packages/foo.test.ts',
    );
    expect(extractTestFailureSummary('  × packages/foo.test.ts > breaks')).toBe(
      '× packages/foo.test.ts > breaks',
    );
    expect(extractTestFailureSummary('done\n2 failed, 1 passed')).toBe('2 failed, 1 passed');
    expect(extractTestFailureSummary('done\n1 error, 3 passed')).toBe('1 error, 3 passed');
    expect(extractTestFailureSummary('--- FAIL: TestFoo (0.01s)')).toBe(
      '--- FAIL: TestFoo (0.01s)',
    );
    expect(extractTestFailureSummary('noise\nError: bad thing')).toBe('Error: bad thing');
    expect(extractTestFailureSummary('noise\nlast line')).toBe('last line');
    expect(extractTestFailureSummary(`${'x'.repeat(400)}`)).toHaveLength(280);
  });

  it('extracts implicated test files and fingerprints stable failure output', () => {
    expect(
      extractImplicatedFiles(
        './packages/foo/src/a.test.ts packages/foo/src/a.test.ts apps/web/b.spec.tsx src/c.ts',
      ),
    ).toEqual(['packages/foo/src/a.test.ts', 'apps/web/b.spec.tsx']);

    const first = buildTestFailureFingerprint(
      'bun test',
      'FAIL packages/foo.test.ts\nAssertionError: no at file.ts:12:4\nDuration 41ms',
    );
    const second = buildTestFailureFingerprint(
      'bun test',
      'FAIL packages/foo.test.ts\nAssertionError: no at file.ts:99:1\nDuration 2s',
    );

    expect(first.summary).toBe('FAIL packages/foo.test.ts');
    expect(first.implicatedFiles).toEqual(['packages/foo.test.ts']);
    expect(first.outputExcerpt).toContain('AssertionError');
    expect(first.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(extractImplicatedFiles('no test files mentioned')).toEqual([]);
  });

  it('detects worktree changes from status, fork-point diff, and git failures', () => {
    const context = {
      projectPath: '/project',
      worktreePath: '/worktree',
      forkPointSha: 'base',
    } as PipelineContext;

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return ' M src/a.ts\n';
      return '';
    });
    expect(worktreeHasChanges(context)).toBe(true);

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      if (args[0] === 'diff') return 'src/a.ts\n';
      return '';
    });
    expect(worktreeHasChanges(context)).toBe(true);

    mockExecFileSync.mockImplementation(() => '');
    expect(worktreeHasChanges(context)).toBe(false);
    expect(worktreeHasChanges({ projectPath: '/project' } as PipelineContext)).toBe(false);
    expect(
      worktreeHasChanges({ projectPath: '/project', forkPointSha: 'base' } as PipelineContext),
    ).toBe(false);

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'merge-base') return 'merge-base-sha\n';
      if (args[0] === 'diff' && args.includes('merge-base-sha..HEAD')) return 'src/a.ts\n';
      return '';
    });
    expect(
      worktreeHasChanges({
        projectPath: '/project',
        forkPointSha: '',
        baseBranch: 'main',
      } as PipelineContext),
    ).toBe(true);

    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(
      worktreeHasChanges({ projectPath: '/project', forkPointSha: '' } as PipelineContext),
    ).toBe(true);
  });

  it('resolves a diff base from fork point, base branch merge-base, then previous commit', () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'base^{commit}') return 'base\n';
      return '';
    });
    expect(
      resolveWorktreeDiffBase({
        projectPath: '/project',
        forkPointSha: 'base',
      } as PipelineContext),
    ).toBe('base');

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'merge-base' && args[1] === 'main') return 'merge-base-sha\n';
      return '';
    });
    expect(
      resolveWorktreeDiffBase({
        projectPath: '/project',
        forkPointSha: '',
        baseBranch: 'main',
      } as PipelineContext),
    ).toBe('merge-base-sha');

    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[2] === 'stale^{commit}') {
        throw new Error('missing fork point');
      }
      if (args[0] === 'merge-base') throw new Error('missing base');
      if (args[0] === 'rev-parse' && args[1] === 'HEAD~1') return 'parent-sha\n';
      return '';
    });
    expect(
      resolveWorktreeDiffBase({
        projectPath: '/project',
        forkPointSha: 'stale',
        baseBranch: 'missing',
      } as PipelineContext),
    ).toBe('parent-sha');
  });
});

describe('execution phase handlers', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockExecFileSync.mockReset();
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      if (args[0] === 'status') return ' M src/a.ts\n';
      return '';
    });
  });

  it('queues testing when CPU slots are busy and cancellation suppresses the retry callback', async () => {
    vi.useFakeTimers();
    const context = makeContext();
    const harness = makeExecutionHarness(context);
    vi.mocked(harness.contextHelpers.listActiveInPhases).mockReturnValue([
      {
        threadId: 'other-thread',
        projectId: 'project-1',
        projectPath: '/repo',
        phase: 'testing',
      },
    ] as never);
    vi.mocked(harness.runtime.getVerifyCommands).mockReturnValue(['bun test']);

    await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.emitTerminalLifecycle).toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('CPU-heavy task slots are busy'),
    );
    expect(context.retryTimer).not.toBeNull();

    context.cancelled = true;
    await vi.runOnlyPendingTimersAsync();

    expect(harness.runtime.emitPhase).not.toHaveBeenCalledWith('thread-1', 'testing');
  });

  it('routes selector-readiness feature QA failures through coordinated test-fix retry', async () => {
    vi.useFakeTimers();
    const context = makeContext({
      featureQaState: {
        featureId: 'feature-1',
        routes: ['/dashboard'],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'missing',
        visualAssertions: [
          {
            name: 'Create button',
            route: '/dashboard',
            targetSelector: 'data-testid=create-button',
            assertion: 'visible',
          },
        ],
      },
    });
    const harness = makeExecutionHarness(context);
    vi.mocked(harness.runtime.ensureRepoSetupContract).mockImplementation(() => {
      context.repoSetupContract = {
        path: '/repo/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: { testCommands: [], discoverAgentTests: false },
        },
      };
      return context.repoSetupContract;
    });

    await harness.handlers.startTesting('thread-1');

    expect(context.testRetries).toBe(1);
    expect(context.testOutput).toContain('Visual QA requires stable selectors');
    expect(context.stabilizationFeedback).toContain('failed on attempt 1');
    expect(context.retryTimer).not.toBeNull();
  });

  it('fails execution when the latest plan record is missing or stale', async () => {
    const missing = makeExecutionHarness();
    missing.deps.plans.getLatest.mockReturnValue(null);

    await missing.handlers.startExecution('thread-1', plan as never);

    expect(missing.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Refusing to execute: no plan record found for this thread.',
    );
    expect(missing.activePipelines.has('thread-1')).toBe(false);

    const rejected = makeExecutionHarness();
    rejected.deps.plans.getLatest.mockReturnValue({
      id: 'plan-record-1',
      status: 'rejected',
      structured: plan,
    });

    await rejected.handlers.startExecution('thread-1', plan as never);

    expect(rejected.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Refusing to execute: latest plan is rejected.',
    );
    expect(rejected.activePipelines.has('thread-1')).toBe(false);
  });

  it('fails non-autonomous execution when the executor succeeds without git changes', async () => {
    const context = makeContext({ autonomous: false, worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Executor exited successfully but produced no code changes: done',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });

  it('blocks duplicate shared test failures owned by another active thread', async () => {
    const context = makeContext({ testOutput: 'FAIL packages/foo.test.ts\nAssertionError: no' });
    const harness = makeExecutionHarness(context);
    harness.deps.projectFailures = {
      claimOrCreate: vi.fn(() => ({
        status: 'active',
        ownerThreadId: 'other-thread',
      })),
    };
    vi.mocked(harness.runtime.getVerifyCommands).mockReturnValue(['bun test']);
    vi.mocked(harness.runtime.runShellCommand).mockResolvedValue({
      exitCode: 1,
      output: 'FAIL packages/foo.test.ts\nAssertionError: no',
    });

    await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Shared test failure is already being fixed by other-thread. This worktree is blocked to avoid a duplicate fix and merge conflict.',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });
});
