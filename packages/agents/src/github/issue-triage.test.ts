import { describe, expect, it } from 'vitest';
import { buildTriagePrompt, extractTriageRecommendations } from './issue-triage';

describe('issue triage', () => {
  it('builds a prompt with compact issue data and the output contract', () => {
    const prompt = buildTriagePrompt([
      {
        id: 'i1',
        projectId: 'p1',
        issueNumber: 12,
        title: 'Fix login crash',
        body: 'Crashes on submit',
        labels: ['bug'],
        assignee: null,
        state: 'open',
        pipelineStatus: 'todo',
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
      },
    ]);

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
});
