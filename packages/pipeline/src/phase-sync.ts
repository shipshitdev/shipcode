import type { GitHubIssueQueries, ThreadQueries } from '@shipcode/db';
import {
  type GhStatusMapping,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type PipelinePhase,
  type Project,
} from '@shipcode/shared';

export function mapPhaseToIssuePipelineStatus(phase: PipelinePhase): IssuePipelineStatus {
  return phase === PIPELINE_PHASE.idle ? ISSUE_PIPELINE_STATUS.todo : phase;
}

/**
 * Optional side-effect callbacks for syncing pipeline state changes to GitHub.
 * All callbacks are fire-and-forget — errors are swallowed to avoid blocking
 * the pipeline.
 */
export interface GhSyncDeps {
  getProject: (projectId: string) => Project | null;
  syncToGithub: (opts: {
    projectPath: string;
    projectUrl: string | null;
    issueNumber: number;
    pipelineStatus: IssuePipelineStatus;
    statusMapping: GhStatusMapping | null;
  }) => Promise<void>;
}

export function syncThreadAndIssuePhase(
  threads: ThreadQueries,
  githubIssues: GitHubIssueQueries,
  threadId: string,
  phase: PipelinePhase,
  errorMessage?: string,
  ghSync?: GhSyncDeps,
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

  const pipelineStatus = mapPhaseToIssuePipelineStatus(phase);
  githubIssues.updatePipelineStatus(issue.id, pipelineStatus);

  // Fire-and-forget GH Projects v2 Status + pipeline label sync
  if (ghSync && thread.projectId) {
    const project = ghSync.getProject(thread.projectId);
    if (project) {
      void ghSync
        .syncToGithub({
          projectPath: project.path,
          projectUrl: project.githubProjectUrl,
          issueNumber: thread.githubIssueNumber,
          pipelineStatus,
          statusMapping: project.githubStatusMapping,
        })
        .catch((err) => {
          console.warn('[phase-sync] gh status sync failed silently', err);
        });
    }
  }
}
