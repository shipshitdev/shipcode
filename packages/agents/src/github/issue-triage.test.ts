import { EventEmitter } from 'node:events';
import type { AppSettings } from '@shipcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenRouterClient,
  type OpenRouterClient as OpenRouterClientType,
} from '../providers/openrouter-http';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../health-check', () => ({
  shellExecEnv: () => ({ PATH: '/usr/bin' }),
}));

import {
  buildTriagePrompt,
  extractTriageRecommendations,
  triageGitHubIssues,
} from './issue-triage';

const baseIssue = {
  id: 'i1',
  projectId: 'p1',
  issueNumber: 12,
  title: 'Fix login crash',
  body: 'Crashes on submit',
  labels: ['bug'],
  assignee: null,
  state: 'open' as const,
  pipelineStatus: 'todo' as const,
  threadId: null,
  claimedAt: null,
  claimedBy: null,
  lastPhaseUpdate: null,
  lastStatusLabel: null,
  plannerModelOverride: null,
  reviewerModelOverride: null,
  executorModelOverride: null,
  verifierModelOverride: null,
  plannerModelIdOverride: null,
  reviewerModelIdOverride: null,
  executorModelIdOverride: null,
  verifierModelIdOverride: null,
  plannerReasoningEffortOverride: null,
  reviewerReasoningEffortOverride: null,
  executorReasoningEffortOverride: null,
  verifierReasoningEffortOverride: null,
  revisionCountOverride: null,
  requireApprovalOverride: null,
  linkedPrNumber: null,
  linkedPrUrl: null,
  linkedPrIsDraft: false,
  ciBlocked: false,
  failingChecks: [],
  unresolvedReviewComments: [],
  unresolvedReviewCommentCount: 0,
  prLastSyncAt: null,
  fetchedAt: '2026-01-01T00:00:00.000Z',
  priorityRank: null,
  priorityRaw: null,
  priorityFetchedAt: null,
  isQuickMode: false,
};

function triageSettings(
  overrides: Partial<
    Pick<
      AppSettings,
      'triageModel' | 'triageModelId' | 'triageReasoningEffort' | 'openrouterDefaultPaidModel'
    >
  > = {},
) {
  return {
    triageModel: 'openrouter' as const,
    triageModelId: null,
    triageReasoningEffort: 'high' as const,
    openrouterDefaultPaidModel: 'anthropic/claude-sonnet-4.6',
    ...overrides,
  };
}

function makeStubClient(): OpenRouterClientType {
  return {
    chat: vi.fn(async () => ({
      content:
        '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.9,"suggestedAgent":"codex","suggestedLabels":["shipcode:agent:codex"],"shouldStart":true,"needsHuman":false,"rationale":"Ready"}]}\n```',
      toolCalls: [],
      finishReason: 'stop',
      model: 'qwen/qwen3-coder:free',
      usage: null,
    })),
  } as unknown as OpenRouterClientType;
}

function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  proc.kill = vi.fn();
  return {
    proc,
    close: (code: number, output: { stdout?: string; stderr?: string } = {}) => {
      if (output.stdout) proc.stdout.emit('data', output.stdout);
      if (output.stderr) proc.stderr.emit('data', output.stderr);
      proc.emit('close', code);
    },
    failToSpawn: (message: string) => {
      proc.emit('error', new Error(message));
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('issue triage', () => {
  it('builds a prompt with compact issue data and the output contract', () => {
    const prompt = buildTriagePrompt([baseIssue]);

    expect(prompt).toContain('"number": 12');
    expect(prompt).toContain('```shipcode-issue-triage');
    expect(prompt).toContain('shipcode:agent:codex');
  });

  it('builds compact issue data when optional fields are missing', () => {
    const prompt = buildTriagePrompt([
      {
        ...baseIssue,
        body: null,
        priorityRaw: 'P1',
        priorityRank: 'p1',
      },
    ]);

    expect(prompt).toContain('"body": ""');
    expect(prompt).toContain('"priority": "P1"');
  });

  it('extracts and normalizes triage recommendations', () => {
    const result = extractTriageRecommendations(`
\`\`\`shipcode-issue-triage
{"issues":[{"issueNumber":12,"confidence":2,"suggestedAgent":"codex","suggestedLabels":["shipcode:agent:codex","not-real"],"shouldStart":true,"needsHuman":false,"rationale":"Ready"}]}
\`\`\`
`);

    expect(result).toEqual([
      {
        issueNumber: 12,
        confidence: 1,
        suggestedAgent: 'codex',
        suggestedLabels: ['shipcode:agent:codex'],
        shouldStart: true,
        needsHuman: false,
        rationale: 'Ready',
      },
    ]);
  });

  it('normalizes malformed optional recommendation fields', () => {
    const result = extractTriageRecommendations(`
\`\`\`shipcode-issue-triage metadata
{"issues":[{"issueNumber":12,"confidence":"not-a-number","suggestedAgent":"unknown","suggestedLabels":null,"shouldStart":false,"needsHuman":true,"rationale":123}]}
\`\`\`
`);

    expect(result).toEqual([
      {
        issueNumber: 12,
        confidence: 0,
        suggestedAgent: null,
        suggestedLabels: [],
        shouldStart: false,
        needsHuman: true,
        rationale: '',
      },
    ]);
  });

  it('derives OpenRouter include_reasoning from normalized triage effort', async () => {
    const client = makeStubClient();
    const chatSpy = client.chat as unknown as ReturnType<typeof vi.fn>;

    await triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      apiKey: 'k',
      settings: triageSettings({
        triageModelId: 'qwen/qwen3-coder:free',
        triageReasoningEffort: 'high',
      }),
      createOpenRouterClient: () => client,
    });

    expect(chatSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        model: 'qwen/qwen3-coder:free',
        include_reasoning: false,
        reasoning: { effort: 'none' },
      }),
    );
  });

  it('falls back to the requested OpenRouter triage model when response model is null', async () => {
    const client = {
      chat: vi.fn(async () => ({
        content:
          '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.9,"suggestedAgent":"codex","suggestedLabels":["shipcode:agent:codex"],"shouldStart":true,"needsHuman":false,"rationale":"Ready"}]}\n```',
        toolCalls: [],
        finishReason: 'stop',
        model: null,
        usage: null,
      })),
    } as unknown as OpenRouterClientType;

    const result = await triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      apiKey: 'k',
      settings: triageSettings({
        triageModelId: 'custom/triage-model',
      }),
      createOpenRouterClient: () => client,
    });

    expect(result.resolvedModel).toBe('custom/triage-model');
  });

  it('constructs the default OpenRouter client when no factory is supplied', async () => {
    const chatSpy = vi.spyOn(OpenRouterClient.prototype, 'chat').mockResolvedValueOnce({
      content:
        '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.9,"suggestedAgent":"codex","suggestedLabels":["shipcode:agent:codex"],"shouldStart":true,"needsHuman":false,"rationale":"Ready"}]}\n```',
      toolCalls: [],
      finishReason: 'stop',
      model: 'default/client-model',
      usage: null,
    });

    const result = await triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      apiKey: 'k',
      settings: triageSettings({ triageModelId: 'default/client-request' }),
    });

    expect(result.resolvedModel).toBe('default/client-model');
    chatSpy.mockRestore();
  });

  it('falls back to the default paid OpenRouter model and wraps OpenRouter API errors', async () => {
    const apiError = Object.assign(new Error('provider rejected model'), {
      name: 'OpenRouterError',
      status: 400,
      code: 'bad_model',
    });
    Object.setPrototypeOf(
      apiError,
      (await import('../providers/openrouter-http')).OpenRouterError.prototype,
    );
    const client = {
      chat: vi.fn(async () => {
        throw apiError;
      }),
    } as unknown as OpenRouterClientType;

    await expect(
      triageGitHubIssues({
        cwd: '/tmp/repo',
        issues: [baseIssue],
        apiKey: 'k',
        settings: triageSettings({
          triageModelId: null,
          triageReasoningEffort: 'low',
          openrouterDefaultPaidModel: 'anthropic/claude-sonnet-4.6',
        }),
        createOpenRouterClient: () => client,
      }),
    ).rejects.toThrow('provider rejected model');

    expect((client.chat as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4.6',
        include_reasoning: true,
        reasoning: { effort: 'high' },
      }),
    );
  });

  it('preserves non-OpenRouter errors from OpenRouter triage', async () => {
    const client = {
      chat: vi.fn(async () => {
        throw new Error('network exploded');
      }),
    } as unknown as OpenRouterClientType;

    await expect(
      triageGitHubIssues({
        cwd: '/tmp/repo',
        issues: [baseIssue],
        apiKey: 'k',
        settings: triageSettings(),
        createOpenRouterClient: () => client,
      }),
    ).rejects.toThrow('network exploded');
  });

  it('rejects OpenRouter triage when the API key is missing', async () => {
    await expect(
      triageGitHubIssues({
        cwd: '/tmp/repo',
        issues: [baseIssue],
        settings: triageSettings(),
      }),
    ).rejects.toThrow('OPENROUTER_API_KEY is not set');
  });

  it('runs Claude triage through stdin and unwraps the JSON result envelope', async () => {
    const fake = createFakeProc();
    spawnMock.mockReturnValueOnce(fake.proc);

    const promise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({
        triageModel: 'claude',
        triageModelId: 'claude-opus-4-1',
        triageReasoningEffort: 'medium',
      }),
    });

    await Promise.resolve();

    expect(spawnMock).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '-p',
        '--model',
        'claude-opus-4-1',
        '--output-format',
        'json',
        '--disallowedTools',
      ]),
      expect.objectContaining({
        cwd: '/tmp/repo',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin' },
      }),
    );
    const prompt = fake.proc.stdin.write.mock.calls[0][0] as string;
    expect(prompt).toContain('Review these GitHub issues');
    expect(spawnMock.mock.calls[0][1]).not.toContain(prompt);
    expect(fake.proc.stdin.end).toHaveBeenCalledTimes(1);

    fake.close(0, {
      stdout: JSON.stringify({
        type: 'result',
        result:
          '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.8,"suggestedAgent":"claude","suggestedLabels":["shipcode:agent:claude"],"shouldStart":false,"needsHuman":true,"rationale":"Needs scope"}]}\n```',
      }),
    });

    await expect(promise).resolves.toEqual({
      provider: 'claude',
      modelId: 'claude-opus-4-1',
      resolvedModel: 'claude-opus-4-1',
      recommendations: [
        {
          issueNumber: 12,
          confidence: 0.8,
          suggestedAgent: 'claude',
          suggestedLabels: ['shipcode:agent:claude'],
          shouldStart: false,
          needsHuman: true,
          rationale: 'Needs scope',
        },
      ],
    });
  });

  it('omits Claude thinking-token flags when reasoning maps to none', async () => {
    const fake = createFakeProc();
    spawnMock.mockReturnValueOnce(fake.proc);

    const promise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({
        triageModel: 'claude',
        triageModelId: null,
        triageReasoningEffort: 'none',
      }),
    });

    await Promise.resolve();

    expect(spawnMock.mock.calls[0][1]).not.toContain('--max-thinking-tokens');

    fake.close(0, {
      stdout:
        '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.8,"suggestedAgent":"claude","suggestedLabels":["shipcode:agent:claude"],"shouldStart":false,"needsHuman":true,"rationale":"Needs scope"}]}\n```',
    });

    await expect(promise).resolves.toMatchObject({ resolvedModel: 'claude' });
  });

  it('runs Codex triage with read-only sandbox flags', async () => {
    const fake = createFakeProc();
    spawnMock.mockReturnValueOnce(fake.proc);

    const promise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({
        triageModel: 'codex',
        triageModelId: null,
        triageReasoningEffort: 'xhigh',
      }),
    });

    await Promise.resolve();

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      [
        '-a',
        'never',
        '-c',
        expect.stringContaining('model_reasoning_effort='),
        'exec',
        '-',
        '--sandbox',
        'read-only',
      ],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );

    fake.close(0, {
      stdout:
        '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.5,"suggestedAgent":"openrouter","suggestedLabels":["shipcode:agent:openrouter/auto"],"shouldStart":true,"needsHuman":false,"rationale":"Cheap route"}]}\n```',
    });

    await expect(promise).resolves.toMatchObject({
      provider: 'codex',
      modelId: null,
      resolvedModel: 'codex',
      recommendations: [
        expect.objectContaining({
          suggestedAgent: 'openrouter',
          suggestedLabels: ['shipcode:agent:openrouter/auto'],
        }),
      ],
    });
  });

  it('passes explicit Codex triage models to the CLI', async () => {
    const fake = createFakeProc();
    spawnMock.mockReturnValueOnce(fake.proc);

    const promise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({
        triageModel: 'codex',
        triageModelId: 'gpt-5.4-mini',
      }),
    });

    await Promise.resolve();

    expect(spawnMock.mock.calls[0][1]).toEqual(expect.arrayContaining(['-m', 'gpt-5.4-mini']));

    fake.close(0, {
      stdout:
        '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.5,"suggestedAgent":"openrouter","suggestedLabels":["shipcode:agent:openrouter/auto"],"shouldStart":true,"needsHuman":false,"rationale":"Cheap route"}]}\n```',
    });

    await expect(promise).resolves.toMatchObject({ resolvedModel: 'gpt-5.4-mini' });
  });

  it('surfaces CLI spawn and exit failures with clamped CLI failure text', async () => {
    const spawnFailure = createFakeProc();
    spawnMock.mockReturnValueOnce(spawnFailure.proc);
    const spawnPromise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({ triageModel: 'claude' }),
    });

    await Promise.resolve();
    spawnFailure.failToSpawn('ENOENT');
    await expect(spawnPromise).rejects.toThrow('Claude CLI');

    const exitFailure = createFakeProc();
    spawnMock.mockReturnValueOnce(exitFailure.proc);
    const exitPromise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({ triageModel: 'codex' }),
    });

    await Promise.resolve();
    exitFailure.close(2, { stderr: 'permission denied\nfull trace' });
    await expect(exitPromise).rejects.toThrow('Codex CLI exited 2: permission denied');
  });

  it('times out stalled CLI triage processes', async () => {
    vi.useFakeTimers();
    const fake = createFakeProc();
    spawnMock.mockReturnValueOnce(fake.proc);

    const promise = triageGitHubIssues({
      cwd: '/tmp/repo',
      issues: [baseIssue],
      settings: triageSettings({ triageModel: 'claude' }),
    });
    const expectation = expect(promise).rejects.toThrow('Claude CLI timed out');

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(120_000);

    await expectation;
    expect(fake.proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects malformed triage responses before applying recommendations', () => {
    expect(() => extractTriageRecommendations('no fenced block')).toThrow(
      'No shipcode-issue-triage fenced block found',
    );
    expect(() => extractTriageRecommendations('```shipcode-issue-triage\n{"issues":\n```')).toThrow(
      'Failed to parse shipcode-issue-triage JSON',
    );
    expect(() =>
      extractTriageRecommendations('```shipcode-issue-triage\n{"issues":{}}\n```'),
    ).toThrow('Triage response must contain an issues array');
    expect(() =>
      extractTriageRecommendations('```shipcode-issue-triage\n{"issues":[{}]}\n```'),
    ).toThrow('Triage issueNumber must be an integer');
  });

  it('formats non-Error JSON parse failures', () => {
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'plain parse failure';
    });

    expect(() =>
      extractTriageRecommendations('```shipcode-issue-triage\n{"issues":[]}\n```'),
    ).toThrow('Failed to parse shipcode-issue-triage JSON: plain parse failure');

    parseSpy.mockRestore();
  });
});
