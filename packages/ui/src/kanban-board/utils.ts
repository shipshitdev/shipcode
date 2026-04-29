import { type CollisionDetection, pointerWithin, rectIntersection } from '@dnd-kit/core';
import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  Thread,
} from '../lib/shipcode';
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
} from '../lib/shipcode';
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
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval &&
    approvedAwaitingExecutionIssueIds?.has(issue.id) === true
  );
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
  if (section.key === 'awaiting') {
    return (
      issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval && !approvedAwaitingExecution
    );
  }
  return section.statuses.includes(issue.pipelineStatus);
}

export function dragOverlayBorderClass(
  status: IssuePipelineStatus,
  approvedAwaitingExecution = false,
): string {
  if (approvedAwaitingExecution) return 'border-agent';
  if (status === ISSUE_PIPELINE_STATUS.failed) return 'border-danger';
  if (
    status === ISSUE_PIPELINE_STATUS.awaitingApproval ||
    status === ISSUE_PIPELINE_STATUS.clarifying
  ) {
    return 'border-warning';
  }
  return 'border-accent';
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
    status === ISSUE_PIPELINE_STATUS.awaitingApproval ||
    status === ISSUE_PIPELINE_STATUS.clarifying
  ) {
    return 'warning';
  }
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'success';
  if (status === ISSUE_PIPELINE_STATUS.done) return 'done';
  if (ACTIVE_STATUSES.includes(status)) return 'info';
  return 'default';
}

/**
 * Resolve the visible Priority chip from synced GitHub Projects v2 data.
 * P0 uses `warning` (not `danger`) so it does not collide with the red
 * Failed-status chip. Unknown options ride along as raw text in `accent`.
 */
export function resolveIssuePriorityBadge(
  issue: GitHubIssueCacheRecord,
): IssuePriorityBadge | null {
  if (!issue.priorityRank && !issue.priorityRaw) return null;
  const raw = issue.priorityRaw ?? '';
  if (issue.priorityRank === 'p0') {
    return {
      label: 'P0',
      variant: 'warning',
      title: `Priority P0 — ${raw || 'critical'}`,
      rank: 'p0',
    };
  }
  if (issue.priorityRank === 'p1') {
    return {
      label: 'P1',
      variant: 'info',
      title: `Priority P1 — ${raw || 'high'}`,
      rank: 'p1',
    };
  }
  if (issue.priorityRank === 'p2') {
    return {
      label: 'P2',
      variant: 'default',
      title: `Priority P2 — ${raw || 'medium'}`,
      rank: 'p2',
    };
  }
  if (issue.priorityRank === 'p3') {
    return {
      label: 'P3',
      variant: 'default',
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
  if (!settings) return null;
  if (
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.completed ||
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.done
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

export function formatPhaseElapsed(since: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
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
    status === ISSUE_PIPELINE_STATUS.awaitingApproval ||
    status === ISSUE_PIPELINE_STATUS.clarifying
  ) {
    return 'warning';
  }
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'success';
  if (status === ISSUE_PIPELINE_STATUS.done) return 'done';
  if (ACTIVE_STATUSES.includes(status)) return 'agent';
  return 'default';
}

export function sectionToneFor(columnKey: ColumnKey, sectionKey: string): RowTone {
  if (sectionKey === 'failed') return 'danger';
  if (columnKey === 'human') return 'warning';
  if (columnKey === 'agent') return 'agent';
  if (columnKey === 'done') return sectionKey === 'completed' ? 'success' : 'done';
  return 'default';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
