import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StreamParser } from '@shipcode/agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import {
  buildClarificationContext,
  clearRetryTimer,
  createPlanningPhaseHandlers,
  formatPlanParseFailure,
} from './planning-phases';
import type { PipelineContextHelpers, PipelineRuntime } from './shared';

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

function reviewBlock(review: unknown) {
  return ['```shipcode-review', JSON.stringify(review), '```'].join('\n');
}

const requestChangesReview = {
  planId: 'plan-record-1',
  decision: 'request_changes',
  confidence: 'high',
  summary: 'Needs work',
  findings: [
    {
      id: 'finding-1',
      severity: 'minor',
      category: 'correctness',
      description: 'Missing test',
    },
  ],
  suggestedChanges: ['Add the test'],
};

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
    turnCount: 0,
    featureQaState: null,
    runtimeQaCleanup: null,
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
  const handlers = createPlanningPhaseHandlers({
    deps: deps as never,
    contextHelpers,
    runtime,
  });
  return { activePipelines, context, deps, handlers, runtime };
}

const tempDirs: string[] = [];

function tempDir(name: string) {
  const dir = path.join(os.tmpdir(), `shipcode-planning-${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe('planning phase helpers', () => {
  beforeEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('formats non-Error setup and workflow planning failures', async () => {
    const setup = makePlanningHarness();
    vi.mocked(setup.runtime.ensureRepoSetupContract).mockImplementation(() => {
      throw 'bad setup string';
    });

    await setup.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);

    expect(setup.runtime.emitPhase).toHaveBeenCalledWith('thread-1', 'failed', 'bad setup string');

    const workflow = makePlanningHarness(
      makePlanningContext({
        workflowPolicy: {
          path: '/repo/WORKFLOW.md',
          config: {},
          promptTemplate: { plan: '{{ missing' },
          continuationPromptTemplate: null,
          agent: {
            maxConcurrentAgents: 1,
            maxRetryBackoffMs: 1000,
            maxConcurrentAgentsByState: {},
            maxTurns: 5,
          },
          warning: null,
        },
      } as never),
    );

    await workflow.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);

    expect(workflow.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      expect.stringContaining('WORKFLOW.md template render error:'),
    );
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

  it('loads structured repo memory into planning prompts before falling back', async () => {
    const projectPath = tempDir('repo-memory');
    mkdirSync(path.join(projectPath, '.agents', 'memory'), { recursive: true });
    writeFileSync(path.join(projectPath, '.agents', 'memory', 'goal.md'), 'Repo memory note');
    const context = makePlanningContext({
      projectPath,
      worktreePath: projectPath,
      repoPromptMaterials: null,
    });
    const harness = makePlanningHarness(context);

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', projectPath, projectPath);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.repoContext).toContain('Repo memory note');
    expect(harness.runtime.runProviderPhase).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ phase: 'plan' }),
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ label: '.agents/memory/goal.md' })]),
      expect.any(Object),
    );
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

  it('formats fallback CLI parse failures after planning retry budget is exhausted', async () => {
    const context = makePlanningContext({ retryCount: 999 });
    const harness = makePlanningHarness(context);
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: '{"type":"event"}\nplain failure',
      exitCode: 1,
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Plan generation failed — no structured plan was produced.',
    );
  });

  it('carries previousPlanRawOutput on the plan retry outcome instead of mutating context', async () => {
    const context = makePlanningContext({ retryCount: 0 });
    const harness = makePlanningHarness(context);
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'garbled plan output',
      exitCode: 1,
    });

    const outcome = await harness.handlers.startPlanGeneration(
      'thread-1',
      'do stuff',
      process.cwd(),
      null,
    );

    expect(outcome).toEqual({
      next: 'retry',
      delayMs: expect.any(Number),
      andThen: {
        next: 'plan',
        prompt: 'do stuff',
        projectPath: expect.any(String),
        worktreePath: null,
        carry: { previousPlanRawOutput: 'garbled plan output' },
      },
    });
  });

  it('reads the carry previousPlanRawOutput into the plan prompt', async () => {
    const context = makePlanningContext({});
    const harness = makePlanningHarness(context);
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'no plan',
      exitCode: 1,
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null, {
      previousPlanRawOutput: 'carried attempt output',
    });
    await Promise.resolve();

    const prompt = vi.mocked(harness.runtime.runProviderPhase).mock.calls[0][2];
    expect(prompt).toContain('<previous_attempt_failed>');
    expect(prompt).toContain('carried attempt output');
  });

  it('omits previous-attempt context when no carry is given', async () => {
    const context = makePlanningContext({});
    const harness = makePlanningHarness(context);
    vi.mocked(harness.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'no plan',
      exitCode: 1,
    });

    await harness.handlers.startPlanGeneration('thread-1', 'do stuff', process.cwd(), null);
    await Promise.resolve();

    const prompt = vi.mocked(harness.runtime.runProviderPhase).mock.calls[0][2];
    expect(prompt).not.toContain('<previous_attempt_failed>');
  });

  it('routes review CLI missing failures and request-changes revisions', async () => {
    const context = makePlanningContext({ reviewerModel: 'openrouter' });
    const missing = makePlanningHarness(context);
    vi.mocked(missing.runtime.resolveAgentForPhase).mockReturnValue('openrouter');
    vi.mocked(missing.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: '',
      exitCode: 127,
    });

    await missing.handlers.startReview('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(missing.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Provider not found (exit 127). Is the openrouter binary installed and on PATH?',
    );

    const revision = makePlanningHarness(makePlanningContext({ reviewRound: 0 }));
    vi.mocked(revision.deps.settings.get).mockReturnValue({ revisionCount: 1 });
    vi.mocked(revision.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: reviewBlock(requestChangesReview),
      exitCode: 0,
    });

    const revisionOutcome = await revision.handlers.startReview('thread-1', plan as never);

    expect(revision.deps.threads.incrementReviewRound).toHaveBeenCalledWith('thread-1');
    // request_changes within the revision budget returns a revision outcome for
    // the dispatch loop (it no longer calls startRevision directly).
    expect(revisionOutcome).toEqual({
      next: 'revision',
      plan,
      reviewFeedback: expect.stringContaining('[minor] Missing test'),
    });
  });

  it('fails review on parser-impossible decisions and ignores cancelled review errors', async () => {
    const unexpected = makePlanningHarness();
    const extractReview = vi.spyOn(StreamParser.prototype, 'extractReview').mockReturnValueOnce({
      success: true,
      raw: 'raw',
      data: { ...requestChangesReview, decision: 'defer' } as never,
    });
    vi.mocked(unexpected.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: reviewBlock(requestChangesReview),
      exitCode: 0,
    });

    await unexpected.handlers.startReview('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(unexpected.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Review failed: reviewer returned an unexpected decision (defer).',
    );
    extractReview.mockRestore();

    const reviewError = makePlanningHarness();
    vi.mocked(reviewError.runtime.runProviderPhase).mockRejectedValue('review string failure');

    await reviewError.handlers.startReview('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(reviewError.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Review error: review string failure',
    );

    const cancelled = makePlanningHarness(makePlanningContext({ cancelled: true }));
    vi.mocked(cancelled.runtime.runProviderPhase).mockRejectedValue(new Error('review crashed'));

    await cancelled.handlers.startReview('thread-1', plan as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelled.runtime.emitPhase).not.toHaveBeenCalledWith(
      'thread-1',
      'failed',
      expect.stringContaining('Review error'),
    );
  });

  it('handles revision parse failures and cancelled revision exceptions', async () => {
    const parseFailure = makePlanningHarness();
    vi.mocked(parseFailure.runtime.runProviderPhase).mockResolvedValue({
      rawOutput: 'no plan',
      exitCode: 0,
    });

    await parseFailure.handlers.startRevision('thread-1', plan as never, 'fix it');
    await Promise.resolve();
    await Promise.resolve();

    expect(parseFailure.deps.plans.supersedeAll).toHaveBeenCalledWith('thread-1');
    expect(parseFailure.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Revision output could not be parsed — revisor did not emit a shipcode-plan block.',
    );

    const revisionError = makePlanningHarness();
    vi.mocked(revisionError.runtime.runProviderPhase).mockRejectedValue('revision string failure');

    await revisionError.handlers.startRevision('thread-1', plan as never, 'fix it');
    await Promise.resolve();
    await Promise.resolve();

    expect(revisionError.runtime.emitPhase).toHaveBeenCalledWith(
      'thread-1',
      'failed',
      'Revision error: revision string failure',
    );

    const cancelled = makePlanningHarness(makePlanningContext({ cancelled: true }));
    vi.mocked(cancelled.runtime.runProviderPhase).mockRejectedValue('revision crashed');

    await cancelled.handlers.startRevision('thread-1', plan as never, 'fix it');
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelled.deps.plans.supersedeAll).not.toHaveBeenCalled();
    expect(cancelled.runtime.emitPhase).not.toHaveBeenCalledWith(
      'thread-1',
      'failed',
      expect.stringContaining('Revision error'),
    );
  });
});
