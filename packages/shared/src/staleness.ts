import {
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type ThreadStatus,
} from './types';

export const KANBAN_STATUS_STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
export const KANBAN_FAILED_PIPELINE_STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type IssueStalenessReason = 'pipeline-failed' | 'status-stale';

export interface IssueStalenessResult {
  isStale: true;
  reason: IssueStalenessReason;
  title: string;
  ageMs: number;
  since: string;
  thresholdMs: number;
}

interface ResolveIssueStalenessInput {
  pipelineStatus: IssuePipelineStatus;
  issueUpdatedAt?: string | null;
  statusUpdatedAt?: string | null;
  threadStatus?: ThreadStatus | null;
  threadUpdatedAt?: string | null;
  now?: number | string | Date;
}

const STATUS_STALENESS_PIPELINE_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.queued,
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
]);

function parseTimeMs(input: number | string | Date | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatStalenessAge(ageMs: number): string {
  const hours = Math.max(0, Math.floor(ageMs / (60 * 60 * 1000)));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function resolveAge(
  since: string | null | undefined,
  nowMs: number,
): { ageMs: number; since: string } | null {
  const sinceMs = parseTimeMs(since);
  if (sinceMs == null || !since) return null;
  return { ageMs: Math.max(0, nowMs - sinceMs), since };
}

function resolveNewestAge(
  timestamps: Array<string | null | undefined>,
  nowMs: number,
): { ageMs: number; since: string } | null {
  let newest: { ms: number; value: string } | null = null;
  for (const timestamp of timestamps) {
    const ms = parseTimeMs(timestamp);
    if (ms == null || !timestamp) continue;
    if (!newest || ms > newest.ms) newest = { ms, value: timestamp };
  }
  if (!newest) return null;
  return { ageMs: Math.max(0, nowMs - newest.ms), since: newest.value };
}

export function resolveIssueStaleness({
  pipelineStatus,
  issueUpdatedAt,
  statusUpdatedAt,
  threadStatus,
  threadUpdatedAt,
  now = Date.now(),
}: ResolveIssueStalenessInput): IssueStalenessResult | null {
  const nowMs = parseTimeMs(now) ?? Date.now();

  if (pipelineStatus === ISSUE_PIPELINE_STATUS.failed) {
    const failedAt = threadStatus === PIPELINE_PHASE.failed ? threadUpdatedAt : null;
    const failedAge = resolveAge(failedAt ?? statusUpdatedAt ?? issueUpdatedAt, nowMs);
    if (!failedAge || failedAge.ageMs <= KANBAN_FAILED_PIPELINE_STALENESS_THRESHOLD_MS) {
      return null;
    }

    return {
      isStale: true,
      reason: 'pipeline-failed',
      title: `Failed pipeline ${formatStalenessAge(failedAge.ageMs)} ago`,
      ageMs: failedAge.ageMs,
      since: failedAge.since,
      thresholdMs: KANBAN_FAILED_PIPELINE_STALENESS_THRESHOLD_MS,
    };
  }

  if (!STATUS_STALENESS_PIPELINE_STATUSES.has(pipelineStatus)) return null;

  const statusAge = resolveNewestAge([statusUpdatedAt, issueUpdatedAt], nowMs);
  if (!statusAge || statusAge.ageMs <= KANBAN_STATUS_STALENESS_THRESHOLD_MS) return null;

  const statusLabel = pipelineStatus === ISSUE_PIPELINE_STATUS.queued ? 'Queued' : 'In progress';

  return {
    isStale: true,
    reason: 'status-stale',
    title: `${statusLabel} ${formatStalenessAge(statusAge.ageMs)}, no updates`,
    ageMs: statusAge.ageMs,
    since: statusAge.since,
    thresholdMs: KANBAN_STATUS_STALENESS_THRESHOLD_MS,
  };
}
