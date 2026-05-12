import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import {
  buildClarificationContext,
  clearRetryTimer,
  createPlanningPhaseHandlers,
  formatPlanParseFailure,
} from './planning-phases';
import type { PipelineContextHelpers, PipelinePhaseHandlers, PipelineRuntime } from './shared';

function clarificationRequest(id: string, questionId: string, title: string) {
  return {
    id,
    threadId: 'thread-1',
    phase: 'plan' as const,
    summary: `Need ${title}`,
    questions: [
      {
        id: questionId,
        title,
        prompt: `Choose ${title}`,
        description: null,
        choices: [
          {
            id: 'a',
            label: `${title} A`,
            description: `Use ${title} A`,
          },
        ],
        allowFreeform: true,
        freeformPlaceholder: null,
      },
    ],
  };
}

const plan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Ship it',
  files: [{ path: 'src/a.ts', action: 'modify', description: 'Update A' }],
  steps: [{ order: 1, description: 'Update A', files: ['src/a.ts'], rationale: 'Needed' }],
  acceptanceCriteria: ['works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
};

const planBlock = ['```shipcode-plan', JSON.stringify(plan, null, 2), '```'].join('\n');

function makePlanningContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    threadId: 'thread-1',
    projectPath: process.cwd(),
    projectId: 'project-1',
    worktreePath: process.cwd(),
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

function makePlanningHarness(context = makePlanningContext()) {
  const activePipelines = new Map([[context.threadId, context]]);
  const deps = {
    settings: { get: vi.fn(() => ({})) },
    projects: { getById: vi.fn(() => null) },
    githubIssues: { getByNumber: vi.fn(() => null) },
    emitter: { emit: vi.fn() },
    threads: {
      setClarificationRequest: vi.fn(),
      clearPendingClarification: vi.fn(),
      clearClarification: vi.fn(),
      incrementReviewRound: vi.fn(),
      getById: vi.fn(() => ({ id: 'thread-1', prompt: 'Prompt' })),
    },
    plans: {
      getMaxVersion: vi.fn(() => 0),
      create: vi.fn((_threadId: string, raw: string, structured: unknown, version: number) => ({
        id: 'plan-record-1',
        version,
        raw,
        structured,
        status: 'draft',
      })),
      updateStatus: vi.fn(),
      getLatest: vi.fn(() => ({ id: 'plan-record-1', version: 1, structured: plan })),
      supersedeAll: vi.fn(),
    },
    reviews: {
      create: vi.fn(),
    },
    taskGraphs: null,
  };
  const contextHelpers = {
    activePipelines,
    ensureContext: vi.fn(() => context),
    skillCallSite: vi.fn(() => ({
      context: { projectId: context.projectId },
      deps: { skills: { get: vi.fn(() => null) }, onFallback: vi.fn(), onResolved: vi.fn() },
    })),
  } as unknown as PipelineContextHelpers;
  const runtime = {
    buildRepoSetupPlannerNote: vi.fn(() => ''),
    emitPhase: vi.fn(),
    emitTerminalLifecycle: vi.fn(),
    ensureRepoSetupContract: vi.fn(() => null),
    getVerifyCommands: vi.fn(() => []),
    postPlanComment: vi.fn(),
    postTaskGraphComment: vi.fn(),
    resolveAgentForPhase: vi.fn(() => context.plannerModel),
    runProviderPhase: vi.fn(async () => ({ rawOutput: planBlock, exitCode: 0 })),
  } as unknown as PipelineRuntime;
  const handlers = {
    startExecution: vi.fn(),
    startReview: vi.fn(),
    startRevision: vi.fn(),
  } as unknown as PipelinePhaseHandlers;
  const phaseHandlers = createPlanningPhaseHandlers({
    deps: deps as never,
    contextHelpers,
    runtime,
    handlers,
  });
  Object.assign(handlers, phaseHandlers);
  return { activePipelines, context, deps, handlers, runtime };
}

describe('planning phase helpers', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('clears retry timers when present and no-ops without one', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const timer = setTimeout(callback, 1000);
    const context = { retryTimer: timer } as unknown as PipelineContext;

    clearRetryTimer(context);
    expect(context.retryTimer).toBeNull();
    vi.runOnlyPendingTimers();
    expect(callback).not.toHaveBeenCalled();

    clearRetryTimer(context);
    expect(context.retryTimer).toBeNull();
  });

  it('formats plan parse failures with default and clamped diagnostics', () => {
    expect(formatPlanParseFailure()).toBe(
      'Plan generation failed — no valid shipcode-plan block was produced.',
    );
    expect(formatPlanParseFailure(`bad json\n${'x'.repeat(400)}`)).toBe(
      'Plan output could not be parsed — bad json',
    );
    expect(formatPlanParseFailure('x'.repeat(400))).toHaveLength(
      'Plan output could not be parsed — '.length + 280,
    );
    expect(formatPlanParseFailure('   {"unexpected":true}')).toBe(
      'Plan output could not be parsed — {"unexpected":true}',
    );
  });

  it('builds clarification context from history before current request', () => {
    const context = {
      clarificationHistory: [
        {
          request: clarificationRequest('clarify-1', 'brand', 'Brand'),
          answers: [{ questionId: 'brand', selectedChoiceId: 'a', freeformText: 'Fast.' }],
        },
      ],
      clarificationRequest: clarificationRequest('clarify-2', 'tone', 'Tone'),
      clarificationAnswers: [{ questionId: 'tone', selectedChoiceId: 'a', freeformText: 'Quiet.' }],
    } as PipelineContext;

    const result = buildClarificationContext(context);

    expect(result).toContain('Clarification round 1');
    expect(result).toContain('Need Brand');
    expect(result).toContain('Extra note: Fast.');
    expect(result).not.toContain('Need Tone');
  });

  it('skips unanswered clarification history and tolerates missing history arrays', () => {
    const fromMissingHistory = buildClarificationContext({
      clarificationRequest: clarificationRequest('clarify-1', 'storage', 'Storage'),
      clarificationAnswers: [
        { questionId: 'storage', selectedChoiceId: null, freeformText: 'SQLite.' },
      ],
    } as PipelineContext);

    expect(fromMissingHistory).toContain('Need Storage');
    expect(fromMissingHistory).toContain('SQLite.');

    const fromEmptyHistoryEntry = buildClarificationContext({
      clarificationHistory: [
        {
          request: clarificationRequest('clarify-2', 'tone', 'Tone'),
          answers: [],
        },
      ],
      clarificationRequest: null,
      clarificationAnswers: [],
    } as unknown as PipelineContext);

    expect(fromEmptyHistoryEntry).toBeNull();
  });

  it('falls back to current clarification answers and returns null without answers', () => {
    const current = buildClarificationContext({
      clarificationHistory: [],
      clarificationRequest: clarificationRequest('clarify-1', 'storage', 'Storage'),
      clarificationAnswers: [
        { questionId: 'storage', selectedChoiceId: 'a', freeformText: 'Local first.' },
      ],
    } as unknown as PipelineContext);

    expect(current).toContain('Need Storage');
    expect(current).toContain('Local first.');

    expect(
      buildClarificationContext({
        clarificationHistory: [],
        clarificationRequest: null,
        clarificationAnswers: [],
      } as unknown as PipelineContext),
    ).toBeNull();
  });

  it('formats selected clarification choices without freeform notes', () => {
    const context = {
      clarificationHistory: [
        {
          request: clarificationRequest('clarify-1', 'storage', 'Storage'),
          answers: [{ questionId: 'storage', selectedChoiceId: 'a', freeformText: null }],
        },
      ],
      clarificationRequest: null,
      clarificationAnswers: [],
    } as unknown as PipelineContext;

    const result = buildClarificationContext(context);

    expect(result).toContain('Storage A');
    expect(result).toContain('Use Storage A');
    expect(result).not.toContain('Extra note:');
  });

  it('fails planning when repo setup contract loading throws', async () => {
    const harness = makePlanningHarness();
    vi.mocked(harness.runtime.ensureRepoSetupContract).mockImplementation(() => {
      throw new Error('bad setup contract');
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'bad setup contract',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });

  it('formats plan CLI missing failures for OpenRouter providers', async () => {
    const context = makePlanningContext({ plannerModel: 'openrouter' });
    const harness = makePlanningHarness(context);
    vi.mocked(harness.runtime.resolveAgentForPhase).mockReturnValue('openrouter');
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: '',
      exitCode: 127,
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Provider not found (exit 127). Is the openrouter binary installed and on PATH?',
    );
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });

  it('accepts provider-supplied clarification requests on failed planning output', async () => {
    const harness = makePlanningHarness();
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'no plan',
      exitCode: 1,
      clarificationRequest: clarificationRequest('clarify-1', 'scope', 'Scope'),
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.context.clarificationRound).toBe(1);
    expect(harness.deps.threads.setClarificationRequest).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({ id: 'clarify-1', threadId: 'thread-1', phase: 'plan' }),
      1,
    );
    expect(harness.runtime.emitPhase).toHaveBeenCalledWith('thread-1', 'clarifying');
  });

  it('uses structured CLI errors after planning retry budget is exhausted', async () => {
    const context = makePlanningContext({ retryCount: 999 });
    const harness = makePlanningHarness(context);
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: JSON.stringify({ type: 'result', errors: ['schema broke'] }),
      exitCode: 1,
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith('thread-1', 'failed', 'schema broke');
    expect(harness.activePipelines.has('thread-1')).toBe(false);
  });
});
