import { execFileSync } from 'node:child_process';
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
export function bootstrapPipelineRun(
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
      baseBranch = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
        cwd: projectPath,
        encoding: 'utf-8',
      })
        .trim()
        .replace('origin/', '');
    } catch {
      baseBranch = 'main';
    }
  }

  let forkPointSha = '';
  try {
    forkPointSha = execFileSync('git', ['rev-parse', baseBranch], {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    forkPointSha = '';
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
