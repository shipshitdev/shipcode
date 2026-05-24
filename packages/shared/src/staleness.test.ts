import { describe, expect, it } from 'vitest';
import {
  KANBAN_FAILED_PIPELINE_STALENESS_THRESHOLD_MS,
  KANBAN_STATUS_STALENESS_THRESHOLD_MS,
  resolveIssueStaleness,
} from './staleness';

const now = '2026-04-30T12:00:00.000Z';
const nowMs = new Date(now).getTime();

function isoAgo(ms: number): string {
  return new Date(nowMs - ms).toISOString();
}

describe('resolveIssueStaleness', () => {
  it('does not flag queued issues exactly at the seven-day threshold', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'queued',
        statusUpdatedAt: isoAgo(KANBAN_STATUS_STALENESS_THRESHOLD_MS),
        now,
      }),
    ).toBeNull();
  });

  it('ignores inactive statuses and invalid timestamps', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'todo',
        statusUpdatedAt: isoAgo(30 * 24 * 60 * 60 * 1000),
        now,
      }),
    ).toBeNull();
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'queued',
        statusUpdatedAt: 'not-a-date',
        issueUpdatedAt: null,
        now: Number.NaN,
      }),
    ).toBeNull();
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'queued',
        statusUpdatedAt: null,
        issueUpdatedAt: null,
        now: nowMs,
      }),
    ).toBeNull();
  });

  it('flags queued issues older than seven days', () => {
    const result = resolveIssueStaleness({
      pipelineStatus: 'queued',
      statusUpdatedAt: isoAgo(KANBAN_STATUS_STALENESS_THRESHOLD_MS + 1),
      now,
    });

    expect(result).toMatchObject({
      isStale: true,
      reason: 'status-stale',
      title: 'Queued 7d, no updates',
      thresholdMs: KANBAN_STATUS_STALENESS_THRESHOLD_MS,
    });
  });

  it('does not flag active issues when the GitHub issue was updated recently', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'executing',
        statusUpdatedAt: isoAgo(9 * 24 * 60 * 60 * 1000),
        issueUpdatedAt: isoAgo(60 * 1000),
        now,
      }),
    ).toBeNull();
  });

  it('keeps the newest active timestamp when issue updates are older than status updates', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'executing',
        statusUpdatedAt: isoAgo(60 * 1000),
        issueUpdatedAt: isoAgo(9 * 24 * 60 * 60 * 1000),
        now,
      }),
    ).toBeNull();
  });

  it('clamps future timestamps to zero age', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'queued',
        statusUpdatedAt: new Date(nowMs + 60 * 1000).toISOString(),
        now,
      }),
    ).toBeNull();
  });

  it('flags active in-progress issues when status and issue timestamps are stale', () => {
    const result = resolveIssueStaleness({
      pipelineStatus: 'executing',
      statusUpdatedAt: isoAgo(9 * 24 * 60 * 60 * 1000),
      issueUpdatedAt: isoAgo(8 * 24 * 60 * 60 * 1000),
      now,
    });

    expect(result).toMatchObject({
      isStale: true,
      reason: 'status-stale',
      title: 'In progress 8d, no updates',
    });
  });

  it('does not flag failed pipelines exactly at the 24-hour threshold', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'failed',
        threadStatus: 'failed',
        threadUpdatedAt: isoAgo(KANBAN_FAILED_PIPELINE_STALENESS_THRESHOLD_MS),
        now,
      }),
    ).toBeNull();
  });

  it('does not flag failed pipelines without a usable timestamp', () => {
    expect(
      resolveIssueStaleness({
        pipelineStatus: 'failed',
        threadStatus: 'failed',
        threadUpdatedAt: '',
        statusUpdatedAt: null,
        issueUpdatedAt: null,
        now,
      }),
    ).toBeNull();
  });

  it('flags failed pipelines older than 24 hours', () => {
    const result = resolveIssueStaleness({
      pipelineStatus: 'failed',
      threadStatus: 'failed',
      threadUpdatedAt: isoAgo(25 * 60 * 60 * 1000),
      now,
    });

    expect(result).toMatchObject({
      isStale: true,
      reason: 'pipeline-failed',
      title: 'Failed pipeline 25h ago',
      thresholdMs: KANBAN_FAILED_PIPELINE_STALENESS_THRESHOLD_MS,
    });
  });

  it('falls back to status timestamps for failed pipelines without a failed thread timestamp', () => {
    const result = resolveIssueStaleness({
      pipelineStatus: 'failed',
      threadStatus: 'executing',
      statusUpdatedAt: isoAgo(49 * 60 * 60 * 1000),
      issueUpdatedAt: isoAgo(10 * 60 * 60 * 1000),
      now: new Date(now),
    });

    expect(result).toMatchObject({
      reason: 'pipeline-failed',
      title: 'Failed pipeline 2d ago',
    });
  });

  it('falls back to issue timestamps for failed pipelines when status timestamp is absent', () => {
    const result = resolveIssueStaleness({
      pipelineStatus: 'failed',
      threadStatus: 'executing',
      statusUpdatedAt: null,
      issueUpdatedAt: isoAgo(50 * 60 * 60 * 1000),
      now,
    });

    expect(result).toMatchObject({
      reason: 'pipeline-failed',
      title: 'Failed pipeline 2d ago',
    });
  });
});
