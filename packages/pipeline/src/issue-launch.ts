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
import type { Pipeline, PipelineStartOptions } from './types';

const REUSABLE_THREAD_STATUSES = new Set<PipelinePhase>([
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.idle,
]);

/**
 * Which entry path a launch represents.
 *
 * Both modes share the phase-model options bag, the plan/thread preparation
 * order, and the failure handling — they differ only in how the thread is
 * acquired, whether the thread carries a GitHub repo association, and which
 * pipeline entry point dispatches the run. Keeping the difference as a mode
 * here (rather than a second launcher) means a change to model routing or
 * failure handling lands on both paths at once.
 */
export const ISSUE_LAUNCH_MODE = {
  githubIssue: 'github-issue',
  quickTask: 'quick-task',
} as const;

export type IssueLaunchMode = (typeof ISSUE_LAUNCH_MODE)[keyof typeof ISSUE_LAUNCH_MODE];

export interface IssuePipelineLaunchDeps {
  threads: ThreadQueries;
  githubIssues: GitHubIssueQueries;
  plans: PlanQueries;
  pipeline: Pick<
    Pipeline,
    'startFromGitHubIssue' | 'startFromQuickTask' | 'reserveLaunch' | 'releaseLaunch'
  >;
}

export interface IssuePipelineLaunchHooks {
  validatePhaseModels?: (phaseModels: ResolvedIssuePhaseModels) => Promise<void>;
  onIssueStarted?: () => void;
  onIssueLinked?: (thread: Thread) => void | Promise<void>;
  onLaunchError?: (error: unknown, thread: Thread) => void | Promise<void>;
}

export interface LaunchIssuePipelineInput {
  project: Project;
  issue: GitHubIssueCacheRecord;
  phaseModels: ResolvedIssuePhaseModels;
  executorModelOverride?: string | null;
  /** Defaults to `github-issue`. */
  mode?: IssueLaunchMode;
}

export async function launchIssuePipeline(
  deps: IssuePipelineLaunchDeps,
  input: LaunchIssuePipelineInput,
  hooks: IssuePipelineLaunchHooks = {},
): Promise<Thread> {
  const { issue, phaseModels, project } = input;
  const isQuickTask = (input.mode ?? ISSUE_LAUNCH_MODE.githubIssue) === ISSUE_LAUNCH_MODE.quickTask;
  const label = isQuickTask ? `Quick task ${issue.issueNumber}` : `Issue #${issue.issueNumber}`;

  const linkedThread = issue.threadId ? deps.threads.getById(issue.threadId) : null;

  if (linkedThread && !REUSABLE_THREAD_STATUSES.has(linkedThread.status)) {
    throw new Error(`${label} already has active thread`);
  }

  // Quick tasks are created with their thread already linked (see the
  // `pipeline:create-quick-task` handler), so there is nothing to create here —
  // a missing thread means the cache row is corrupt, not that a fresh run
  // should be started against a synthetic sentinel issue number.
  if (isQuickTask) {
    if (!issue.threadId) throw new Error(`${label} has no linked thread`);
    if (!linkedThread) throw new Error(`${label}: thread ${issue.threadId} missing`);
  }

  // `linkedThread.status` alone cannot close the re-launch door: the pipeline
  // only registers the thread in `activePipelines` once `startFrom*` seeds its
  // context, and everything between here and there — the renderer refresh in
  // `onIssueLinked`, model validation, GitHub synthesis — is awaited work. Two
  // launches racing through that window both read a reusable status and both
  // proceed. Claiming the thread synchronously, before the first `await`, is
  // what makes the guard hold; the pipeline checks the claim and
  // `activePipelines` together so the two act as one guard, not two.
  if (linkedThread && !deps.pipeline.reserveLaunch(linkedThread.id)) {
    throw new Error(`${label} already has active thread`);
  }

  // The reservation must survive every exit below, so the claim is released in
  // a `finally` rather than at each return/throw. On success that release is a
  // hand-off, not a gap: `startFrom*` seeds `activePipelines` synchronously
  // before it awaits anything, so the guard is already covered by the time this
  // unwinds.
  let reservedThreadId = linkedThread?.id ?? null;

  try {
    deps.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.planning);
    hooks.onIssueStarted?.();

    const thread =
      linkedThread ?? deps.threads.create(issue.projectId, issue.body ?? issue.title, issue.title);

    if (linkedThread) {
      deps.threads.updateIssueContent(thread.id, issue.body ?? issue.title, issue.title);
    } else {
      // A freshly created thread id cannot collide, but claiming it keeps the
      // pipeline's view of in-flight launches complete — a concurrent launch
      // that reaches this thread by another path sees it as taken.
      reservedThreadId = thread.id;
      deps.pipeline.reserveLaunch(thread.id);
    }

    if (isQuickTask) {
      // Quick tasks have no GitHub repo association — the cache row holds a
      // negative sentinel issue number, so `github_repo` must stay null or the
      // pipeline's `isRealGithubIssueNumber` guards start seeing a repo they
      // cannot address.
      deps.threads.setGithubIssueNumber(thread.id, issue.issueNumber);
    } else {
      deps.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
    }

    deps.githubIssues.linkThread(issue.id, thread.id);
    await hooks.onIssueLinked?.(thread);

    try {
      // validatePhaseModels can reject (unsupported model / missing API key). Keep it —
      // and the phase-model persistence below — inside the try so onLaunchError fires
      // and the thread transitions out of `planning` instead of being stranded there.
      await hooks.validatePhaseModels?.(phaseModels);

      deps.threads.setPhaseModels(thread.id, phaseModels);
      deps.threads.resetFailureTracking(thread.id);
      deps.plans.supersedeAll(thread.id);
      deps.plans.supersedeAllForIssue(issue.projectId, issue.issueNumber, thread.id);

      const startOptions: PipelineStartOptions = {
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
      };

      if (isQuickTask) {
        await deps.pipeline.startFromQuickTask(
          thread.id,
          project.path,
          {
            issueNumber: issue.issueNumber,
            title: issue.title,
            text: issue.body ?? issue.title,
          },
          phaseModels.executorModel,
          startOptions,
        );
      } else {
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
          startOptions,
        );
      }
    } catch (error) {
      // Release ahead of the hook: `onLaunchError` transitions the thread back
      // to a relaunchable status, so the claim must already be gone by the time
      // anything can act on that transition. Null the slot so the outer
      // `finally` cannot release a second time — during the hook's await a
      // concurrent launch may legitimately re-reserve this thread, and a
      // second release here would steal that fresh claim mid-flight.
      if (reservedThreadId) {
        deps.pipeline.releaseLaunch(reservedThreadId);
        reservedThreadId = null;
      }
      await hooks.onLaunchError?.(error, thread);
      throw error;
    }

    return thread;
  } finally {
    if (reservedThreadId) deps.pipeline.releaseLaunch(reservedThreadId);
  }
}
