import type { AppSettings, GitHubIssueCacheRecord, Project, Thread } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { compareIssues, resolveIssuePhaseChip } from './utils';

function makeIssue(
  issueNumber: number,
  title: string,
  labels: string[] = [],
): GitHubIssueCacheRecord {
  return {
    id: `issue-${issueNumber}`,
    projectId: 'project-1',
    issueNumber,
    title,
    body: null,
    labels,
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
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date('2026-04-13T12:00:00.000Z').toISOString(),
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'shipcode',
    path: '/tmp/shipcode',
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubProjectUrl: null,
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
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test thread',
    prompt: 'Prompt',
    status: 'planning',
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'claude',
    executorModel: 'claude',
    reviewRound: 0,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
    lastError: null,
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

const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  plannerModel: 'claude',
  reviewerModel: 'codex',
  executorModel: 'claude',
  verifierModel: 'claude',
  plannerReasoningEffort: 'high',
  reviewerReasoningEffort: 'medium',
  executorReasoningEffort: 'high',
  verifierReasoningEffort: 'medium',
};

describe('compareIssues', () => {
  it('sorts priority mode by label rank before issue number', () => {
    const issues = [
      makeIssue(12, 'No priority'),
      makeIssue(8, 'P1', ['priority:p1']),
      makeIssue(3, 'P0', ['priority:critical']),
      makeIssue(20, 'P2', ['priority:low']),
    ];

    const sorted = [...issues].sort((a, b) => compareIssues(a, b, 'priority'));

    expect(sorted.map((issue) => issue.issueNumber)).toEqual([3, 8, 20, 12]);
  });

  it('sorts title mode alphabetically and breaks ties by newest issue number', () => {
    const issues = [makeIssue(9, 'Beta'), makeIssue(4, 'Alpha'), makeIssue(11, 'Alpha')];

    const sorted = [...issues].sort((a, b) => compareIssues(a, b, 'title'));

    expect(sorted.map((issue) => issue.issueNumber)).toEqual([11, 4, 9]);
  });

  it('supports ascending and descending issue-number sorting', () => {
    const issues = [makeIssue(30, 'Third'), makeIssue(10, 'First'), makeIssue(20, 'Second')];

    expect(
      [...issues].sort((a, b) => compareIssues(a, b, 'id-asc')).map((issue) => issue.issueNumber),
    ).toEqual([10, 20, 30]);
    expect(
      [...issues].sort((a, b) => compareIssues(a, b, 'id-desc')).map((issue) => issue.issueNumber),
    ).toEqual([30, 20, 10]);
  });
});

describe('resolveIssuePhaseChip', () => {
  it('falls back when a resolved model contains the synthetic placeholder', () => {
    const issue = makeIssue(42, 'Planning issue');
    issue.pipelineStatus = 'planning';

    const chip = resolveIssuePhaseChip(
      issue,
      SETTINGS,
      makeProject(),
      makeThread({ plannerResolvedModel: '<synthetic>', plannerModel: 'claude' }),
    );

    expect(chip).toMatchObject({ phase: 'planner', model: 'claude', effort: 'high' });
  });

  it('keeps real resolved models when they are concrete', () => {
    const issue = makeIssue(43, 'Planning issue');
    issue.pipelineStatus = 'planning';

    const chip = resolveIssuePhaseChip(
      issue,
      SETTINGS,
      makeProject(),
      makeThread({ plannerResolvedModel: 'claude-sonnet-4-6' }),
    );

    expect(chip).toMatchObject({ phase: 'planner', model: 'claude-sonnet-4-6' });
  });
});
