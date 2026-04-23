import type { AgentProvider, ProviderRegistry } from '@shipcode/agents';
import type { ProviderResponse } from '@shipcode/agents';
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

function makeDeps(promptTelemetryCreate = vi.fn()) {
  const provider: AgentProvider = {
    id: 'claude-cli',
    supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
    generate: vi.fn(async (): Promise<ProviderResponse> => ({
      rawOutput: planBlock(),
      exitCode: 0,
      resolvedModel: 'claude',
      tokensUsed: { prompt: 11, completion: 7 },
      costUsd: 0.02,
      promptTelemetry: {
        phase: 'plan',
        promptSize: { characters: 123, bytes: 123, lines: 5 },
        selectedMaterials: {
          count: 2,
          labels: ['issue prompt', '.agents/memory/MEMORY.md'],
          kinds: ['issue_prompt', 'repo_file_context'],
        },
      },
    })),
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
    promptTelemetry: { create: promptTelemetryCreate },
  } as unknown as PipelineDeps;

  return { deps, provider, events };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('pipeline prompt telemetry', () => {
  it('persists provider prompt telemetry per phase', async () => {
    const create = vi.fn();
    const { deps } = makeDeps(create);
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'do stuff', '/tmp/project', null);
    await flush();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 't1',
        phase: 'plan',
        provider: 'claude-cli',
        model: 'claude',
        promptCharacters: 123,
        promptBytes: 123,
        promptLines: 5,
        promptTokens: 11,
        completionTokens: 7,
        costUsd: 0.02,
        selectedMaterials: expect.objectContaining({
          kinds: expect.arrayContaining(['repo_file_context']),
        }),
      }),
    );
  });

  it('records telemetry persistence failures as non-fatal diagnostics', async () => {
    const create = vi.fn(() => {
      throw new Error('db unavailable');
    });
    const { deps } = makeDeps(create);
    const pipeline = createPipeline(deps);

    await pipeline.startPlanGeneration('t1', 'do stuff', '/tmp/project', null);
    await flush();

    expect(deps.plans.create).toHaveBeenCalled();
    expect(pipeline.getContext('t1')?.promptTelemetryDiagnostics).toEqual(['db unavailable']);
  });
});
