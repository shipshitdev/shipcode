// @vitest-environment jsdom

import type { DiffRecord, GitHubIssueCacheRecord, Thread } from '@shipcode/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineTab } from './PipelineTab';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue title',
    body: 'body',
    labels: ['agent:claude'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'verifying',
    threadId: 'thread-1',
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
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread title',
    prompt: 'prompt',
    status: 'verifying',
    kind: 'pipeline',
    worktreeBranch: 'ship/42-issue-title',
    worktreePath: '/tmp/worktree',
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'acme/repo',
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

function renderPipelineTab(diffs: DiffRecord[]) {
  render(
    <PipelineTab
      activeIssue={makeIssue()}
      activeThreadId="thread-1"
      checkpoints={[]}
      currentPhaseReasoningEfforts={{
        planner: 'high',
        reviewer: 'high',
        executor: 'high',
        verifier: 'high',
      }}
      currentPhaseSelections={{
        planner: { provider: 'claude', modelId: null },
        reviewer: { provider: 'codex', modelId: null },
        executor: { provider: 'claude', modelId: null },
        verifier: { provider: 'claude', modelId: null },
      }}
      diffs={diffs}
      effectivePhaseResolvedModels={{
        planner: 'claude',
        reviewer: 'codex',
        executor: 'claude',
        verifier: 'claude',
      }}
      effectiveRequireApproval={false}
      effectiveRevisionCount={1}
      executorEditable={false}
      hasPrFeedbackBlockers={false}
      inheritedPhaseReasoningEfforts={{
        planner: 'high',
        reviewer: 'high',
        executor: 'high',
        verifier: 'high',
      }}
      inheritedRequireApproval={true}
      inheritedRevisionCount={0}
      isSubmitting={false}
      linkedPrUrl={null}
      phaseEffortSelectValues={{
        planner: '__inherit__',
        reviewer: '__inherit__',
        executor: '__inherit__',
        verifier: '__inherit__',
      }}
      phaseModelValidation={{}}
      phaseSelectValues={{
        planner: '__inherit__',
        reviewer: '__inherit__',
        executor: '__inherit__',
        verifier: '__inherit__',
      }}
      projectDefaultPhaseSelections={{
        planner: { provider: 'claude', modelId: null },
        reviewer: { provider: 'codex', modelId: null },
        executor: { provider: 'claude', modelId: null },
        verifier: { provider: 'claude', modelId: null },
      }}
      requireApprovalSelectValue="__inherit__"
      revisionCountSelectValue="__inherit__"
      thread={makeThread()}
      onPhaseAgentChange={vi.fn()}
      onPhaseEffortChange={vi.fn()}
      onRequireApprovalChange={vi.fn()}
      onRevisionCountChange={vi.fn()}
      onPhaseOpenRouterSlugBlur={vi.fn()}
      onRestoreCheckpoint={vi.fn()}
      onStabilizePr={vi.fn()}
    />,
  );
}

describe('PipelineTab', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the persisted execution diff when available', () => {
    renderPipelineTab([
      {
        id: 'diff-1',
        threadId: 'thread-1',
        filePath: 'src/foo.ts',
        action: 'modify',
        diffContent:
          'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1 +1 @@\n-console.log("old")\n+console.log("new")',
        beforeHash: '1111111',
        afterHash: '2222222',
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(screen.getByText('Code Diff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'src/foo.ts' })).toBeInTheDocument();
  });

  it('shows a waiting message before a diff exists', () => {
    renderPipelineTab([]);

    expect(screen.getByText('Human Approval')).toBeInTheDocument();
    expect(screen.getByText('Revisions')).toBeInTheDocument();
    expect(screen.getByText(/Current workflow uses 1 revision/i)).toBeInTheDocument();
    expect(screen.getByText('Code Diff')).toBeInTheDocument();
    expect(
      screen.getByText('Diff will appear here after execution produces changes.'),
    ).toBeInTheDocument();
  });
});
