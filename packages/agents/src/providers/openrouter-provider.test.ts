import type { AppSettings } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamParser } from '../stream-parser';
import { type OpenRouterClient, OpenRouterError } from './openrouter-http';
import { createOpenRouterProvider } from './openrouter-provider';
import type { ProviderRequest } from './types';

function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    phase: 'plan',
    prompt: 'do stuff',
    cwd: '/tmp/wt',
    projectPath: '/tmp/proj',
    signal: new AbortController().signal,
    threadId: 't1',
    ...overrides,
  };
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeStubClient(
  result: Partial<Awaited<ReturnType<OpenRouterClient['chat']>>> = {},
): OpenRouterClient {
  return {
    chat: vi.fn(async () => ({
      content: 'MOCK',
      toolCalls: [],
      finishReason: 'stop',
      model: 'anthropic/claude-sonnet-4.6',
      usage: null,
      ...result,
    })),
  } as unknown as OpenRouterClient;
}

describe('createOpenRouterProvider', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('supports all five phases as of Tier 2', () => {
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
    });
    expect(provider.supports.has('plan')).toBe(true);
    expect(provider.supports.has('review')).toBe(true);
    expect(provider.supports.has('revision')).toBe(true);
    expect(provider.supports.has('verify')).toBe(true);
    expect(provider.supports.has('execute')).toBe(true);
  });

  it('returns auth error when API key is missing', async () => {
    const provider = createOpenRouterProvider({
      getApiKey: () => undefined,
      getSettings: () => settings(),
    });
    const res = await provider.generate(req());
    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('auth');
    expect(res.providerError?.retryable).toBe(false);
  });

  it('execute phase refuses when cwd equals projectPath (defense in depth)', async () => {
    // Execute with cwd === projectPath should hit the worktree safety
    // guard inside the execute harness and fail cleanly, NOT mutate
    // the project root. (The full happy path for execute is covered
    // in openrouter-execute.test.ts.)
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
    });
    const res = await provider.generate(
      req({ phase: 'execute', cwd: '/tmp/proj', projectPath: '/tmp/proj' }),
    );
    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('unexpected_stop');
    expect(res.providerError?.message).toMatch(/worktree/i);
  });

  it('execute phase uses the executor model setting when no model hint is present', async () => {
    const stub = makeStubClient({ content: 'no tools', model: 'qwen/qwen3-coder:free' });
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterExecutorModel: 'qwen/qwen3-coder:free' }),
      createClient: () => stub,
    });

    const res = await provider.generate(req({ phase: 'execute', cwd: '/tmp/wt-openrouter' }));

    expect(res.exitCode).toBe(1);
    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'qwen/qwen3-coder:free' }),
    );
  });

  it('surfaces content + resolvedModel + tokens on successful plan phase', async () => {
    const stub = makeStubClient({
      content: '```shipcode-plan\n{"objective":"test"}\n```',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));
    expect(res.exitCode).toBe(0);
    expect(res.rawOutput).toContain('shipcode-plan');
    expect(res.resolvedModel).toBe('anthropic/claude-sonnet-4.6');
    expect(res.tokensUsed).toEqual({ prompt: 100, completion: 50 });
  });

  it('includes selected prompt materials in prompt telemetry', async () => {
    const stub = makeStubClient();
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    const res = await provider.generate(
      req({
        promptMaterialSummary: {
          files: ['src/index.ts'],
          totalBytes: 12,
          truncated: false,
        },
      }),
    );

    expect(res.promptTelemetry?.selectedMaterials).toEqual({
      files: ['src/index.ts'],
      totalBytes: 12,
      truncated: false,
    });
  });

  it('surfaces clarification requests from plan output', async () => {
    const clarification = {
      id: 'clarify-1',
      threadId: 't1',
      phase: 'plan',
      summary: 'Need one product decision.',
      questions: [
        {
          id: 'scope',
          title: 'Scope',
          prompt: 'Pick a scope.',
          description: null,
          choices: [
            { id: 'narrow', label: 'Narrow', description: 'Smallest useful version.' },
            { id: 'wide', label: 'Wide', description: 'Include adjacent cleanup.' },
          ],
          allowFreeform: false,
          freeformPlaceholder: null,
        },
      ],
    };
    const stub = makeStubClient({
      content: `\`\`\`shipcode-clarification\n${JSON.stringify(clarification)}\n\`\`\``,
      model: null,
      usage: null,
    });
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));

    expect(res.exitCode).toBe(0);
    expect(res.resolvedModel).toBe('openrouter/auto');
    expect(res.tokensUsed).toBeUndefined();
    expect(res.clarificationRequest?.summary).toBe('Need one product decision.');
  });

  it('honors modelHint over per-phase setting', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterPlannerModel: 'qwen/qwen3-coder:free' }),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'plan', modelHint: 'openrouter/auto' }));

    expect(chatSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ model: 'openrouter/auto' }));
  });

  it('normalizes legacy OpenRouter Claude 4.6 aliases before sending', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'plan', modelHint: 'anthropic/claude-sonnet-4-6' }));

    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-4.6' }),
    );
  });

  it('falls back to raw model ids when normalization has no mapping', async () => {
    const hinted = makeStubClient();
    const hintedSpy = hinted.chat as unknown as ReturnType<typeof vi.fn>;
    const hintedProvider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => hinted,
    });
    await hintedProvider.generate(req({ phase: 'plan', modelHint: 'custom/hinted-model' }));
    expect(hintedSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'custom/hinted-model' }),
    );

    const perPhase = makeStubClient();
    const perPhaseSpy = perPhase.chat as unknown as ReturnType<typeof vi.fn>;
    const perPhaseProvider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterPlannerModel: 'custom/planner-model' }),
      createClient: () => perPhase,
    });
    await perPhaseProvider.generate(req({ phase: 'revision' }));
    expect(perPhaseSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'custom/planner-model' }),
    );

    const defaulted = makeStubClient();
    const defaultedSpy = defaulted.chat as unknown as ReturnType<typeof vi.fn>;
    const defaultedProvider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterDefaultPaidModel: 'custom/default-model' }),
      createClient: () => defaulted,
    });
    await defaultedProvider.generate(req({ phase: 'verify' }));
    expect(defaultedSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'custom/default-model' }),
    );
  });

  it('falls back to raw blank model settings when normalization returns null', async () => {
    const hinted = makeStubClient();
    const hintedSpy = hinted.chat as unknown as ReturnType<typeof vi.fn>;
    const hintedProvider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => hinted,
    });
    await hintedProvider.generate(req({ phase: 'plan', modelHint: '   ' }));
    expect(hintedSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ model: '   ' }));

    const perPhase = makeStubClient();
    const perPhaseSpy = perPhase.chat as unknown as ReturnType<typeof vi.fn>;
    const perPhaseProvider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterPlannerModel: '   ' }),
      createClient: () => perPhase,
    });
    await perPhaseProvider.generate(req({ phase: 'plan' }));
    expect(perPhaseSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ model: '   ' }));

    const defaulted = makeStubClient();
    const defaultedSpy = defaulted.chat as unknown as ReturnType<typeof vi.fn>;
    const defaultedProvider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterDefaultPaidModel: '' }),
      createClient: () => defaulted,
    });
    await defaultedProvider.generate(req({ phase: 'verify' }));
    expect(defaultedSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ model: '' }));
  });

  it('omits the system prompt for unsupported provider phases', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'diagnose' as ProviderRequest['phase'] }));

    expect(chatSpy.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'do stuff' }]);
  });

  it('passes low through to OpenRouter instead of disabling reasoning', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'plan', phaseHints: { reasoningEffort: 'low' } }));

    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        include_reasoning: true,
        reasoning: { effort: 'low' },
      }),
    );
  });

  it('passes none through to OpenRouter and disables reasoning output', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'plan', phaseHints: { reasoningEffort: 'none' } }));

    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        include_reasoning: false,
        reasoning: { effort: 'none' },
      }),
    );
  });

  it('disables reasoning for OpenRouter models without reasoning support', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterPlannerModel: 'qwen/qwen3-coder:free' }),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'plan', phaseHints: { reasoningEffort: 'high' } }));

    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        model: 'qwen/qwen3-coder:free',
        include_reasoning: false,
        reasoning: { effort: 'none' },
      }),
    );
  });

  it('uses per-phase setting when modelHint is absent', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings({ openrouterReviewerModel: 'qwen/qwen3-coder:free' }),
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'review' }));

    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ model: 'qwen/qwen3-coder:free' }),
    );
  });

  it('falls back to tier default when no hint and no per-phase override', async () => {
    const stub = makeStubClient();
    const chatSpy = stub.chat as unknown as ReturnType<typeof vi.fn>;
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(), // defaults: openrouterDefaultPaidModel = 'openrouter/auto'
      createClient: () => stub,
    });

    await provider.generate(req({ phase: 'verify' }));

    expect(chatSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ model: 'openrouter/auto' }));
  });

  it('maps OpenRouterError kinds to providerError with preserved retryable flag', async () => {
    const failingStub = {
      chat: vi.fn(async () => {
        throw new OpenRouterError('rate_limit', 'slow down', true, 429);
      }),
    } as unknown as OpenRouterClient;

    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => failingStub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));
    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('rate_limit');
    expect(res.providerError?.retryable).toBe(true);
  });

  it('maps unknown thrown errors to non-retryable provider errors', async () => {
    const failingStub = {
      chat: vi.fn(async () => {
        throw 'plain failure';
      }),
    } as unknown as OpenRouterClient;

    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => failingStub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));

    expect(res.exitCode).toBe(1);
    expect(res.providerError).toEqual({
      kind: 'unknown',
      message: 'plain failure',
      retryable: false,
    });
  });

  it('maps thrown Error instances to their message', async () => {
    const failingStub = {
      chat: vi.fn(async () => {
        throw new Error('typed failure');
      }),
    } as unknown as OpenRouterClient;

    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => failingStub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));

    expect(res.providerError).toEqual({
      kind: 'unknown',
      message: 'typed failure',
      retryable: false,
    });
  });

  it('surfaces aborted kind through the provider boundary', async () => {
    const abortedStub = {
      chat: vi.fn(async () => {
        throw new OpenRouterError('aborted', 'cancelled', false);
      }),
    } as unknown as OpenRouterClient;

    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => abortedStub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));
    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('aborted');
  });

  it('output is StreamParser-compatible for all Tier 1 phases', async () => {
    // Integration check: prompts already emit fenced blocks, so if the
    // model's content contains a well-formed shipcode-plan block, the
    // existing StreamParser should extract it without modification.
    const planJson = JSON.stringify({
      id: 'p1',
      threadId: 't1',
      version: 1,
      objective: 'test',
      files: [{ path: 'src/file.ts', action: 'modify', description: 'Update the file' }],
      steps: [
        {
          order: 1,
          description: 'Inspect the target',
          files: ['src/file.ts'],
          rationale: 'Baseline',
        },
        {
          order: 2,
          description: 'Implement the change',
          files: ['src/file.ts'],
          rationale: 'Feature work',
        },
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
    });
    const stub = makeStubClient({
      content: `\`\`\`shipcode-plan\n${planJson}\n\`\`\``,
    });
    const provider = createOpenRouterProvider({
      getApiKey: () => 'k',
      getSettings: () => settings(),
      createClient: () => stub,
    });

    const res = await provider.generate(req({ phase: 'plan' }));
    const parser = new StreamParser();
    parser.feed(res.rawOutput);
    const parsed = parser.extractPlan();
    expect(parsed.success).toBe(true);
    expect(parsed.data?.objective).toBe('test');
  });

  it('reports health based on whether an API key is available', async () => {
    await expect(
      createOpenRouterProvider({
        getApiKey: () => undefined,
        getSettings: () => settings(),
      }).healthCheck(),
    ).resolves.toEqual({ ok: false, reason: 'OPENROUTER_API_KEY not set' });

    await expect(
      createOpenRouterProvider({
        getApiKey: () => 'k',
        getSettings: () => settings(),
      }).healthCheck(),
    ).resolves.toEqual({ ok: true });
  });
});
