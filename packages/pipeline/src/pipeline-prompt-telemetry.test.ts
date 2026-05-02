import type { AgentProvider, ProviderRegistry } from '@shipcode/agents/source';
import { DEFAULT_SETTINGS, type ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import { createPipeline } from './pipeline';
import type { PipelineDeps, PipelineEvent } from './types';

const plan: ShipCodePlan = {
  id: 'plan-1',
  threadId: 't1',
  version: 1,
  objective: 'Ship the feature',
  files: [{ path: 'src/file.ts', action: 'modify', description: 'Update the file' }],
  steps: [
    { order: 1, description: 'Inspect the target', files: ['src/file.ts'], rationale: 'Baseline' },
    { order: 2, description: 'Implement the change', files: ['src/file.ts'], rationale: 'Scope' },
    {
      order: 3,
      description: 'Verify the change',
      files: ['src/file.ts'],
      rationale: 'Regression coverage',
    },
  ],
  acceptanceCriteria: ['It works'],
  outOfScope: ['Unrelated refactors'],
  estimatedComplexity: 'low',
  dependencies: [],
};

function asPlanBlock() {
  return `\`\`\`shipcode-plan\n${JSON.stringify(plan)}\n\`\`\``;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeDeps(options?: {
  promptTelemetryCreate?: ReturnType<typeof vi.fn>;
  settings?: Partial<typeof DEFAULT_SETTINGS>;
}) {
  const providerCalls: Array<{
    phase: string;
    phaseHints: Record<string, unknown> | undefined;
    prompt: string;
  }> = [];
  const provider: AgentProvider = {
    id: 'claude-cli',
    supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
    generate: vi.fn(async ({ phase, phaseHints, promptMaterialSummary, prompt }) => {
      providerCalls.push({ phase, phaseHints, prompt });
      if (phase === 'review') {
        return {
          rawOutput:
            '```shipcode-review\n' +
            JSON.stringify({
              planId: 'plan-1',
              decision: 'request_changes',
              confidence: 'high',
              summary: 'Needs one revision',
              findings: [],
              suggestedChanges: ['Tighten the plan'],
            }) +
            '\n```',
          exitCode: 0,
          resolvedModel: 'claude',
          tokensUsed: { prompt: 11, completion: 7 },
          costUsd: 0.02,
          promptTelemetry: {
            phase,
            promptSize: {
              characters: prompt.length,
              bytes: Buffer.byteLength(prompt, 'utf8'),
              lines: prompt.split('\n').length,
            },
            selectedMaterials: promptMaterialSummary,
          },
          phaseHints,
        };
      }
      return {
        rawOutput: asPlanBlock(),
        exitCode: 0,
        resolvedModel: 'claude',
        tokensUsed: { prompt: 11, completion: 7 },
        costUsd: 0.02,
        promptTelemetry: {
          phase,
          promptSize: {
            characters: prompt.length,
            bytes: Buffer.byteLength(prompt, 'utf8'),
            lines: prompt.split('\n').length,
          },
          selectedMaterials: promptMaterialSummary,
        },
        phaseHints,
      };
    }),
    healthCheck: vi.fn(async () => ({ ok: true })),
  };
  const providers: ProviderRegistry = {
    for: () => provider,
    all: () => new Map([[provider.id, provider]]),
  };
  const events: PipelineEvent[] = [];
  const deps = {
    emitter: { emit: vi.fn((event: PipelineEvent) => events.push(event)) },
    processManager: { kill: vi.fn() },
    threads: {
      updateStatus: vi.fn(),
      updateAutonomousFields: vi.fn(),
      recordFailure: vi.fn(),
      getById: vi.fn(() => ({ id: 't1', projectId: 'project-1', prompt: 'Thread prompt' })),
      incrementReviewRound: vi.fn(),
      clearClarification: vi.fn(),
      clearPendingClarification: vi.fn(),
      setClarificationRequest: vi.fn(),
      setResolvedModel: vi.fn(),
      addTokenUsage: vi.fn(),
    },
    plans: {
      getMaxVersion: vi.fn(() => 0),
      create: vi.fn((_threadId, raw, structured, version) => ({
        id: 'plan-1',
        threadId: _threadId,
        version,
        rawOutput: raw,
        structured,
        status: 'draft',
        createdAt: '',
      })),
      updateStatus: vi.fn(),
      getLatest: vi.fn(() => ({ id: 'plan-1', version: 1, structured: plan })),
      supersedeAll: vi.fn(),
    },
    reviews: { create: vi.fn(), getByPlanId: vi.fn(() => null) },
    diffs: { replaceForThread: vi.fn() },
    verifications: { create: vi.fn(), getLatest: vi.fn(() => null) },
    githubIssues: { getByNumber: vi.fn(() => null), updatePipelineStatus: vi.fn() },
    checkpoints: { getLatest: vi.fn(() => null), create: vi.fn() },
    projects: { getById: vi.fn(() => ({ id: 'project-1', prdQualityGate: false })) },
    settings: { get: vi.fn(() => ({ ...DEFAULT_SETTINGS, ...options?.settings })), set: vi.fn() },
    providers,
    skills: { get: vi.fn(() => null), markQuarantined: vi.fn() },
    promptTelemetry: { create: options?.promptTelemetryCreate ?? vi.fn() },
  } as unknown as PipelineDeps;

  return { deps, provider, providerCalls, events };
}

describe('pipeline prompt telemetry', () => {
  it('persists prompt metrics alongside token and cost telemetry for plan invocations', async () => {
    const promptTelemetryCreate = vi.fn();
    const { deps } = makeDeps({ promptTelemetryCreate });
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'Do the thing', '/tmp/project', null);
    await flush();
    await flush();

    expect(deps.plans.create).toHaveBeenCalledWith(
      't1',
      expect.any(String),
      expect.objectContaining({ id: 'plan-1' }),
      1,
    );
    expect(promptTelemetryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 't1',
        phase: 'plan',
        promptTokens: 11,
        completionTokens: 7,
        costUsd: 0.02,
        selectedMaterials: expect.objectContaining({
          count: expect.any(Number),
          labels: expect.any(Array),
          kinds: expect.any(Array),
        }),
      }),
    );
  });

  it('uses lower-cost review defaults only when the context has no explicit override', async () => {
    const { deps, provider } = makeDeps({
      settings: {
        reviewerReasoningEffort: undefined,
        requireApproval: true,
        revisionCount: 0,
      },
    });
    const pipeline = createPipeline(deps);

    await pipeline.startFromGitHubIssue(
      't1',
      '/tmp/project',
      { number: 1, title: 'Issue', body: 'Body', labels: [] },
      'claude',
    );
    await flush();

    const context = pipeline.getContext('t1');
    expect(context?.reviewerReasoningEffort).toBe('low');
    expect(provider.generate).toHaveBeenCalled();
  });

  it('records prompt telemetry persistence failures as non-fatal diagnostics', async () => {
    const promptTelemetryCreate = vi.fn(() => {
      throw new Error('db unavailable');
    });
    const { deps } = makeDeps({ promptTelemetryCreate });
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'Do the thing', '/tmp/project', null);
    await flush();
    await flush();

    expect(deps.plans.create).toHaveBeenCalled();
    expect(pipeline.getContext('t1')?.promptTelemetryDiagnostics).toEqual([
      { phase: 'plan', message: 'db unavailable', nonFatal: true },
    ]);
  });

  it('uses the revision reasoning default when no explicit planner override is configured', async () => {
    const { deps, providerCalls } = makeDeps({
      settings: {
        plannerReasoningEffort: undefined,
        reviewerReasoningEffort: undefined,
        requireApproval: true,
        revisionCount: 1,
      },
    });
    const pipeline = createPipeline(deps);

    await pipeline.startFromGitHubIssue(
      't1',
      '/tmp/project',
      { number: 1, title: 'Issue', body: 'Body', labels: [] },
      'claude',
    );
    await flush();
    await flush();
    await flush();

    expect(providerCalls.slice(0, 3).map((call) => call.phase)).toEqual([
      'plan',
      'review',
      'revision',
    ]);
    expect(pipeline.getContext('t1')?.phaseReasoningEfforts).toEqual(
      expect.objectContaining({
        plan: 'high',
        review: 'low',
        revision: 'none',
      }),
    );
    expect(providerCalls[2]?.phaseHints).toEqual(
      expect.objectContaining({ reasoningEffort: 'none' }),
    );
  });
});
