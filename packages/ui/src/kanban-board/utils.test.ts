import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { compareIssues } from './utils';

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
