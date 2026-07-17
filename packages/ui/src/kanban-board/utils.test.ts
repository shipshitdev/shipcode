// @vitest-environment jsdom

import type {
  AppSettings,
  GhStatusMapping,
  GitHubIssueCacheRecord,
  Project,
  Thread,
} from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import {
  compareIssues,
  customCollisionDetection,
  formatDate,
  isApprovedAwaitingExecutionIssue,
  issueMatchesColumn,
  issueMatchesSection,
  issueReferenceLabel,
  resolveColumnDotColor,
  resolveIssueApprovalBadge,
  resolveIssuePhaseChip,
  resolveIssuePriorityBadge,
  resolveIssueRevisionBadge,
  rowToneFor,
  sectionToneFor,
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
    pausedPhase: null,
    pausedAt: null,
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

describe('issueReferenceLabel', () => {
  it('labels creating, quick, automation, and GitHub issues consistently', () => {
    expect(issueReferenceLabel(makeIssue(1, 'Creating'), true)).toBe('Creating');
    expect(issueReferenceLabel({ ...makeIssue(2, 'Quick'), isQuickMode: true }, false)).toBe(
      'Quick',
    );
    expect(issueReferenceLabel(makeIssue(-1_000_001, 'Automation'), false)).toBe('Auto');
    expect(issueReferenceLabel(makeIssue(283, 'GitHub issue'), false)).toBe('#283');
  });
});

describe('compareIssues', () => {
  it('keeps creating issues first and sorts creating ties by newest fetch time', () => {
    const oldCreating = {
      ...makeIssue(1, 'Old creating'),
      syncState: 'creating' as const,
      fetchedAt: '2026-04-13T12:00:00.000Z',
    };
    const newCreating = {
      ...makeIssue(2, 'New creating'),
      syncState: 'creating' as const,
      fetchedAt: '2026-04-13T13:00:00.000Z',
    };
    const normal = makeIssue(3, 'Normal');

    const sorted = [normal, oldCreating, newCreating].toSorted((a, b) =>
      compareIssues(a, b, 'priority'),
    );

    expect(sorted.map((issue) => issue.issueNumber)).toEqual([2, 1, 3]);
    expect(compareIssues(normal, newCreating, 'priority')).toBe(1);
  });

  it('sorts priority mode by label rank before issue number', () => {
    const issues = [
      makeIssue(12, 'No priority'),
      makeIssue(8, 'P1', ['priority:p1']),
      makeIssue(3, 'P0', ['priority:critical']),
      makeIssue(20, 'P2', ['priority:low']),
    ];

    const sorted = issues.toSorted((a, b) => compareIssues(a, b, 'priority'));

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

  it('sorts all project priority ranks and falls back to title for exact priority/id ties', () => {
    const p1 = { ...makeIssue(10, 'P1'), priorityRank: 'p1' as const };
    const p2 = { ...makeIssue(20, 'P2'), priorityRank: 'p2' as const };
    const p3 = { ...makeIssue(30, 'P3'), priorityRank: 'p3' as const };
    const alpha = makeIssue(40, 'Alpha');
    const beta = makeIssue(40, 'Beta');

    expect([p3, p2, p1].toSorted((a, b) => compareIssues(a, b, 'priority'))).toEqual([p1, p2, p3]);
    expect(compareIssues(alpha, beta, 'priority')).toBeLessThan(0);
  });

  it('recognizes remaining legacy priority label aliases', () => {
    const p0 = makeIssue(1, 'Highest', ['priority/highest']);
    const p1 = makeIssue(2, 'Medium', ['priority/medium']);
    const p2 = makeIssue(3, 'Low', ['priority/low']);
    const p3 = makeIssue(4, 'P3', ['priority:p3']);

    const sorted = [p3, p2, p1, p0].toSorted((a, b) => compareIssues(a, b, 'priority'));

    expect(sorted.map((issue) => issue.issueNumber)).toEqual([1, 2, 3, 4]);
  });

  it('recognizes remaining P0 priority aliases', () => {
    for (const [index, label] of [
      'p0',
      'priority/critical',
      'priority:urgent',
      'priority:high',
    ].entries()) {
      const issue = makeIssue(index + 1, label, [label]);
      expect(compareIssues(issue, makeIssue(99, 'No priority'), 'priority')).toBeLessThan(0);
    }
  });

  it('sorts title mode alphabetically and breaks ties by newest issue number', () => {
    const issues = [makeIssue(9, 'Beta'), makeIssue(4, 'Alpha'), makeIssue(11, 'Alpha')];

    const sorted = issues.toSorted((a, b) => compareIssues(a, b, 'title'));

    expect(sorted.map((issue) => issue.issueNumber)).toEqual([11, 4, 9]);
  });

  it('supports ascending and descending issue-number sorting', () => {
    const issues = [makeIssue(30, 'Third'), makeIssue(10, 'First'), makeIssue(20, 'Second')];

    expect(
      issues.toSorted((a, b) => compareIssues(a, b, 'id-asc')).map((issue) => issue.issueNumber),
    ).toEqual([10, 20, 30]);
    expect(
      issues.toSorted((a, b) => compareIssues(a, b, 'id-desc')).map((issue) => issue.issueNumber),
    ).toEqual([30, 20, 10]);
  });
});

describe('resolveIssuePhaseChip', () => {
  it('returns null when the issue status has no active card phase', () => {
    const issue = makeIssue(40, 'Closed');
    issue.pipelineStatus = 'closed';
    expect(resolveIssuePhaseChip(issue, SETTINGS, makeProject(), null)).toBeNull();
  });

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

  it('resolves executor and verifier phase chips with and without settings', () => {
    const executing = makeIssue(54, 'Execute');
    executing.pipelineStatus = 'executing';
    const verifying = makeIssue(55, 'Verify');
    verifying.pipelineStatus = 'verifying';

    expect(
      resolveIssuePhaseChip(
        executing,
        SETTINGS,
        makeProject(),
        makeThread({ executorResolvedModel: '<synthetic>', executorModel: 'codex' }),
      ),
    ).toMatchObject({ phase: 'executor', provider: 'claude', model: 'codex' });
    expect(resolveIssuePhaseChip(verifying, null, null, makeThread())).toMatchObject({
      phase: 'verifier',
      provider: 'claude',
      model: 'claude',
      effort: null,
    });
  });

  it('resolves phase chips when settings or stored phase models are missing', () => {
    const reviewing = makeIssue(56, 'Review without settings');
    reviewing.pipelineStatus = 'reviewing';
    const executing = makeIssue(57, 'Execute without settings');
    executing.pipelineStatus = 'executing';
    const verifying = makeIssue(58, 'Verify with settings');
    verifying.pipelineStatus = 'verifying';

    expect(resolveIssuePhaseChip(reviewing, null, null, makeThread())).toMatchObject({
      phase: 'reviewer',
      provider: 'claude',
      model: 'codex',
      effort: null,
    });
    expect(
      resolveIssuePhaseChip(reviewing, null, null, makeThread({ reviewerModel: null as never })),
    ).toMatchObject({
      phase: 'reviewer',
      provider: 'claude',
      model: 'codex',
      effort: null,
    });
    expect(resolveIssuePhaseChip(executing, null, null, makeThread())).toMatchObject({
      phase: 'executor',
      provider: 'claude',
      model: 'claude',
      effort: null,
    });
    expect(resolveIssuePhaseChip(verifying, null, null, null)).toMatchObject({
      phase: 'verifier',
      provider: 'claude',
      model: 'claude',
      effort: null,
    });
    expect(
      resolveIssuePhaseChip(
        verifying,
        SETTINGS,
        makeProject(),
        makeThread({ verifierModel: null as never }),
      ),
    ).toMatchObject({
      phase: 'verifier',
      provider: 'claude',
      model: 'claude',
      effort: 'medium',
    });
  });

  it('falls back to effective configured models when no thread model exists', () => {
    const reviewing = makeIssue(61, 'Review via settings');
    reviewing.pipelineStatus = 'reviewing';
    const executing = makeIssue(62, 'Execute via settings');
    executing.pipelineStatus = 'executing';
    const verifying = makeIssue(63, 'Verify via settings');
    verifying.pipelineStatus = 'verifying';

    expect(resolveIssuePhaseChip(reviewing, SETTINGS, makeProject(), null)).toMatchObject({
      phase: 'reviewer',
      provider: 'codex',
      model: 'codex',
    });
    expect(resolveIssuePhaseChip(executing, SETTINGS, makeProject(), null)).toMatchObject({
      phase: 'executor',
      provider: 'claude',
      model: 'claude',
    });
    expect(resolveIssuePhaseChip(verifying, SETTINGS, makeProject(), null)).toMatchObject({
      phase: 'verifier',
      provider: 'claude',
      model: 'claude',
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

  it('hides approval badges for closed states', () => {
    const issue = makeIssue(49, 'Completed issue');
    issue.pipelineStatus = 'completed';

    const badge = resolveIssueApprovalBadge(
      issue,
      { ...SETTINGS, requireApproval: true },
      makeProject(),
    );

    expect(badge).toBeNull();
  });

  it('hides approval badges for automation issues and missing settings', () => {
    const automation = makeIssue(-1_000_001, 'Automation');

    expect(resolveIssueApprovalBadge(automation, SETTINGS, makeProject())).toBeNull();
    expect(resolveIssueApprovalBadge(makeIssue(50, 'No settings'), null, makeProject())).toBeNull();
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
    const missingRoundBadge = resolveIssueRevisionBadge(
      issue,
      SETTINGS,
      makeProject(),
      makeThread({ reviewRound: null as never }),
    );

    expect(badge).toEqual({
      label: 'v1',
      title: 'Plan version 1; no revisions configured',
      variant: 'danger',
    });
    expect(missingRoundBadge?.label).toBe('v1');
  });

  it('hides revision badges for automation issues and missing settings', () => {
    const automation = makeIssue(-1_000_002, 'Automation');

    expect(resolveIssueRevisionBadge(automation, SETTINGS, makeProject(), null)).toBeNull();
    expect(
      resolveIssueRevisionBadge(makeIssue(54, 'No settings'), null, makeProject(), null),
    ).toBeNull();
  });

  it('tones revision badges for non-default statuses', () => {
    const statuses = [
      ['approval', 'warning'],
      ['completed', 'success'],
      ['closed', 'done'],
      ['deferred', 'default'],
      ['executing', 'info'],
    ] as const;

    for (const [status, variant] of statuses) {
      const issue = makeIssue(60, status);
      issue.pipelineStatus = status;
      expect(resolveIssueRevisionBadge(issue, SETTINGS, makeProject(), makeThread())?.variant).toBe(
        variant,
      );
    }
  });
});

describe('approved-awaiting-execution helpers', () => {
  it('flags approved awaiting-approval issues as execution-slot waiters', () => {
    const issue = makeIssue(52, 'Waiting for execution');
    issue.pipelineStatus = 'approval';
    issue.threadId = 'thread-52';

    expect(isApprovedAwaitingExecutionIssue(issue, new Set([issue.id]))).toBe(true);
    expect(isApprovedAwaitingExecutionIssue(issue, new Set())).toBe(false);
  });

  it('routes approved waiters to the agent column and waiting-execution section', () => {
    const issue = makeIssue(53, 'Approved waiter');
    issue.pipelineStatus = 'approval';
    issue.threadId = 'thread-53';
    const approvedIds = new Set([issue.id]);

    expect(issueMatchesColumn(issue, { key: 'agent', statuses: ['queued'] }, approvedIds)).toBe(
      true,
    );
    expect(issueMatchesColumn(issue, { key: 'human', statuses: ['approval'] }, approvedIds)).toBe(
      false,
    );
    expect(
      issueMatchesSection(issue, { key: 'waiting_execution', statuses: ['approval'] }, approvedIds),
    ).toBe(true);
    expect(
      issueMatchesSection(issue, { key: 'approval', statuses: ['approval'] }, approvedIds),
    ).toBe(false);
  });

  it('matches normal columns and sections when issues are not execution waiters', () => {
    const issue = makeIssue(56, 'Normal todo');
    issue.pipelineStatus = 'todo';

    expect(issueMatchesColumn(issue, { key: 'todo', statuses: ['todo'] })).toBe(true);
    expect(issueMatchesColumn(issue, { key: 'agent', statuses: ['executing'] })).toBe(false);
    expect(issueMatchesSection(issue, { key: 'backlog', statuses: ['todo'] })).toBe(true);
    expect(issueMatchesSection(issue, { key: 'active', statuses: ['executing'] })).toBe(false);
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

  it('renders P0 with danger variant', () => {
    const badge = resolveIssuePriorityBadge(withPriority('p0', 'P0'));
    expect(badge).not.toBeNull();
    expect(badge?.label).toBe('P0');
    expect(badge?.variant).toBe('danger');
    expect(badge?.rank).toBe('p0');
    expect(resolveIssuePriorityBadge(withPriority('p0', null))?.title).toBe(
      'Priority P0 — critical',
    );
  });

  it('renders P1 with warning variant', () => {
    const badge = resolveIssuePriorityBadge(withPriority('p1', 'High'));
    expect(badge?.label).toBe('P1');
    expect(badge?.variant).toBe('warning');
    expect(resolveIssuePriorityBadge(withPriority('p1', null))?.title).toBe('Priority P1 — high');
  });

  it('renders P2 and P3 with distinct variants', () => {
    expect(resolveIssuePriorityBadge(withPriority('p2', 'Medium'))?.variant).toBe('info');
    expect(resolveIssuePriorityBadge(withPriority('p2', 'Medium'))?.title).toBe(
      'Priority P2 — Medium',
    );
    expect(resolveIssuePriorityBadge(withPriority('p2', null))?.title).toBe('Priority P2 — medium');
    expect(resolveIssuePriorityBadge(withPriority('p3', 'Low'))?.variant).toBe('success');
    expect(resolveIssuePriorityBadge(withPriority('p3', 'Low'))?.title).toBe('Priority P3 — Low');
    expect(resolveIssuePriorityBadge(withPriority('p3', null))?.title).toBe('Priority P3 — low');
  });

  it('renders unknown raw option with accent variant and verbatim label', () => {
    const badge = resolveIssuePriorityBadge(withPriority(null, 'Icebox'));
    expect(badge?.label).toBe('Icebox');
    expect(badge?.variant).toBe('accent');
    expect(badge?.rank).toBeNull();
  });
});

describe('resolveColumnDotColor', () => {
  const opt = (name: string, color: string | null): { name: string; color: string | null } => ({
    name,
    color,
  });
  const mapping: GhStatusMapping = {
    todo: opt('Todo', 'GREEN'),
    inProgress: opt('In Progress', 'PURPLE'),
    humanReview: opt('Human Review', 'ORANGE'),
    deferred: opt('Deferred', 'GRAY'),
    done: opt('Done', 'BLUE'),
  };

  it('maps each macro column to its GitHub status option hex', () => {
    expect(resolveColumnDotColor('todo', mapping)).toBe('#1a7f37');
    expect(resolveColumnDotColor('agent', mapping)).toBe('#8250df');
    expect(resolveColumnDotColor('human', mapping)).toBe('#bc4c00');
    expect(resolveColumnDotColor('deferred', mapping)).toBe('#6e7781');
    expect(resolveColumnDotColor('done', mapping)).toBe('#0969da');
  });

  it('accepts lowercase color enums from the API', () => {
    expect(resolveColumnDotColor('todo', { ...mapping, todo: opt('Todo', 'green') })).toBe(
      '#1a7f37',
    );
  });

  it('falls back to null when mapping, option, or color is absent', () => {
    expect(resolveColumnDotColor('todo', null)).toBeNull();
    expect(resolveColumnDotColor('todo', undefined)).toBeNull();
    expect(resolveColumnDotColor('todo', { ...mapping, todo: null })).toBeNull();
    expect(resolveColumnDotColor('todo', { ...mapping, todo: opt('Todo', null) })).toBeNull();
    expect(resolveColumnDotColor('deferred', { ...mapping, deferred: undefined })).toBeNull();
  });

  it('falls back to null for an unrecognized GitHub color enum', () => {
    expect(resolveColumnDotColor('todo', { ...mapping, todo: opt('Todo', 'TEAL') })).toBeNull();
  });
});

describe('status and tone helpers', () => {
  it('maps issue statuses to row tones', () => {
    expect(rowToneFor('todo', true)).toBe('agent');
    expect(rowToneFor('failed')).toBe('danger');
    expect(rowToneFor('approval')).toBe('warning');
    expect(rowToneFor('completed')).toBe('success');
    expect(rowToneFor('closed')).toBe('done');
    expect(rowToneFor('executing')).toBe('agent');
    expect(rowToneFor('todo')).toBe('default');
  });

  it('maps section tone and formatting fallbacks', () => {
    expect(sectionToneFor('todo', 'failed')).toBe('danger');
    expect(sectionToneFor('human', 'approval')).toBe('warning');
    expect(sectionToneFor('agent', 'planning')).toBe('agent');
    expect(sectionToneFor('done', 'completed')).toBe('done');
    expect(sectionToneFor('todo', 'backlog')).toBe('default');
    expect(resolveColumnDotColor('todo', null)).toBeNull();
    expect(formatDate('2026-04-13T12:00:00.000Z')).toBe('Apr 13, 2026');
  });

  it('falls back to rectangle collisions when the pointer has no target', () => {
    const collisions = customCollisionDetection({
      active: {
        id: 'active',
        data: { current: {} },
        rect: { current: { initial: null, translated: null } },
      },
      collisionRect: { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 },
      droppableRects: new Map([
        ['drop-1', { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }],
      ]),
      droppableContainers: [
        {
          id: 'drop-1',
          key: 'drop-1',
          data: { current: {} },
          disabled: false,
          node: { current: document.createElement('div') },
          rect: { current: { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 } },
        },
      ],
      pointerCoordinates: null,
    });

    expect(collisions.map((collision) => collision.id)).toEqual(['drop-1']);
  });

  it('prefers pointer collisions when pointer coordinates hit a droppable', () => {
    const collisions = customCollisionDetection({
      active: {
        id: 'active',
        data: { current: {} },
        rect: { current: { initial: null, translated: null } },
      },
      collisionRect: { top: 100, bottom: 110, left: 100, right: 110, width: 10, height: 10 },
      droppableRects: new Map([
        ['pointer-drop', { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }],
        ['rect-drop', { top: 100, bottom: 110, left: 100, right: 110, width: 10, height: 10 }],
      ]),
      droppableContainers: [
        {
          id: 'pointer-drop',
          key: 'pointer-drop',
          data: { current: {} },
          disabled: false,
          node: { current: document.createElement('div') },
          rect: { current: { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 } },
        },
        {
          id: 'rect-drop',
          key: 'rect-drop',
          data: { current: {} },
          disabled: false,
          node: { current: document.createElement('div') },
          rect: {
            current: { top: 100, bottom: 110, left: 100, right: 110, width: 10, height: 10 },
          },
        },
      ],
      pointerCoordinates: { x: 5, y: 5 },
    });

    expect(collisions.map((collision) => collision.id)).toEqual(['pointer-drop']);
  });
});
