import { execFileSync } from 'node:child_process';
import { resolveRequireApproval, resolveRequireApprovalForIssue } from '@shipcode/shared';
import { buildIssueGroupExecutionPreview } from './issue-group-scheduler';
import { createPipelineContextHelpers } from './pipeline/context';
import { createExecutionPhaseHandlers } from './pipeline/execution-phases';
import { createPlanningPhaseHandlers } from './pipeline/planning-phases';
import { createPipelineRuntime } from './pipeline/runtime';
import type { PipelinePhaseHandlers } from './pipeline/shared';
import type { Pipeline, PipelineContext, PipelineDeps, PipelineExecutorModel } from './types';

export function createPipeline(deps: PipelineDeps): Pipeline {
  const activePipelines = new Map<string, PipelineContext>();
  void buildIssueGroupExecutionPreview;
  const contextHelpers = createPipelineContextHelpers(deps, activePipelines);
  const runtime = createPipelineRuntime(deps, contextHelpers);
  const handlers = {} as PipelinePhaseHandlers;

  Object.assign(
    handlers,
    createPlanningPhaseHandlers({
      deps,
      contextHelpers,
      runtime,
      handlers,
    }),
    createExecutionPhaseHandlers({
      deps,
      contextHelpers,
      runtime,
      handlers,
    }),
  );

  async function startFromGitHubIssue(
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: PipelineExecutorModel,
    options?: {
      baseBranch?: string;
      worktreePath?: string | null;
      executorModelOverride?: string | null;
      plannerModel?: PipelineExecutorModel;
      reviewerModel?: PipelineExecutorModel;
      verifierModel?: PipelineExecutorModel;
      plannerModelIdOverride?: string | null;
      reviewerModelIdOverride?: string | null;
      executorModelIdOverride?: string | null;
      verifierModelIdOverride?: string | null;
      plannerReasoningEffort?: PipelineContext['plannerReasoningEffort'];
      reviewerReasoningEffort?: PipelineContext['reviewerReasoningEffort'];
      executorReasoningEffort?: PipelineContext['executorReasoningEffort'];
      verifierReasoningEffort?: PipelineContext['verifierReasoningEffort'];
    },
  ) {
    const executorModelOverride = options?.executorModelOverride ?? null;

    let baseBranch = options?.baseBranch ?? '';
    let forkPointSha = '';

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

    contextHelpers.ensureContext(threadId, {
      projectPath,
      worktreePath: options?.worktreePath ?? null,
      retryCount: 0,
      autonomous: true,
      reviewRound: 0,
      clarificationRound: 0,
      clarificationRequest: null,
      clarificationAnswers: [],
      verificationRetries: 0,
      githubIssueNumber: issue.number,
      githubIssueTitle: issue.title,
      githubRepo: null,
      plannerModel:
        options?.plannerModel ?? (deps.settings.get().plannerModel as PipelineExecutorModel),
      reviewerModel:
        options?.reviewerModel ?? (deps.settings.get().reviewerModel as PipelineExecutorModel),
      verifierModel:
        options?.verifierModel ?? (deps.settings.get().verifierModel as PipelineExecutorModel),
      executorModel,
      plannerModelIdOverride: options?.plannerModelIdOverride ?? null,
      reviewerModelIdOverride: options?.reviewerModelIdOverride ?? null,
      executorModelIdOverride: options?.executorModelIdOverride ?? null,
      verifierModelIdOverride: options?.verifierModelIdOverride ?? null,
      plannerReasoningEffort:
        options?.plannerReasoningEffort ?? deps.settings.get().plannerReasoningEffort,
      reviewerReasoningEffort:
        options?.reviewerReasoningEffort ?? deps.settings.get().reviewerReasoningEffort,
      executorReasoningEffort:
        options?.executorReasoningEffort ?? deps.settings.get().executorReasoningEffort,
      verifierReasoningEffort:
        options?.verifierReasoningEffort ?? deps.settings.get().verifierReasoningEffort,
      executorModelOverride,
      baseBranch,
      forkPointSha,
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
    });

    const settings = deps.settings.get();
    const thread = deps.threads.getById(threadId);
    const project = thread ? deps.projects.getById(thread.projectId) : null;
    const cachedIssue =
      thread?.projectId != null
        ? deps.githubIssues.getByNumber(thread.projectId, issue.number)
        : null;
    const requireApproval =
      project && cachedIssue
        ? resolveRequireApprovalForIssue(settings, project, cachedIssue)
        : project
          ? resolveRequireApproval(settings, project)
          : settings.requireApproval;

    deps.emitter.emit({
      type: 'pipeline:start-context',
      threadId,
      source: 'github:start-issue',
      projectPath,
      githubIssueNumber: issue.number,
      autonomous: true,
      requireApproval,
      reviewRound: 0,
    });

    const prompt = `GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`;
    await handlers.startPlanGeneration(
      threadId,
      prompt,
      projectPath,
      options?.worktreePath ?? null,
    );
  }

  function cancel(threadId: string) {
    const context = activePipelines.get(threadId);
    if (context) {
      context.cancelled = true;
      try {
        context.abort.abort();
      } catch {
        // best effort
      }
      if (context.activeProcessId) {
        deps.processManager.kill(context.activeProcessId);
      }
    }

    activePipelines.delete(threadId);
    runtime.emitPhase(threadId, 'idle');
  }

  return {
    rehydrateContext: contextHelpers.rehydrateContext,
    startPlanGeneration: handlers.startPlanGeneration,
    startReview: handlers.startReview,
    startRevision: handlers.startRevision,
    startExecution: handlers.startExecution,
    startVerification: handlers.startVerification,
    startCommitAndPush: handlers.startCommitAndPush,
    startShipping: handlers.startShipping,
    startStabilization: handlers.startStabilization,
    startFromGitHubIssue,
    initializeContext: contextHelpers.ensureContext,
    cancel,
    getContext: (threadId: string) => activePipelines.get(threadId),
    listActive: contextHelpers.listActive,
    listActiveInPhases: contextHelpers.listActiveInPhases,
  };
}
