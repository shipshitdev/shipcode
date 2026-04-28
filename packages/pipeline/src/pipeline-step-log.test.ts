import type { AgentProvider, ProviderRegistry, ProviderResponse } from '@shipcode/agents';
import { DEFAULT_SETTINGS, type ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import { createPipeline } from './pipeline';
import type { PipelineDeps, PipelineEvent } from './types';

const plan: ShipCodePlan = {
  id: 'p1',
  threadId: 't1',
  version: 1,
  objective: 'Test',
  files: [{ path: 'a.ts', action: 'modify', description: 'd' }],
  steps: [{ order: 1, description: 'd', files: ['a.ts'], rationale: 'r' }],
  acceptanceCriteria: ['works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
};

function planBlock() {
  return `\`\`\`shipcode-plan\n${JSON.stringify(plan)}\n\`\`\``;
}

interface StepCalls {
  start: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
}

function makeDeps(opts: { generate?: AgentProvider['generate'] }): {
  deps: PipelineDeps;
  stepCalls: StepCalls;
} {
  const provider: AgentProvider = {
    id: 'claude-cli',
    supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
    generate:
      opts.generate ??
      vi.fn(
        async (): Promise<ProviderResponse> => ({
          rawOutput: planBlock(),
          exitCode: 0,
          resolvedModel: 'claude-sonnet-4-6',
          tokensUsed: { prompt: 11, completion: 7 },
          costUsd: 0.02,
        }),
      ),
    healthCheck: vi.fn(async () => ({ ok: true })),
  };
  const providers: ProviderRegistry = {
    for: () => provider,
    all: () => new Map([[provider.id, provider]]),
  };
  const events: PipelineEvent[] = [];

  const stepCalls: StepCalls = {
    start: vi.fn((input) => ({ id: `step-${input.phase}-${input.attempt}`, ...input })),
    complete: vi.fn(),
  };

  const deps = {
    emitter: { emit: vi.fn((event: PipelineEvent) => events.push(event)) },
    processManager: { kill: vi.fn() },
    threads: {
      updateStatus: vi.fn(),
      recordFailure: vi.fn(),
      getById: vi.fn(() => ({ id: 't1', projectId: 'project-1', prompt: 'do stuff' })),
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
    settings: { get: vi.fn(() => ({ ...DEFAULT_SETTINGS })), set: vi.fn() },
    providers,
    skills: { get: vi.fn(() => null), markQuarantined: vi.fn() },
    pipelineSteps: stepCalls,
  } as unknown as PipelineDeps;

  return { deps, stepCalls };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('pipeline_step_log lifecycle emission', () => {
  it('records started + completed for a successful phase', async () => {
    const { deps, stepCalls } = makeDeps({});
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'do stuff', '/tmp/project', null);
    await flush();

    expect(stepCalls.start).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 't1',
        phase: 'plan',
        provider: 'claude-cli',
        attempt: 1,
      }),
    );
    expect(stepCalls.complete).toHaveBeenCalledWith(
      'step-plan-1',
      expect.objectContaining({
        status: 'completed',
        resolvedModel: 'claude-sonnet-4-6',
        promptTokens: 11,
        completionTokens: 7,
        costUsd: 0.02,
      }),
    );
  });

  it('records failed when provider returns non-zero exitCode with providerError', async () => {
    const generate = vi.fn(
      async (): Promise<ProviderResponse> => ({
        rawOutput: '',
        exitCode: 1,
        providerError: { kind: 'rate_limit', message: 'OpenRouter rate limit', retryable: true },
      }),
    );
    const { deps, stepCalls } = makeDeps({ generate });
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'do stuff', '/tmp/project', null);
    await flush();

    expect(stepCalls.complete).toHaveBeenCalledWith(
      'step-plan-1',
      expect.objectContaining({
        status: 'failed',
        errorKind: 'rate_limit',
        errorMessage: 'OpenRouter rate limit',
      }),
    );
  });

  it('records aborted when providerError.kind is aborted', async () => {
    const generate = vi.fn(
      async (): Promise<ProviderResponse> => ({
        rawOutput: '',
        exitCode: 1,
        providerError: { kind: 'aborted', message: 'cancelled by user', retryable: false },
      }),
    );
    const { deps, stepCalls } = makeDeps({ generate });
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'do stuff', '/tmp/project', null);
    await flush();

    expect(stepCalls.complete).toHaveBeenCalledWith(
      'step-plan-1',
      expect.objectContaining({
        status: 'aborted',
        errorKind: 'aborted',
      }),
    );
  });

  it('records failed when provider.generate throws', async () => {
    const generate = vi.fn(async () => {
      throw new Error('network unreachable');
    });
    const { deps, stepCalls } = makeDeps({ generate });
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'do stuff', '/tmp/project', null);
    await flush();

    expect(stepCalls.complete).toHaveBeenCalledWith(
      'step-plan-1',
      expect.objectContaining({
        status: 'failed',
        errorKind: 'unknown',
        errorMessage: expect.stringContaining('network unreachable'),
      }),
    );
  });
});
