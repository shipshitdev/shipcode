import type { GitHubIssueQueries, ThreadQueries } from '@shipcode/db';
import {
  type GhStatusMapping,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  isRealGithubIssueNumber,
  PIPELINE_PHASE,
  type PipelinePhase,
  type Project,
} from '@shipcode/shared';

export function mapPhaseToIssuePipelineStatus(phase: PipelinePhase): IssuePipelineStatus {
  return phase === PIPELINE_PHASE.idle ? ISSUE_PIPELINE_STATUS.todo : phase;
}

/**
 * Optional side-effect callbacks for syncing pipeline state changes to GitHub.
 *
 * `syncToGithub` is called fire-and-forget: the pipeline never blocks on it and
 * a sync failure never fails a phase. Its promise does reflect the real write
 * outcome though — it rejects once the write has exhausted its retries — so a
 * caller that wants to react can. The queue behind it owns retry and reports
 * persistent failures itself, so handling the rejection here is belt-and-braces
 * rather than the only alarm.
 */
export interface GhSyncDeps {
  getProject: (projectId: string) => Project | null;
  syncToGithub: (opts: {
    projectPath: string;
    repoFullName?: string | null;
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

  if (!isRealGithubIssueNumber(thread.githubIssueNumber)) return;

  // Fire-and-forget GH Projects v2 Status + pipeline label sync
  if (ghSync && thread.projectId) {
    const project = ghSync.getProject(thread.projectId);
    if (project) {
      void ghSync
        .syncToGithub({
          projectPath: project.path,
          repoFullName: project.githubRepoFullName,
          projectUrl: project.githubProjectUrl,
          issueNumber: thread.githubIssueNumber,
          pipelineStatus,
          statusMapping: project.githubStatusMapping,
        })
        .catch((err) => {
          console.warn('[phase-sync] gh status sync failed', err);
        });
    }
  }
}
