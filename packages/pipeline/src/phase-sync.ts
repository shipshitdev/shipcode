import type { GitHubIssueQueries, ThreadQueries } from '@shipcode/db';
import {
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type PipelinePhase,
} from '@shipcode/shared';

export function mapPhaseToIssuePipelineStatus(phase: PipelinePhase): IssuePipelineStatus {
  return phase === PIPELINE_PHASE.idle ? ISSUE_PIPELINE_STATUS.todo : phase;
}

export function syncThreadAndIssuePhase(
  threads: ThreadQueries,
  githubIssues: GitHubIssueQueries,
  threadId: string,
  phase: PipelinePhase,
  errorMessage?: string,
): void {
  if (phase === PIPELINE_PHASE.failed) {
    const current = threads.getById(threadId);
    const activePhase = current?.status ?? 'unknown';
    if (typeof threads.recordFailure === 'function') {
      threads.recordFailure(threadId, activePhase, errorMessage);
    } else {
      threads.updateStatus(threadId, phase, errorMessage);
    }
  } else if (errorMessage !== undefined) {
    threads.updateStatus(threadId, phase, errorMessage);
  } else {
    threads.updateStatus(threadId, phase);
  }

  const thread = threads.getById(threadId);
  if (!thread?.githubIssueNumber) return;

  const issue = githubIssues.getByNumber(thread.projectId, thread.githubIssueNumber);
  if (!issue) return;

  githubIssues.updatePipelineStatus(issue.id, mapPhaseToIssuePipelineStatus(phase));
}
