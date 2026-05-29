import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeQaServerConfig } from '@shipcode/shared';
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
import type { PipelineContextHelpers, PipelineRuntime } from './shared';

type ExecutionHarnessDeps = {
  plans: { getLatest: ReturnType<typeof vi.fn> };
  settings: { get: ReturnType<typeof vi.fn> };
  emitter: { emit: ReturnType<typeof vi.fn> };
  projectFailures: unknown;
  featureQaResults: {
    insert: ReturnType<typeof vi.fn>;
    listByThread: ReturnType<typeof vi.fn>;
  };
  cpuTaskGate?: {
    canStartCpuTask: ReturnType<typeof vi.fn>;
    retryDelayMs: number;
  };
};

const { mockExecFileSync, mockServerLifecycleStart, mockServerLifecycleStop, mockShellExecEnv } =
  vi.hoisted(() => ({
    mockExecFileSync: vi.fn(),
    mockServerLifecycleStart: vi.fn(),
    mockServerLifecycleStop: vi.fn(),
    mockShellExecEnv: vi.fn(),
  }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

vi.mock('@shipcode/agents/source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/agents/source')>();
  return {
    ...actual,
    shellExecEnv: mockShellExecEnv,
    ServerLifecycleManager: vi.fn(function ServerLifecycleManager(
      _processManager: unknown,
      onOutput: (message: string) => void,
    ) {
      onOutput('server boot\n');
      return {
        start: mockServerLifecycleStart,
        stop: mockServerLifecycleStop,
      };
    }),
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

function runtimeQaServer(overrides: Partial<RuntimeQaServerConfig> = {}): RuntimeQaServerConfig {
  return {
    command: 'bun dev',
    readinessUrl: 'http://localhost:3000',
    startupTimeoutMs: 60_000,
    portEnvVar: 'PORT',
    ...overrides,
  };
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
    verifications: { getLatest: vi.fn(() => null), create: vi.fn() },
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
    taskGraphs: null,
    diffs: { replaceForThread: vi.fn() },
    reviews: { getByPlanId: vi.fn(() => null) },
    featureQaResults: {
      insert: vi.fn(),
      listByThread: vi.fn(() => []),
    },
    projectFailures: null,
    cpuTaskGate: undefined,
  } as unknown as ExecutionHarnessDeps;
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
    emitTerminalRaw: vi.fn(),
    ensureRepoSetupContract: vi.fn(() => null),
    prepareWorktree: vi.fn(async () => ({ ok: true })),
    getVerifyCommands: vi.fn(() => []),
    getTestingContext: vi.fn(() => null),
    formatTestFixFeedback: vi.fn(
      (testOutput: string, attempt: number) => `Tests failed on attempt ${attempt}\n${testOutput}`,
    ),
    formatStabilizationFeedback: vi.fn(() => 'stabilization feedback'),
    runShellCommand: vi.fn(),
    runProviderPhase: vi.fn(async () => ({ rawOutput: 'done', exitCode: 0 })),
    postTaskGraphComment: vi.fn(),
  } as unknown as PipelineRuntime;
  const handlers = createExecutionPhaseHandlers({
    deps: deps as never,
    contextHelpers,
    runtime,
  });
  return { activePipelines, context, contextHelpers, deps, handlers, runtime };
}

const tempDirs: string[] = [];

function tempDir(name: string) {
  const dir = path.join(os.tmpdir(), `shipcode-execution-${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

const verificationPassed = [
  '```shipcode-verify',
  JSON.stringify({
    threadId: 'thread-1',
    planId: 'plan-record-1',
    result: 'passed',
    summary: 'ok',
    criteriaResults: [{ criterion: 'works', passed: true, evidence: 'done' }],
    issues: [],
  }),
  '```',
].join('\n');

const verificationFailed = [
  '```shipcode-verify',
  JSON.stringify({
    threadId: 'thread-1',
    planId: 'plan-record-1',
    result: 'failed',
    summary: 'not ok',
    criteriaResults: [{ criterion: 'works', passed: false, evidence: 'missing' }],
    issues: [{ severity: 'blocker', description: 'missing file', filePath: 'src/a.ts' }],
  }),
  '```',
].join('\n');

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
    mockServerLifecycleStart.mockReset();
    mockServerLifecycleStop.mockReset();
    mockShellExecEnv.mockReset();
    mockShellExecEnv.mockImplementation(() => ({ ...process.env, PATH: process.env.PATH ?? '' }));
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      if (args[0] === 'status') return ' M src/a.ts\n';
      return '';
    });
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('queues testing as a retry outcome when CPU slots are busy', async () => {
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

    const outcome = await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.emitTerminalLifecycle).toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('CPU-heavy task slots are busy'),
    );
    // CPU backpressure is now a retry outcome; the dispatch loop owns the delay,
    // so the phase no longer arms context.retryTimer.
    expect(outcome).toEqual({
      next: 'retry',
      delayMs: expect.any(Number),
      andThen: { next: 'testing' },
    });
    expect(context.retryTimer).toBeNull();
  });

  it('queues testing on CPU gate pressure without repeating recent queue notices', async () => {
    const context = makeContext({
      cpuQueueLastNotifiedAt: Date.now(),
    });
    const harness = makeExecutionHarness(context);
    const gateCheck = vi
      .fn()
      .mockReturnValueOnce({ allowed: false })
      .mockReturnValue({ allowed: true });
    harness.deps.cpuTaskGate = {
      canStartCpuTask: gateCheck,
      retryDelayMs: 123,
    } as never;
    vi.mocked(harness.runtime.getVerifyCommands).mockReturnValue(['bun test']);

    const outcome = await harness.handlers.startTesting('thread-1');

    expect(outcome).toEqual({ next: 'retry', delayMs: 123, andThen: { next: 'testing' } });
    expect(harness.runtime.emitTerminalLifecycle).not.toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('[cpu-queue]'),
    );
  });

  it('routes selector-readiness feature QA failures through coordinated test-fix retry', async () => {
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

    const outcome = await harness.handlers.startTesting('thread-1');

    expect(context.testRetries).toBe(1);
    // The accumulated failure output is carried into the re-execution as fix feedback.
    expect(outcome).toMatchObject({
      next: 'retry',
      delayMs: expect.any(Number),
      andThen: { next: 'execute', plan: expect.anything() },
    });
    const fixFeedback = (outcome as { andThen?: { carry?: { stabilizationFeedback?: string } } })
      .andThen?.carry?.stabilizationFeedback;
    expect(fixFeedback).toContain('Visual QA requires stable selectors');
    expect(fixFeedback).toContain('failed on attempt 1');
  });

  it('emits a failure when the test-fix retry cannot find a structured plan', async () => {
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
    // No structured plan available when the test-fix outcome is built.
    harness.deps.plans.getLatest.mockReturnValue(null);

    await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Test fix cannot start: structured plan missing for this thread.',
    );
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

  it('fails execution when the latest plan has no structured output', async () => {
    const harness = makeExecutionHarness();
    harness.deps.plans.getLatest.mockReturnValue({
      id: 'plan-record-1',
      status: 'draft',
      structured: null,
    });

    await harness.handlers.startExecution('thread-1', plan as never);

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Refusing to execute: latest plan has no parsed structured output.',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });

  it('appends implementation notes protocol to custom workflow execution prompts', async () => {
    const context = makeContext({
      projectId: null,
      worktreePath: process.cwd(),
      workflowPolicy: {
        ...makeContext().workflowPolicy,
        promptTemplate: 'Custom execution prompt for {{ issue.body }}',
      },
    });
    const harness = makeExecutionHarness(context);

    await harness.handlers.startExecution('thread-1', plan as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = vi.mocked(harness.runtime.runProviderPhase).mock.calls[0]?.[2] as string;
    expect(prompt).toContain('Custom execution prompt for Prompt');
    expect(prompt).toContain('<implementation_notes_protocol>');
    expect(prompt).toContain('implementation-notes.md');
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
    const context = makeContext();
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

  it('blocks shared test failures already resolved by another thread', async () => {
    const context = makeContext();
    const harness = makeExecutionHarness(context);
    harness.deps.projectFailures = {
      claimOrCreate: vi.fn(() => ({
        status: 'resolved',
        resolvedByThreadId: 'done-thread',
        resolvedCommitSha: 'abcdef1234567890',
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
      'Shared test failure already resolved by done-thread at abcdef123456. Rebase or cherry-pick that fix before retrying this worktree.',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });

  it('feeds structured verification failures back into the next execution prompt', async () => {
    const context = makeContext({ repoPromptMaterials: null, worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    (
      harness.deps as never as { verifications: { getLatest: ReturnType<typeof vi.fn> } }
    ).verifications.getLatest.mockReturnValue({
      planId: 'plan-record-1',
      result: 'failed',
      structured: {
        summary: ' Needs   polish ',
        criteriaResults: [{ criterion: ' AC ', passed: false, evidence: ' Missing   proof ' }],
        issues: [{ severity: 'major', description: ' Bad   file ', filePath: 'src/a.ts' }],
      },
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = vi.mocked(harness.runtime.runProviderPhase).mock.calls[0]?.[2] as string;
    expect(prompt).toContain('<previous_verification_failure>');
    expect(prompt).toContain('- AC: Missing proof');
    expect(prompt).toContain('- [major] src/a.ts: Bad file');
  });

  it('loads repo prompt material content when execution context is initialized lazily', async () => {
    const projectPath = tempDir('repo-memory');
    mkdirSync(path.join(projectPath, '.agents', 'memory'), { recursive: true });
    const memoryPath = path.join(projectPath, '.agents', 'memory', 'goal.md');
    await import('node:fs').then(({ writeFileSync }) =>
      writeFileSync(memoryPath, 'Execution note'),
    );
    const context = makeContext({
      repoPromptMaterials: null,
      projectPath,
      worktreePath: projectPath,
      autonomous: false,
    });
    const harness = makeExecutionHarness(context);

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.repoContext).toContain('Execution note');
  });

  it('retries a task graph node when scoped node verification cannot parse output', async () => {
    vi.useFakeTimers();
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'high',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeFailed: vi.fn(() => graph),
      markNodeCompletedAndPromote: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase)
      .mockResolvedValueOnce({ rawOutput: 'done', exitCode: 0 })
      .mockResolvedValueOnce({ rawOutput: 'not verification json', exitCode: 0 });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'anchor-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    const outcome = await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.nodeVerificationRetries).toBe(1);
    const nodeFeedback = (outcome as { andThen?: { carry?: { stabilizationFeedback?: string } } })
      .andThen?.carry?.stabilizationFeedback;
    expect(nodeFeedback).toContain('failed verification on attempt 1');
    expect(
      (harness.deps as never as { taskGraphs: { updateNodeStatus: ReturnType<typeof vi.fn> } })
        .taskGraphs.updateNodeStatus,
    ).toHaveBeenCalledWith('node-1', 'ready');
  });

  it('retries a task graph node when anchor capture or diff computation fails', async () => {
    vi.useFakeTimers();
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'done',
      exitCode: 0,
    });
    let headCalls = 0;
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') {
        headCalls++;
        if (headCalls === 1) return 'head-sha\n';
        throw new Error('no head');
      }
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.nodeVerificationRetries).toBe(1);
    expect(harness.runtime.runProviderPhase).toHaveBeenCalledTimes(1);
    expect(
      (harness.deps as never as { taskGraphs: { updateNodeStatus: ReturnType<typeof vi.fn> } })
        .taskGraphs.updateNodeStatus,
    ).toHaveBeenCalledWith('node-1', 'ready');
  });

  it('retries a task graph node when diff computation throws after anchor capture', async () => {
    vi.useFakeTimers();
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'done',
      exitCode: 0,
    });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') throw new Error('diff failed');
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.nodeVerificationRetries).toBe(1);
  });

  it('fails scoped node verification when the active context disappears', async () => {
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase).mockImplementation(async () => {
      harness.activePipelines.delete('thread-1');
      return { rawOutput: 'done', exitCode: 0 };
    });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      (harness.deps as never as { taskGraphs: { markNodeFailed: ReturnType<typeof vi.fn> } })
        .taskGraphs.markNodeFailed,
    ).toHaveBeenCalledWith('node-1');
  });

  it('retries scoped node verification when the verifier throws', async () => {
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase).mockImplementation(async (_context, payload) => {
      if (payload.phase === 'verify') throw new Error('verifier offline');
      return { rawOutput: 'done', exitCode: 0 };
    });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    const outcome = await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.nodeVerificationRetries).toBe(1);
    const nodeFeedback = (outcome as { andThen?: { carry?: { stabilizationFeedback?: string } } })
      .andThen?.carry?.stabilizationFeedback;
    expect(nodeFeedback).toContain('failed verification on attempt 1');
  });

  it('fails cancelled scoped node verification without scheduling another retry', async () => {
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase).mockImplementation(async (_context, payload) => {
      if (payload.phase === 'verify') context.cancelled = true;
      return { rawOutput: verificationFailed, exitCode: 0 };
    });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'anchor-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      (harness.deps as never as { taskGraphs: { markNodeFailed: ReturnType<typeof vi.fn> } })
        .taskGraphs.markNodeFailed,
    ).toHaveBeenCalledWith('node-1');
    expect(context.retryTimer).toBeNull();
  });

  it('continues from a completed task graph in autonomous mode', async () => {
    const context = makeContext({ autonomous: true, worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [
        {
          id: 'node-1',
          stableKey: 'step-1',
          title: 'Done',
          description: 'Done',
          status: 'completed',
          githubIssueNumber: null,
          order: 1,
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'backend',
          suggestedReasoningEffort: 'medium',
        },
      ],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => null),
      updateGraphStatus: vi.fn(() => ({ ...graph, status: 'completed' })),
    } as never;

    await harness.handlers.startExecution('thread-1', plan as never);

    expect(harness.runtime.postTaskGraphComment).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('completes a task graph node after scoped node verification passes', async () => {
    const context = makeContext({ worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase)
      .mockResolvedValueOnce({ rawOutput: 'done', exitCode: 0 })
      .mockResolvedValueOnce({ rawOutput: verificationPassed, exitCode: 0 });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'anchor-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      (
        harness.deps as never as {
          taskGraphs: { markNodeCompletedAndPromote: ReturnType<typeof vi.fn> };
        }
      ).taskGraphs.markNodeCompletedAndPromote,
    ).toHaveBeenCalledWith('node-1');
    expect(harness.runtime.runProviderPhase).toHaveBeenCalledTimes(2);
  });

  it('completes a task graph node from cumulative diff when a retry finds it already committed', async () => {
    const context = makeContext({
      forkPointSha: 'base-sha',
      nodeVerificationRetries: 1,
      worktreePath: process.cwd(),
    });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase)
      .mockResolvedValueOnce({ rawOutput: 'already done', exitCode: 0 })
      .mockResolvedValueOnce({ rawOutput: verificationPassed, exitCode: 0 });

    let diffCalls = 0;
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'head-sha\n';
      if (args[0] === 'rev-parse' && args[1] === '--verify') return 'base-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') {
        diffCalls++;
        return diffCalls === 1 ? '' : 'diff --git a/src/a.ts b/src/a.ts\n';
      }
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      (
        harness.deps as never as {
          taskGraphs: { markNodeCompletedAndPromote: ReturnType<typeof vi.fn> };
        }
      ).taskGraphs.markNodeCompletedAndPromote,
    ).toHaveBeenCalledWith('node-1');
    expect(harness.runtime.emitTerminalLifecycle).toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('verifying cumulative worktree diff'),
    );
  });

  it('fails a task graph node when scoped node verification exhausts retries', async () => {
    const context = makeContext({ nodeVerificationRetries: 2, worktreePath: process.cwd() });
    const harness = makeExecutionHarness(context);
    const node = {
      id: 'node-1',
      stableKey: 'step-1',
      title: 'Node',
      description: 'Do node',
      status: 'ready',
      githubIssueNumber: null,
      order: 1,
      files: [],
      acceptanceCriteria: ['done'],
      surfaces: [],
      agentRole: 'backend',
      suggestedReasoningEffort: 'medium',
    };
    const graph = {
      id: 'graph-1',
      mode: 'github-subissues',
      status: 'active',
      nodes: [node],
      edges: [],
    };
    (harness.deps as never as { taskGraphs: unknown }).taskGraphs = {
      getByPlanId: vi.fn(() => graph),
      getNextReadyNode: vi.fn(() => node),
      updateNodeStatus: vi.fn(),
      markNodeCompletedAndPromote: vi.fn(() => graph),
      markNodeFailed: vi.fn(() => graph),
    } as never;
    vi.mocked(harness.runtime.runProviderPhase)
      .mockResolvedValueOnce({ rawOutput: 'done', exitCode: 0 })
      .mockResolvedValueOnce({ rawOutput: verificationFailed, exitCode: 0 });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'shipcode/issue-42\n';
      if (args[0] === 'rev-parse') return 'anchor-sha\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    await harness.handlers.startExecution('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(
      (harness.deps as never as { taskGraphs: { markNodeFailed: ReturnType<typeof vi.fn> } })
        .taskGraphs.markNodeFailed,
    ).toHaveBeenCalledWith('node-1');
    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Node "step-1" failed verification after 3 attempts.',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });

  it('fails visual QA when tooling is unavailable or generation throws', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    const unavailable = makeExecutionHarness(
      makeContext({
        featureQaState: {
          featureId: 'feature-1',
          routes: ['http://localhost:3000/dashboard'],
          criticalFlows: [],
          expectedStates: [],
          testDataAssumptions: [],
          selectorReadiness: 'ready',
          visualAssertions: [
            {
              name: 'Button',
              route: 'http://localhost:3000/dashboard',
              targetSelector: '[data-testid="button"]',
              assertion: 'visible',
            },
          ],
        },
      }),
    );
    vi.mocked(unavailable.runtime.ensureRepoSetupContract).mockImplementation(() => {
      unavailable.context.repoSetupContract = {
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
      return unavailable.context.repoSetupContract;
    });

    await unavailable.handlers.startTesting('thread-1');

    expect(unavailable.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      expect.stringContaining('Visual QA requires Playwright tooling.'),
    );

    process.env.PATH = originalPath;
    const generation = makeExecutionHarness(
      makeContext({
        worktreePath: '/definitely/missing/worktree',
        featureQaState: {
          featureId: 'feature-1',
          routes: ['http://localhost:3000/dashboard'],
          criticalFlows: [],
          expectedStates: [],
          testDataAssumptions: [],
          selectorReadiness: 'ready',
          visualAssertions: [
            {
              name: 'Button',
              route: 'http://localhost:3000/dashboard',
              targetSelector: '[data-testid="button"]',
              assertion: 'visible',
            },
          ],
        },
      }),
    );
    vi.mocked(generation.runtime.ensureRepoSetupContract).mockImplementation(() => {
      generation.context.repoSetupContract = {
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
      return generation.context.repoSetupContract;
    });

    await generation.handlers.startTesting('thread-1');

    expect(generation.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      expect.stringContaining('Visual QA generation failed:'),
    );
  });

  it('fails visual QA with relative routes when no runtime server is configured', async () => {
    const harness = makeExecutionHarness(
      makeContext({
        featureQaState: {
          featureId: 'feature-1',
          routes: ['/dashboard'],
          criticalFlows: [],
          expectedStates: [],
          testDataAssumptions: [],
          selectorReadiness: 'ready',
          visualAssertions: [
            {
              name: 'Button',
              route: '/dashboard',
              targetSelector: '[data-testid="button"]',
              assertion: 'visible',
            },
          ],
        },
      }),
    );
    vi.mocked(harness.runtime.ensureRepoSetupContract).mockImplementation(() => {
      harness.context.repoSetupContract = {
        path: '/repo/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
        },
      };
      return harness.context.repoSetupContract;
    });

    await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      expect.stringContaining('runtimeQa.server'),
    );
  });

  it.skip('retries and then exhausts runtime QA server startup failures', async () => {
    const context = makeContext({ testRetries: 0 });
    const harness = makeExecutionHarness(context);
    mockServerLifecycleStart.mockRejectedValueOnce(new Error('readiness timeout'));
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
          runtimeQa: {
            server: runtimeQaServer(),
            testCommands: ['runtime-pass'],
            discoverAgentTests: false,
          },
        },
      };
      return context.repoSetupContract;
    });

    const outcome = await harness.handlers.startTesting('thread-1');

    expect(context.testRetries).toBe(1);
    const fixFeedback = (outcome as { andThen?: { carry?: { stabilizationFeedback?: string } } })
      .andThen?.carry?.stabilizationFeedback;
    expect(fixFeedback).toContain('Server startup failed: readiness timeout');

    context.testRetries = 3;
    mockServerLifecycleStart.mockRejectedValueOnce('offline');

    await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Runtime QA server startup failed: offline',
    );
  });

  it.skip('passes runtime QA server env to commands and handles server crashes', async () => {
    const context = makeContext({ worktreePath: tempDir('runtime-qa'), testRetries: 3 });
    const harness = makeExecutionHarness(context);
    mockServerLifecycleStart.mockResolvedValueOnce({
      processId: 'proc-1',
      baseUrl: 'http://127.0.0.1:4321',
      port: 4321,
      crashed: false,
    });
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
          runtimeQa: {
            server: runtimeQaServer(),
            testCommands: ['runtime-pass'],
            discoverAgentTests: false,
          },
        },
      };
      return context.repoSetupContract;
    });
    vi.mocked(harness.runtime.runShellCommand).mockResolvedValue({ exitCode: 0, output: 'ok' });

    await harness.handlers.startTesting('thread-1');

    expect(harness.runtime.runShellCommand).toHaveBeenCalledWith(
      'thread-1',
      context.worktreePath,
      'runtime-pass',
      context.abort.signal,
      { extraEnv: { BASE_URL: 'http://127.0.0.1:4321', PORT: '4321' } },
    );
    expect(mockServerLifecycleStop).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 'proc-1' }),
    );

    mockServerLifecycleStart.mockResolvedValueOnce({
      processId: 'proc-abort',
      baseUrl: 'http://127.0.0.1:4323',
      port: 4323,
      crashed: false,
    });
    const abortContext = makeContext({ worktreePath: tempDir('runtime-abort'), testRetries: 3 });
    const abortHarness = makeExecutionHarness(abortContext);
    vi.mocked(abortHarness.runtime.ensureRepoSetupContract).mockImplementation(() => {
      abortContext.repoSetupContract = {
        path: '/repo/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            server: runtimeQaServer(),
            testCommands: ['runtime-pass'],
            discoverAgentTests: false,
          },
        },
      };
      return abortContext.repoSetupContract;
    });
    vi.mocked(abortHarness.runtime.runShellCommand).mockImplementation(async () => {
      abortContext.abort.abort();
      return { exitCode: 0, output: 'ok' };
    });

    await abortHarness.handlers.startTesting('thread-1');

    expect(mockServerLifecycleStop).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 'proc-abort' }),
    );

    mockServerLifecycleStop.mockClear();
    const crashedContext = makeContext({ worktreePath: tempDir('runtime-crash'), testRetries: 3 });
    const crashed = makeExecutionHarness(crashedContext);
    mockServerLifecycleStart.mockResolvedValueOnce({
      processId: 'proc-2',
      baseUrl: 'http://127.0.0.1:4322',
      port: 4322,
      crashed: true,
    });
    vi.mocked(crashed.runtime.ensureRepoSetupContract).mockImplementation(() => {
      crashedContext.repoSetupContract = {
        path: '/repo/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            server: runtimeQaServer(),
            testCommands: ['runtime-pass'],
            discoverAgentTests: false,
          },
        },
      };
      return crashedContext.repoSetupContract;
    });

    await crashed.handlers.startTesting('thread-1');

    expect(crashed.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      '[runtime-qa] Server crashed during testing',
    );
    expect(mockServerLifecycleStop).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 'proc-2' }),
    );

    mockServerLifecycleStart.mockResolvedValueOnce({
      processId: 'proc-3',
      baseUrl: 'http://127.0.0.1:4324',
      port: 4324,
      crashed: true,
    });
    const retryCrashContext = makeContext({
      worktreePath: tempDir('runtime-crash-retry'),
      testRetries: 0,
    });
    const retryCrash = makeExecutionHarness(retryCrashContext);
    vi.mocked(retryCrash.runtime.ensureRepoSetupContract).mockImplementation(() => {
      retryCrashContext.repoSetupContract = {
        path: '/repo/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            server: runtimeQaServer(),
            testCommands: ['runtime-pass'],
            discoverAgentTests: false,
          },
        },
      };
      return retryCrashContext.repoSetupContract;
    });

    await retryCrash.handlers.startTesting('thread-1');

    expect(retryCrashContext.testRetries).toBe(1);
  });

  it('continues runtime QA when feature QA result persistence fails', async () => {
    const context = makeContext({
      worktreePath: tempDir('runtime-qa-results'),
      featureQaState: {
        featureId: 'feature-1',
        routes: ['http://localhost:3000/dashboard'],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
        visualAssertions: [],
      },
    });
    const harness = makeExecutionHarness(context);
    harness.deps.featureQaResults.insert = vi.fn(() => {
      throw new Error('qa db offline');
    });
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
          runtimeQa: {
            testCommands: ['runtime-pass'],
            discoverAgentTests: false,
          },
        },
      };
      return context.repoSetupContract;
    });
    vi.mocked(harness.runtime.runShellCommand).mockResolvedValue({
      exitCode: 0,
      output: `<qa_results>${JSON.stringify([
        { flowName: 'Smoke', passed: true, evidencePaths: ['shot.png'] },
      ])}</qa_results>`,
    });

    await harness.handlers.startTesting('thread-1');

    expect(harness.deps.featureQaResults.insert).toHaveBeenCalled();
    expect(harness.runtime.emitTerminalLifecycle).toHaveBeenCalledWith(
      'thread-1',
      '[runtime-qa] All runtime tests passed\r\n',
    );
  });

  it('returns an execution retry outcome after failed verification', async () => {
    const context = makeContext({ verificationRetries: 0 });
    const harness = makeExecutionHarness(context);
    harness.deps.plans.getLatest.mockReturnValue({
      id: 'plan-record-1',
      status: 'approved',
      structured: plan,
    });
    (harness.deps as never as { verifications: unknown }).verifications = {
      create: vi.fn(),
      getLatest: vi.fn(() => null),
    };
    (harness.deps as never as { diffs: unknown }).diffs = { replaceForThread: vi.fn() };
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: verificationFailed,
      exitCode: 0,
    });
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse') return 'head-sha\n';
      if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
      return '';
    });

    const outcome = await harness.handlers.startVerification('thread-1');

    expect(context.verificationRetries).toBe(1);
    // The phase returns the retry outcome; the dispatch loop owns the delay and
    // the cancellable timer (no context.retryTimer armed here).
    expect(outcome).toEqual({
      next: 'retry',
      delayMs: expect.any(Number),
      andThen: { next: 'execute', plan },
    });
    expect(harness.runtime.runProviderPhase).toHaveBeenCalledTimes(1);
  });

  describe('typed phase-result carry (#139)', () => {
    it('carries passing test output to verification as typed carry', async () => {
      const context = makeContext();
      const harness = makeExecutionHarness(context);
      vi.mocked(harness.runtime.getVerifyCommands).mockReturnValue(['bun test']);
      vi.mocked(harness.runtime.runShellCommand).mockResolvedValue({
        exitCode: 0,
        output: 'PASS all green',
      });

      const outcome = await harness.handlers.startTesting('thread-1');

      expect(outcome).toEqual({
        next: 'verification',
        carry: { testOutput: expect.stringContaining('PASS all green') },
      });
    });

    it('folds carry.testOutput into the verifier prompt materials', async () => {
      const context = makeContext({ worktreePath: tempDir('verify-carry') });
      const harness = makeExecutionHarness(context);
      vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
        rawOutput: verificationPassed,
        exitCode: 0,
      });
      mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
        if (args[0] === 'status') return '';
        if (args[0] === 'rev-parse') return 'head-sha\n';
        if (args[0] === 'diff') return 'diff --git a/src/a.ts b/src/a.ts\n';
        return '';
      });

      await harness.handlers.startVerification('thread-1', { testOutput: 'COVERAGE 100% green' });

      const materials = vi.mocked(harness.runtime.runProviderPhase).mock.calls[0][3];
      expect(materials).toContainEqual(
        expect.objectContaining({ label: 'test output', content: 'COVERAGE 100% green' }),
      );
    });

    it('carries stabilization feedback on the execute outcome instead of mutating context', async () => {
      const context = makeContext();
      const harness = makeExecutionHarness(context);
      vi.mocked(harness.runtime.formatStabilizationFeedback).mockReturnValue(
        'STABILIZE: fix failing CI',
      );

      const outcome = await harness.handlers.startStabilization('thread-1', {
        prNumber: 7,
        prUrl: null,
        failingChecks: [],
        unresolvedReviewComments: [],
      });

      expect(outcome).toEqual({
        next: 'execute',
        plan,
        carry: { stabilizationFeedback: 'STABILIZE: fix failing CI' },
      });
    });
  });
});
