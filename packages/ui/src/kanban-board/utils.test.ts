import type { AppSettings, GitHubIssueCacheRecord, Project, Thread } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import {
  compareIssues,
  isApprovedAwaitingExecutionIssue,
  issueMatchesColumn,
  issueMatchesSection,
  resolveIssueApprovalBadge,
  resolveIssuePhaseChip,
  resolveIssueRevisionBadge,
} from './utils';

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
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
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
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
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
    revisionCountOverride: null,
    requireApprovalOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
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
    kind: 'pipeline' as const,
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'claude',
    executorModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
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

    expect(chip).toMatchObject({
      phase: 'planner',
      provider: 'claude',
      model: 'claude',
      effort: 'high',
    });
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

    expect(chip).toMatchObject({
      phase: 'planner',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    });
  });

  it('shows the effective effort when a provider degrades the stored value', () => {
    const issue = makeIssue(44, 'Review issue');
    issue.pipelineStatus = 'reviewing';

    const chip = resolveIssuePhaseChip(
      issue,
      { ...SETTINGS, reviewerReasoningEffort: 'xhigh' },
      makeProject(),
      makeThread({ reviewerResolvedModel: 'gpt-5.4' }),
    );

    expect(chip).toMatchObject({
      phase: 'reviewer',
      provider: 'codex',
      model: 'gpt-5.4',
      effort: 'xhigh',
    });
  });
});

describe('resolveIssueApprovalBadge', () => {
  it('returns null when approval is not required', () => {
    const badge = resolveIssueApprovalBadge(
      makeIssue(45, 'No approval needed'),
      { ...SETTINGS, requireApproval: false },
      makeProject(),
    );

    expect(badge).toBeNull();
  });

  it('reports app-default sourced approval', () => {
    const badge = resolveIssueApprovalBadge(
      makeIssue(46, 'App default approval'),
      { ...SETTINGS, requireApproval: true },
      makeProject(),
    );

    expect(badge).toEqual({
      label: 'Approval',
      title: 'Approval required via app default',
      source: 'app',
    });
  });

  it('reports project override approval', () => {
    const badge = resolveIssueApprovalBadge(
      makeIssue(47, 'Project approval'),
      { ...SETTINGS, requireApproval: false },
      makeProject({ requireApprovalOverride: true }),
    );

    expect(badge).toEqual({
      label: 'Approval',
      title: 'Approval required via project override',
      source: 'project',
    });
  });

  it('reports issue override approval', () => {
    const issue = makeIssue(48, 'Issue approval');
    issue.requireApprovalOverride = true;

    const badge = resolveIssueApprovalBadge(
      issue,
      { ...SETTINGS, requireApproval: false },
      makeProject({ requireApprovalOverride: false }),
    );

    expect(badge).toEqual({
      label: 'Approval',
      title: 'Approval required via issue override',
      source: 'issue',
    });
  });

  it('hides approval badges for done states', () => {
    const issue = makeIssue(49, 'Completed issue');
    issue.pipelineStatus = 'completed';

    const badge = resolveIssueApprovalBadge(
      issue,
      { ...SETTINGS, requireApproval: true },
      makeProject(),
    );

    expect(badge).toBeNull();
  });
});

describe('resolveIssueRevisionBadge', () => {
  it('shows the configured revision count before revisions start', () => {
    const badge = resolveIssueRevisionBadge(
      makeIssue(50, 'Revision count'),
      SETTINGS,
      makeProject(),
      null,
    );

    expect(badge).toEqual({
      label: '0',
      title: 'Configured revisions: 0',
    });
  });

  it('shows current revision progress once review rounds start', () => {
    const badge = resolveIssueRevisionBadge(
      makeIssue(51, 'Revision progress'),
      { ...SETTINGS, revisionCount: 3 },
      makeProject(),
      makeThread({ reviewRound: 2 }),
    );

    expect(badge).toEqual({
      label: '2/3',
      title: 'Current revision: 2 of 3',
    });
  });
});

describe('approved-awaiting-execution helpers', () => {
  it('flags approved awaiting-approval issues as execution-slot waiters', () => {
    const issue = makeIssue(52, 'Waiting for execution');
    issue.pipelineStatus = 'awaiting_approval';

    expect(isApprovedAwaitingExecutionIssue(issue, new Set([issue.id]))).toBe(true);
    expect(isApprovedAwaitingExecutionIssue(issue, new Set())).toBe(false);
  });

  it('routes approved waiters to the agent column and waiting-execution section', () => {
    const issue = makeIssue(53, 'Approved waiter');
    issue.pipelineStatus = 'awaiting_approval';
    const approvedIds = new Set([issue.id]);

    expect(issueMatchesColumn(issue, { key: 'agent', statuses: ['queued'] }, approvedIds)).toBe(
      true,
    );
    expect(
      issueMatchesColumn(issue, { key: 'human', statuses: ['awaiting_approval'] }, approvedIds),
    ).toBe(false);
    expect(
      issueMatchesSection(
        issue,
        { key: 'waiting_execution', statuses: ['awaiting_approval'] },
        approvedIds,
      ),
    ).toBe(true);
    expect(
      issueMatchesSection(issue, { key: 'awaiting', statuses: ['awaiting_approval'] }, approvedIds),
    ).toBe(false);
  });
});
