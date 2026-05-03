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
  resolveIssuePriorityBadge,
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
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
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
    githubStatusMapping: null,
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
    automationId: null,
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
    doneAt: null,
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

  it('priorityRank from project field beats labels', () => {
    // Issue #5 has labels saying p3 but project field says p0 — rank wins.
    const fieldP0: GitHubIssueCacheRecord = {
      ...makeIssue(5, 'Project P0 (label says low)', ['priority:p3']),
      priorityRank: 'p0',
      priorityRaw: 'P0',
      priorityFetchedAt: '2026-04-27T00:00:00.000Z',
    };
    // Issue #2 has only label-based priority
    const labelP0 = makeIssue(2, 'Label P0', ['priority:p0']);
    // Issue #99 has nothing
    const noPriority = makeIssue(99, 'No priority');

    const sorted = [fieldP0, labelP0, noPriority].sort((a, b) => compareIssues(a, b, 'priority'));

    // Both should rank ahead of noPriority. Field-based and label-based P0 are tied
    // at rank 0; tie-break is then descending by issue number.
    expect(sorted[0].issueNumber).toBe(5);
    expect(sorted[sorted.length - 1].issueNumber).toBe(99);
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
  it('hides the badge when zero revisions are configured and no thread exists', () => {
    const badge = resolveIssueRevisionBadge(
      makeIssue(50, 'Revision count'),
      SETTINGS,
      makeProject(),
      null,
    );

    expect(badge).toBeNull();
  });

  it('shows configured revision count before a thread starts when revisions are enabled', () => {
    const badge = resolveIssueRevisionBadge(
      makeIssue(51, 'Revision count'),
      { ...SETTINGS, revisionCount: 3 },
      makeProject(),
      null,
    );

    expect(badge).toEqual({
      label: '3',
      title: 'Configured revisions: 3',
      variant: 'default',
    });
  });

  it('shows the current plan version once a thread exists', () => {
    const badge = resolveIssueRevisionBadge(
      makeIssue(52, 'Revision progress'),
      { ...SETTINGS, revisionCount: 3 },
      makeProject(),
      makeThread({ reviewRound: 2 }),
    );

    expect(badge).toEqual({
      label: 'v3',
      title: 'Plan version 3; configured revisions: 3',
      variant: 'default',
    });
  });

  it('tones the plan version badge by issue status', () => {
    const issue = makeIssue(53, 'Failed revision progress');
    issue.pipelineStatus = 'failed';

    const badge = resolveIssueRevisionBadge(issue, SETTINGS, makeProject(), makeThread());

    expect(badge).toEqual({
      label: 'v1',
      title: 'Plan version 1; no revisions configured',
      variant: 'danger',
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

describe('resolveIssuePriorityBadge', () => {
  function withPriority(
    rank: 'p0' | 'p1' | 'p2' | 'p3' | null,
    raw: string | null,
  ): GitHubIssueCacheRecord {
    return {
      ...makeIssue(1, 'Issue'),
      priorityRank: rank,
      priorityRaw: raw,
      priorityFetchedAt: '2026-04-27T00:00:00.000Z',
    };
  }

  it('returns null when no priority data is present', () => {
    expect(resolveIssuePriorityBadge(makeIssue(1, 'Issue'))).toBeNull();
  });

  it('renders P0 with warning variant', () => {
    const badge = resolveIssuePriorityBadge(withPriority('p0', 'P0'));
    expect(badge).not.toBeNull();
    expect(badge?.label).toBe('P0');
    expect(badge?.variant).toBe('warning');
    expect(badge?.rank).toBe('p0');
  });

  it('renders P1 with info variant', () => {
    const badge = resolveIssuePriorityBadge(withPriority('p1', 'High'));
    expect(badge?.label).toBe('P1');
    expect(badge?.variant).toBe('info');
  });

  it('renders P2 and P3 with default variant', () => {
    expect(resolveIssuePriorityBadge(withPriority('p2', 'Medium'))?.variant).toBe('default');
    expect(resolveIssuePriorityBadge(withPriority('p3', 'Low'))?.variant).toBe('default');
  });

  it('renders unknown raw option with accent variant and verbatim label', () => {
    const badge = resolveIssuePriorityBadge(withPriority(null, 'Icebox'));
    expect(badge?.label).toBe('Icebox');
    expect(badge?.variant).toBe('accent');
    expect(badge?.rank).toBeNull();
  });
});
