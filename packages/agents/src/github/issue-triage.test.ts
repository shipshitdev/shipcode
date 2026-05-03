import type { AppSettings } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../providers/openrouter-http';
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

function makeStubClient(): OpenRouterClient {
  return {
    chat: vi.fn(async () => ({
      content:
        '```shipcode-issue-triage\n{"issues":[{"issueNumber":12,"confidence":0.9,"suggestedAgent":"codex","suggestedLabels":["agent:codex"],"shouldStart":true,"needsHuman":false,"rationale":"Ready"}]}\n```',
      toolCalls: [],
      finishReason: 'stop',
      model: 'qwen/qwen3-coder:free',
      usage: null,
    })),
  } as unknown as OpenRouterClient;
}

describe('issue triage', () => {
  it('builds a prompt with compact issue data and the output contract', () => {
    const prompt = buildTriagePrompt([baseIssue]);

    expect(prompt).toContain('"number": 12');
    expect(prompt).toContain('```shipcode-issue-triage');
    expect(prompt).toContain('agent:codex');
  });

  it('extracts and normalizes triage recommendations', () => {
    const result = extractTriageRecommendations(`
\`\`\`shipcode-issue-triage
{"issues":[{"issueNumber":12,"confidence":2,"suggestedAgent":"codex","suggestedLabels":["agent:codex","not-real"],"shouldStart":true,"needsHuman":false,"rationale":"Ready"}]}
\`\`\`
`);

    expect(result).toEqual([
      {
        issueNumber: 12,
        confidence: 1,
        suggestedAgent: 'codex',
        suggestedLabels: ['agent:codex'],
        shouldStart: true,
        needsHuman: false,
        rationale: 'Ready',
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
});
