import type { GitHubIssueQueries, PlanQueries, ThreadQueries } from '@shipcode/db';
import {
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  PIPELINE_PHASE,
  type PipelinePhase,
  type Project,
  type ResolvedIssuePhaseModels,
  type Thread,
} from '@shipcode/shared';
import type { Pipeline } from './types';

const REUSABLE_THREAD_STATUSES = new Set<PipelinePhase>([
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.idle,
]);

export interface IssuePipelineLaunchDeps {
  threads: ThreadQueries;
  githubIssues: GitHubIssueQueries;
  plans: PlanQueries;
  pipeline: Pick<Pipeline, 'startFromGitHubIssue'>;
}

export interface IssuePipelineLaunchHooks {
  validatePhaseModels?: (phaseModels: ResolvedIssuePhaseModels) => Promise<void>;
  onIssueStarted?: () => void | Promise<void>;
  onIssueLinked?: (thread: Thread) => void | Promise<void>;
  onLaunchError?: (error: unknown, thread: Thread) => void | Promise<void>;
}

export interface LaunchIssuePipelineInput {
  project: Project;
  issue: GitHubIssueCacheRecord;
  phaseModels: ResolvedIssuePhaseModels;
  executorModelOverride?: string | null;
}

export async function launchIssuePipeline(
  deps: IssuePipelineLaunchDeps,
  input: LaunchIssuePipelineInput,
  hooks: IssuePipelineLaunchHooks = {},
): Promise<Thread> {
  const { issue, phaseModels, project } = input;
  const reusableThread = issue.threadId ? deps.threads.getById(issue.threadId) : null;

  if (reusableThread && !REUSABLE_THREAD_STATUSES.has(reusableThread.status)) {
    throw new Error(`Issue #${issue.issueNumber} already has active thread`);
  }

  deps.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.planning);
  await hooks.onIssueStarted?.();

  const thread =
    reusableThread ?? deps.threads.create(issue.projectId, issue.body ?? issue.title, issue.title);

  if (reusableThread) {
    deps.threads.updateIssueContent(thread.id, issue.body ?? issue.title, issue.title);
  }

  deps.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
  deps.githubIssues.linkThread(issue.id, thread.id);
  await hooks.onIssueLinked?.(thread);
  await hooks.validatePhaseModels?.(phaseModels);

  deps.threads.setPhaseModels(thread.id, phaseModels);
  deps.threads.resetFailureTracking(thread.id);
  deps.plans.supersedeAll(thread.id);
  deps.plans.supersedeAllForIssue(issue.projectId, issue.issueNumber, thread.id);

  try {
    await deps.pipeline.startFromGitHubIssue(
      thread.id,
      project.path,
      {
        number: issue.issueNumber,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      },
      phaseModels.executorModel,
      {
        worktreePath: thread.worktreePath,
        baseBranch: project.defaultBranch,
        executorModelOverride: input.executorModelOverride ?? null,
        plannerModel: phaseModels.plannerModel,
        reviewerModel: phaseModels.reviewerModel,
        verifierModel: phaseModels.verifierModel,
        plannerModelIdOverride: phaseModels.plannerModelId,
        reviewerModelIdOverride: phaseModels.reviewerModelId,
        executorModelIdOverride: phaseModels.executorModelId,
        verifierModelIdOverride: phaseModels.verifierModelId,
        plannerReasoningEffort: phaseModels.plannerReasoningEffort,
        reviewerReasoningEffort: phaseModels.reviewerReasoningEffort,
        executorReasoningEffort: phaseModels.executorReasoningEffort,
        verifierReasoningEffort: phaseModels.verifierReasoningEffort,
      },
    );
  } catch (error) {
    await hooks.onLaunchError?.(error, thread);
    throw error;
  }

  return thread;
}
