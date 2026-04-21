import { type CollisionDetection, pointerWithin, rectIntersection } from '@dnd-kit/core';
import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  Thread,
} from '@shipcode/shared';
import {
  type ExecutorModel,
  formatProviderReasoningEffort,
  getIssueCardPhase,
  resolveExecutorModelForIssue,
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
  resolvePhaseReasoningEffort,
  resolveRequireApprovalStateForIssue,
  resolveRevisionCountForIssue,
  sanitizeResolvedModel,
} from '@shipcode/shared';
import { ACTIVE_STATUSES } from './constants';
import type { BoardSortOrder, IssueApprovalBadge, IssuePhaseChip, RowTone } from './types';

export function dragOverlayBorderClass(status: IssuePipelineStatus): string {
  if (status === 'failed') return 'border-danger';
  if (status === 'awaiting_approval' || status === 'clarifying') return 'border-warning';
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

export function resolveIssueRevisionLabel(
  issue: GitHubIssueCacheRecord,
  settings: AppSettings | null | undefined,
  project: Project | null | undefined,
  thread: Thread | null | undefined,
): string | null {
  if (!settings) return null;
  const revisionCount = resolveRevisionCountForIssue(settings, project, issue);
  if (thread && revisionCount > 0 && thread.reviewRound > 0) {
    return `Rev ${Math.min(thread.reviewRound, revisionCount)}/${revisionCount}`;
  }
  return `Rev ${revisionCount}`;
}

export function resolveIssueApprovalBadge(
  issue: GitHubIssueCacheRecord,
  settings: AppSettings | null | undefined,
  project: Project | null | undefined,
): IssueApprovalBadge | null {
  if (!settings) return null;
  if (issue.pipelineStatus === 'completed' || issue.pipelineStatus === 'done') return null;

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

export function formatPhaseElapsed(since: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
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

export function getIssuePriorityRank(issue: GitHubIssueCacheRecord): number {
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

export function rowToneFor(status: IssuePipelineStatus): RowTone {
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_approval' || status === 'clarifying') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'done') return 'done';
  if (ACTIVE_STATUSES.includes(status)) return 'agent';
  return 'default';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
