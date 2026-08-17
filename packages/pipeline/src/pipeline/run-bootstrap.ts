import { GitService, resolveForkPointSha } from '@shipcode/git';
import type { PipelineDeps, PipelineExecutorModel, PipelineStartOptions } from '../types';
import type { PipelineContextHelpers } from './shared';

export interface PipelineRunBootstrapInput {
  threadId: string;
  projectPath: string;
  githubIssueNumber: number | null;
  githubIssueTitle: string;
  executorModel: PipelineExecutorModel;
  options?: PipelineStartOptions;
  createRun: () => string | null;
}

/**
 * Initialize the shared autonomous-run state used by GitHub issues and Quick
 * Tasks. Keeping branch resolution, thread reset, and context seeding in one
 * path prevents the two entry points from drifting as model options evolve.
 */
export async function bootstrapPipelineRun(
  deps: PipelineDeps,
  contextHelpers: PipelineContextHelpers,
  input: PipelineRunBootstrapInput,
) {
  const { threadId, projectPath, githubIssueNumber, githubIssueTitle, executorModel, options } =
    input;
  const settings = deps.settings.get();
  const worktreePath = options?.worktreePath ?? null;
  const executorModelOverride = options?.executorModelOverride ?? null;

  let baseBranch = options?.baseBranch ?? '';
  if (!baseBranch) {
    try {
      // The shared resolver, not a second copy of it: it reads origin/HEAD and
      // then walks main → master → current branch, so a repo whose trunk is
      // `master` no longer gets a hardcoded 'main'. Async by construction —
      // synchronous git here blocked the Electron main event loop.
      baseBranch = await new GitService(projectPath).getDefaultBranch();
    } catch {
      baseBranch = 'main';
    }
  }

  // Tries `<base>` then `origin/<base>`, so a worktree-only clone with no local
  // trunk still records a real fork point instead of ''.
  const forkPointSha = await resolveForkPointSha(projectPath, baseBranch);
  if (!forkPointSha) {
    console.debug(
      `[pipeline] no fork point resolved for base branch "${baseBranch}" in ${projectPath}`,
    );
  }

  deps.threads.updateAutonomousFields(threadId, {
    autonomous: true,
    reviewRound: 0,
    executorModel,
    baseBranch,
    forkPointSha,
  });
  deps.threads.clearClarification(threadId);

  const runId = input.createRun();
  contextHelpers.ensureContext(threadId, {
    projectPath,
    runId,
    worktreePath,
    retryCount: 0,
    autonomous: true,
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    clarificationHistory: [],
    verificationRetries: 0,
    githubIssueNumber,
    githubIssueTitle,
    githubRepo: null,
    plannerModel: options?.plannerModel ?? (settings.plannerModel as PipelineExecutorModel),
    reviewerModel: options?.reviewerModel ?? (settings.reviewerModel as PipelineExecutorModel),
    verifierModel: options?.verifierModel ?? (settings.verifierModel as PipelineExecutorModel),
    executorModel,
    plannerModelIdOverride: options?.plannerModelIdOverride ?? null,
    reviewerModelIdOverride: options?.reviewerModelIdOverride ?? null,
    executorModelIdOverride: options?.executorModelIdOverride ?? null,
    verifierModelIdOverride: options?.verifierModelIdOverride ?? null,
    plannerReasoningEffort: options?.plannerReasoningEffort ?? settings.plannerReasoningEffort,
    reviewerReasoningEffort: options?.reviewerReasoningEffort ?? settings.reviewerReasoningEffort,
    executorReasoningEffort: options?.executorReasoningEffort ?? settings.executorReasoningEffort,
    verifierReasoningEffort: options?.verifierReasoningEffort ?? settings.verifierReasoningEffort,
    executorModelOverride,
    baseBranch,
    forkPointSha,
    activeProcessId: null,
    cancelled: false,
    verifiedSha: null,
  });

  return { settings, worktreePath, baseBranch, forkPointSha };
}
