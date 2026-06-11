import {
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type Thread,
} from '@shipcode/shared';
import { AUTOMATION_ISSUE_NUMBER_BASE } from '@shipcode/ui';

export function automationIssueNumber(threadId: string): number {
  let hash = 0;
  for (let i = 0; i < threadId.length; i += 1) {
    hash = (hash * 33 + threadId.charCodeAt(i)) % 900_000_000;
  }
  return AUTOMATION_ISSUE_NUMBER_BASE - hash;
}

function pipelineStatusFromThread(thread: Thread): IssuePipelineStatus {
  if (thread.doneAt) return ISSUE_PIPELINE_STATUS.closed;
  return thread.status === PIPELINE_PHASE.idle ? ISSUE_PIPELINE_STATUS.todo : thread.status;
}

export function automationThreadToIssue(thread: Thread, projectId: string): GitHubIssueCacheRecord {
  const timestamp = thread.updatedAt || thread.createdAt;

  return {
    id: `automation:${thread.id}`,
    projectId,
    issueNumber: automationIssueNumber(thread.id),
    title: thread.title || 'Automation run',
    body: thread.prompt || null,
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: pipelineStatusFromThread(thread),
    threadId: thread.id,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: timestamp,
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
    requireApprovalOverride: false,
    linkedPrNumber: thread.githubPrNumber,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: thread.createdAt,
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
  };
}
