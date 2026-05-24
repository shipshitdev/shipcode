import { type CollisionDetection, pointerWithin, rectIntersection } from '@dnd-kit/core';
import type {
  AppSettings,
  GhStatusMapping,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  Thread,
} from '@/lib/shipcode';
import {
  type ExecutorModel,
  formatProviderReasoningEffort,
  getIssueCardPhase,
  ISSUE_PIPELINE_STATUS,
  resolveExecutorModelForIssue,
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
  resolvePhaseReasoningEffort,
  resolveRequireApprovalStateForIssue,
  resolveRevisionCountForIssue,
  sanitizeResolvedModel,
} from '@/lib/shipcode';
import { ACTIVE_STATUSES } from './constants';
import type {
  BoardColumn,
  BoardSortOrder,
  ColumnKey,
  IssueApprovalBadge,
  IssuePhaseChip,
  IssuePriorityBadge,
  IssueRevisionBadge,
  PhaseSection,
  RowTone,
} from './types';

export function isApprovedAwaitingExecutionIssue(
  issue: GitHubIssueCacheRecord,
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>,
): boolean {
  return (
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.approval &&
    approvedAwaitingExecutionIssueIds?.has(issue.id) === true
  );
}

export function isIssueCreating(issue: GitHubIssueCacheRecord): boolean {
  return issue.syncState === 'creating';
}

export const AUTOMATION_ISSUE_NUMBER_BASE = -1_000_000;

export function isAutomationIssue(issue: GitHubIssueCacheRecord): boolean {
  return !issue.isQuickMode && issue.issueNumber <= AUTOMATION_ISSUE_NUMBER_BASE;
}

export function issueMatchesColumn(
  issue: GitHubIssueCacheRecord,
  column: Pick<BoardColumn, 'key' | 'statuses'>,
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>,
): boolean {
  if (isApprovedAwaitingExecutionIssue(issue, approvedAwaitingExecutionIssueIds)) {
    return column.key === 'agent';
  }
  return column.statuses.includes(issue.pipelineStatus);
}

export function issueMatchesSection(
  issue: GitHubIssueCacheRecord,
  section: Pick<PhaseSection, 'key' | 'statuses'>,
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>,
): boolean {
  const approvedAwaitingExecution = isApprovedAwaitingExecutionIssue(
    issue,
    approvedAwaitingExecutionIssueIds,
  );
  if (section.key === 'waiting_execution') return approvedAwaitingExecution;
  if (section.key === 'approval') {
    return issue.pipelineStatus === ISSUE_PIPELINE_STATUS.approval && !approvedAwaitingExecution;
  }
  return section.statuses.includes(issue.pipelineStatus);
}

export function statusDotColorClass(
  status: IssuePipelineStatus,
  approvedAwaitingExecution = false,
): string {
  if (approvedAwaitingExecution) return 'bg-agent';
  if (status === ISSUE_PIPELINE_STATUS.failed) return 'bg-danger';
  if (
    status === ISSUE_PIPELINE_STATUS.approval ||
    status === ISSUE_PIPELINE_STATUS.clarifying ||
    status === ISSUE_PIPELINE_STATUS.paused
  )
    return 'bg-warning';
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'bg-success';
  if (status === ISSUE_PIPELINE_STATUS.closed) return 'bg-done';
  if (ACTIVE_STATUSES.includes(status)) return 'bg-agent';
  return 'bg-muted-foreground/40';
}

export function statusDotTextColorClass(
  status: IssuePipelineStatus,
  approvedAwaitingExecution = false,
): string {
  if (approvedAwaitingExecution) return 'text-agent';
  if (status === ISSUE_PIPELINE_STATUS.failed) return 'text-danger';
  if (
    status === ISSUE_PIPELINE_STATUS.approval ||
    status === ISSUE_PIPELINE_STATUS.clarifying ||
    status === ISSUE_PIPELINE_STATUS.paused
  )
    return 'text-warning';
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'text-success';
  if (status === ISSUE_PIPELINE_STATUS.closed) return 'text-done';
  if (ACTIVE_STATUSES.includes(status)) return 'text-agent';
  return 'text-muted-foreground/40';
}

export function statusDotFill(
  status: IssuePipelineStatus,
  approvedAwaitingExecution = false,
): number {
  if (status === ISSUE_PIPELINE_STATUS.completed || status === ISSUE_PIPELINE_STATUS.closed)
    return 1;
  if (
    status === ISSUE_PIPELINE_STATUS.executing ||
    status === ISSUE_PIPELINE_STATUS.testing ||
    status === ISSUE_PIPELINE_STATUS.verifying ||
    status === ISSUE_PIPELINE_STATUS.shipping ||
    approvedAwaitingExecution
  )
    return 0.75;
  if (
    status === ISSUE_PIPELINE_STATUS.reviewing ||
    status === ISSUE_PIPELINE_STATUS.revising ||
    status === ISSUE_PIPELINE_STATUS.approval ||
    status === ISSUE_PIPELINE_STATUS.paused ||
    status === ISSUE_PIPELINE_STATUS.failed
  )
    return 0.5;
  if (status === ISSUE_PIPELINE_STATUS.planning || status === ISSUE_PIPELINE_STATUS.clarifying)
    return 0.25;
  return 0;
}

export function dragOverlayBorderClass(
  _status: IssuePipelineStatus,
  _approvedAwaitingExecution = false,
): string {
  return '';
}

export function resolveIssuePhaseChip(
  issue: GitHubIssueCacheRecord,
  settings: AppSettings | null | undefined,
  project: Project | null | undefined,
  thread: Thread | null | undefined,
): IssuePhaseChip | null {
  const phase = getIssueCardPhase(issue.pipelineStatus);
  if (!phase) return null;

  const provider: ExecutorModel | null =
    phase === 'planner'
      ? settings
        ? resolvePhaseModelForIssue(settings, project, issue, 'planner')
        : null
      : phase === 'reviewer'
        ? settings
          ? resolvePhaseModelForIssue(settings, project, issue, 'reviewer')
          : null
        : phase === 'executor'
          ? settings
            ? resolveExecutorModelForIssue(settings, project, issue)
            : null
          : settings
            ? resolvePhaseModelForIssue(settings, project, issue, 'verifier')
            : null;

  const model =
    phase === 'planner'
      ? (sanitizeResolvedModel(thread?.plannerResolvedModel) ??
        thread?.plannerModel ??
        (settings ? resolvePhaseModelForIssue(settings, project, issue, 'planner') : 'claude'))
      : phase === 'reviewer'
        ? (sanitizeResolvedModel(thread?.reviewerResolvedModel) ??
          thread?.reviewerModel ??
          (settings ? resolvePhaseModelForIssue(settings, project, issue, 'reviewer') : 'codex'))
        : phase === 'executor'
          ? (sanitizeResolvedModel(thread?.executorResolvedModel) ??
            thread?.executorModel ??
            (settings ? resolveExecutorModelForIssue(settings, project, issue) : 'claude'))
          : (sanitizeResolvedModel(thread?.verifierResolvedModel) ??
            thread?.verifierModel ??
            (settings
              ? resolvePhaseModelForIssue(settings, project, issue, 'verifier')
              : 'claude'));

  return {
    phase,
    provider: provider ?? 'claude',
    model,
    effort:
      settings && provider
        ? formatProviderReasoningEffort(
            provider,
            resolvePhaseReasoningEffort(settings, project, phase),
            resolvePhaseModelIdForIssue(settings, project, issue, phase),
          )
        : null,
  };
}

export function resolveIssueRevisionBadge(
  issue: GitHubIssueCacheRecord,
  settings: AppSettings | null | undefined,
  project: Project | null | undefined,
  thread: Thread | null | undefined,
): IssueRevisionBadge | null {
  if (isAutomationIssue(issue)) return null;
  if (!settings) return null;
  const revisionCount = resolveRevisionCountForIssue(settings, project, issue);

  if (thread) {
    const version = Math.max(1, (thread.reviewRound ?? 0) + 1);
    return {
      label: `v${version}`,
      title:
        revisionCount > 0
          ? `Plan version ${version}; configured revisions: ${revisionCount}`
          : `Plan version ${version}; no revisions configured`,
      variant: badgeVariantForIssueStatus(issue.pipelineStatus),
    };
  }

  if (revisionCount <= 0) return null;

  return {
    label: `${revisionCount}`,
    title: `Configured revisions: ${revisionCount}`,
    variant: badgeVariantForIssueStatus(issue.pipelineStatus),
  };
}

function badgeVariantForIssueStatus(status: IssuePipelineStatus): IssueRevisionBadge['variant'] {
  if (status === ISSUE_PIPELINE_STATUS.failed) return 'danger';
  if (
    status === ISSUE_PIPELINE_STATUS.approval ||
    status === ISSUE_PIPELINE_STATUS.clarifying ||
    status === ISSUE_PIPELINE_STATUS.paused
  ) {
    return 'warning';
  }
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'success';
  if (status === ISSUE_PIPELINE_STATUS.closed) return 'done';
  if (status === ISSUE_PIPELINE_STATUS.deferred) return 'default';
  if (ACTIVE_STATUSES.includes(status)) return 'info';
  return 'default';
}

/**
 * Resolve the visible Priority chip from synced GitHub Projects v2 data.
 * Unknown options ride along as raw text in `accent`.
 */
export function resolveIssuePriorityBadge(
  issue: GitHubIssueCacheRecord,
): IssuePriorityBadge | null {
  if (!issue.priorityRank && !issue.priorityRaw) return null;
  const raw = issue.priorityRaw ?? '';
  if (issue.priorityRank === 'p0') {
    return {
      label: 'P0',
      variant: 'danger',
      title: `Priority P0 — ${raw || 'critical'}`,
      rank: 'p0',
    };
  }
  if (issue.priorityRank === 'p1') {
    return {
      label: 'P1',
      variant: 'warning',
      title: `Priority P1 — ${raw || 'high'}`,
      rank: 'p1',
    };
  }
  if (issue.priorityRank === 'p2') {
    return {
      label: 'P2',
      variant: 'info',
      title: `Priority P2 — ${raw || 'medium'}`,
      rank: 'p2',
    };
  }
  if (issue.priorityRank === 'p3') {
    return {
      label: 'P3',
      variant: 'success',
      title: `Priority P3 — ${raw || 'low'}`,
      rank: 'p3',
    };
  }
  return {
    label: raw,
    variant: 'accent',
    title: `Priority — ${raw} (uncategorized)`,
    rank: null,
  };
}

export function resolveIssueApprovalBadge(
  issue: GitHubIssueCacheRecord,
  settings: AppSettings | null | undefined,
  project: Project | null | undefined,
): IssueApprovalBadge | null {
  if (isAutomationIssue(issue)) return null;
  if (!settings) return null;
  if (
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.completed ||
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.closed
  ) {
    return null;
  }

  const approval = resolveRequireApprovalStateForIssue(settings, project, issue);
  if (!approval.required) return null;

  const sourceLabel =
    approval.source === 'issue'
      ? 'issue override'
      : approval.source === 'project'
        ? 'project override'
        : 'app default';

  return {
    label: 'Approval',
    title: `Approval required via ${sourceLabel}`,
    source: approval.source,
  };
}

export const customCollisionDetection: CollisionDetection = (
  args: Parameters<CollisionDetection>[0],
) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

function getIssuePriorityRank(issue: GitHubIssueCacheRecord): number {
  // Synced GitHub Projects v2 Priority field is the source of truth. Label
  // fallback below is retained for one release to support repos that haven't
  // configured a Projects v2 Priority field yet.
  if (issue.priorityRank === 'p0') return 0;
  if (issue.priorityRank === 'p1') return 1;
  if (issue.priorityRank === 'p2') return 2;
  if (issue.priorityRank === 'p3') return 3;

  const labels = issue.labels.map((label) => label.toLowerCase());

  if (
    labels.some(
      (label) =>
        label === 'p0' ||
        label === 'priority:p0' ||
        label === 'priority/critical' ||
        label === 'priority:critical' ||
        label === 'priority/highest' ||
        label === 'priority:urgent' ||
        label === 'priority:high',
    )
  ) {
    return 0;
  }
  if (
    labels.some(
      (label) =>
        label === 'p1' ||
        label === 'priority:p1' ||
        label === 'priority/medium' ||
        label === 'priority:medium',
    )
  ) {
    return 1;
  }
  if (
    labels.some(
      (label) =>
        label === 'p2' ||
        label === 'priority:p2' ||
        label === 'priority/low' ||
        label === 'priority:low',
    )
  ) {
    return 2;
  }
  if (labels.some((label) => label === 'p3' || label === 'priority:p3')) {
    return 3;
  }

  return 99;
}

export function compareIssues(
  a: GitHubIssueCacheRecord,
  b: GitHubIssueCacheRecord,
  order: BoardSortOrder,
): number {
  const aCreating = isIssueCreating(a);
  const bCreating = isIssueCreating(b);
  if (aCreating || bCreating) {
    if (aCreating !== bCreating) return aCreating ? -1 : 1;
    return b.fetchedAt.localeCompare(a.fetchedAt);
  }

  if (order === 'title') {
    const byTitle = a.title.localeCompare(b.title);
    if (byTitle !== 0) return byTitle;
    return b.issueNumber - a.issueNumber;
  }

  if (order === 'id-asc') {
    return a.issueNumber - b.issueNumber;
  }

  if (order === 'id-desc') {
    return b.issueNumber - a.issueNumber;
  }

  const byPriority = getIssuePriorityRank(a) - getIssuePriorityRank(b);
  if (byPriority !== 0) return byPriority;

  const byIssueNumber = b.issueNumber - a.issueNumber;
  if (byIssueNumber !== 0) return byIssueNumber;

  return a.title.localeCompare(b.title);
}

export function rowToneFor(
  status: IssuePipelineStatus,
  approvedAwaitingExecution = false,
): RowTone {
  if (approvedAwaitingExecution) return 'agent';
  if (status === ISSUE_PIPELINE_STATUS.failed) return 'danger';
  if (
    status === ISSUE_PIPELINE_STATUS.approval ||
    status === ISSUE_PIPELINE_STATUS.clarifying ||
    status === ISSUE_PIPELINE_STATUS.paused
  ) {
    return 'warning';
  }
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'success';
  if (status === ISSUE_PIPELINE_STATUS.closed) return 'done';
  if (ACTIVE_STATUSES.includes(status)) return 'agent';
  return 'default';
}

export function sectionToneFor(columnKey: ColumnKey, sectionKey: string): RowTone {
  if (sectionKey === 'failed') return 'danger';
  if (columnKey === 'human') return 'warning';
  if (columnKey === 'agent') return 'agent';
  if (columnKey === 'done') return 'done';
  return 'default';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Returns CSS hex color for a kanban column dot when a GitHub Projects
 * color is available, or null to fall back to the default Tailwind class.
 */
export function resolveColumnDotColor(
  _columnKey: ColumnKey,
  _mapping: GhStatusMapping | null | undefined,
): string | null {
  return null;
}
