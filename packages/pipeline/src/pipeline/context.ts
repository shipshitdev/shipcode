import type { SkillValidationError } from '@shipcode/agents';
import {
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import type { PipelineContext, PipelineDeps, PipelineExecutorModel } from '../types';
import type { PipelineContextHelpers } from './shared';

export function createPipelineContextHelpers(
  deps: PipelineDeps,
  activePipelines: Map<string, PipelineContext>,
): PipelineContextHelpers {
  function ensureContext(
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ): PipelineContext {
    const settings = deps.settings.get();
    const existing = activePipelines.get(threadId);
    if (existing) {
      const plannerModel =
        seed.plannerModel ??
        existing.plannerModel ??
        (settings.plannerModel as PipelineExecutorModel);
      const reviewerModel =
        seed.reviewerModel ??
        existing.reviewerModel ??
        (settings.reviewerModel as PipelineExecutorModel);
      const verifierModel =
        seed.verifierModel ??
        existing.verifierModel ??
        (settings.verifierModel as PipelineExecutorModel);
      const executorModel = seed.executorModel ?? existing.executorModel ?? 'claude';
      const plannerModelIdOverride =
        seed.plannerModelIdOverride ?? existing.plannerModelIdOverride ?? null;
      const reviewerModelIdOverride =
        seed.reviewerModelIdOverride ?? existing.reviewerModelIdOverride ?? null;
      const executorModelIdOverride =
        seed.executorModelIdOverride ?? existing.executorModelIdOverride ?? null;
      const verifierModelIdOverride =
        seed.verifierModelIdOverride ?? existing.verifierModelIdOverride ?? null;
      const plannerReasoningEffort = resolveProviderReasoningEffort(
        plannerModel,
        seed.plannerReasoningEffort ??
          existing.plannerReasoningEffort ??
          settings.plannerReasoningEffort,
        plannerModelIdOverride,
      ).effective;
      const reviewerReasoningEffort = resolveProviderReasoningEffort(
        reviewerModel,
        seed.reviewerReasoningEffort ??
          existing.reviewerReasoningEffort ??
          settings.reviewerReasoningEffort,
        reviewerModelIdOverride,
      ).effective;
      const executorReasoningEffort = resolveProviderReasoningEffort(
        executorModel,
        seed.executorReasoningEffort ??
          existing.executorReasoningEffort ??
          settings.executorReasoningEffort,
        executorModelIdOverride,
      ).effective;
      const verifierReasoningEffort = resolveProviderReasoningEffort(
        verifierModel,
        seed.verifierReasoningEffort ??
          existing.verifierReasoningEffort ??
          settings.verifierReasoningEffort,
        verifierModelIdOverride,
      ).effective;

      Object.assign(existing, {
        ...seed,
        plannerModel,
        reviewerModel,
        verifierModel,
        executorModel,
        plannerModelIdOverride,
        reviewerModelIdOverride,
        executorModelIdOverride,
        verifierModelIdOverride,
        plannerReasoningEffort,
        reviewerReasoningEffort,
        executorReasoningEffort,
        verifierReasoningEffort,
      });
      return existing;
    }

    const plannerModel = seed.plannerModel ?? (settings.plannerModel as PipelineExecutorModel);
    const reviewerModel = seed.reviewerModel ?? (settings.reviewerModel as PipelineExecutorModel);
    const verifierModel = seed.verifierModel ?? (settings.verifierModel as PipelineExecutorModel);
    const executorModel = seed.executorModel ?? 'claude';
    const plannerModelIdOverride = seed.plannerModelIdOverride ?? null;
    const reviewerModelIdOverride = seed.reviewerModelIdOverride ?? null;
    const executorModelIdOverride = seed.executorModelIdOverride ?? null;
    const verifierModelIdOverride = seed.verifierModelIdOverride ?? null;
    const plannerReasoningEffort = resolveProviderReasoningEffort(
      plannerModel,
      seed.plannerReasoningEffort ?? settings.plannerReasoningEffort,
      plannerModelIdOverride,
    ).effective;
    const reviewerReasoningEffort = resolveProviderReasoningEffort(
      reviewerModel,
      seed.reviewerReasoningEffort ?? settings.reviewerReasoningEffort,
      reviewerModelIdOverride,
    ).effective;
    const executorReasoningEffort = resolveProviderReasoningEffort(
      executorModel,
      seed.executorReasoningEffort ?? settings.executorReasoningEffort,
      executorModelIdOverride,
    ).effective;
    const verifierReasoningEffort = resolveProviderReasoningEffort(
      verifierModel,
      seed.verifierReasoningEffort ?? settings.verifierReasoningEffort,
      verifierModelIdOverride,
    ).effective;

    const seededProjectId = seed.projectId ?? deps.threads.getById(threadId)?.projectId ?? null;

    const context: PipelineContext = {
      threadId,
      projectPath: seed.projectPath,
      projectId: seededProjectId,
      worktreePath: seed.worktreePath ?? null,
      retryCount: seed.retryCount ?? 0,
      autonomous: seed.autonomous ?? false,
      reviewRound: seed.reviewRound ?? 0,
      verificationRetries: seed.verificationRetries ?? 0,
      testRetries: seed.testRetries ?? 0,
      testOutput: seed.testOutput ?? null,
      githubIssueNumber: seed.githubIssueNumber ?? null,
      githubIssueTitle: seed.githubIssueTitle ?? null,
      githubRepo: seed.githubRepo ?? null,
      plannerModel,
      reviewerModel,
      verifierModel,
      executorModel,
      plannerModelIdOverride,
      reviewerModelIdOverride,
      executorModelIdOverride,
      verifierModelIdOverride,
      plannerReasoningEffort,
      reviewerReasoningEffort,
      executorReasoningEffort,
      verifierReasoningEffort,
      executorModelOverride: seed.executorModelOverride ?? null,
      baseBranch: seed.baseBranch ?? '',
      forkPointSha: seed.forkPointSha ?? '',
      activeProcessId: seed.activeProcessId ?? null,
      cancelled: seed.cancelled ?? false,
      verifiedSha: seed.verifiedSha ?? null,
      startedAt: seed.startedAt ?? Date.now(),
      repoContext: seed.repoContext ?? null,
      repoSetupContract: seed.repoSetupContract ?? null,
      repoSetupLoaded: seed.repoSetupLoaded ?? false,
      abort: seed.abort ?? new AbortController(),
      stabilizationFeedback: seed.stabilizationFeedback ?? null,
    };
    activePipelines.set(threadId, context);
    return context;
  }

  function rehydrateContext(threadId: string, projectPath: string, issueTitle?: string | null) {
    if (activePipelines.has(threadId)) return;

    const thread = deps.threads.getById(threadId);
    if (!thread) return;
    const project = deps.projects.getById(thread.projectId);
    const settings = deps.settings.get();
    const issue =
      thread.githubIssueNumber !== null
        ? deps.githubIssues.getByNumber(thread.projectId, thread.githubIssueNumber)
        : null;

    ensureContext(threadId, {
      projectPath,
      worktreePath: thread.worktreePath ?? null,
      retryCount: 0,
      autonomous: thread.autonomous,
      reviewRound: thread.reviewRound,
      verificationRetries: thread.verificationRetries,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      githubIssueTitle: issueTitle ?? null,
      githubRepo: thread.githubRepo ?? null,
      plannerModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'planner')
          : (thread.plannerModel as PipelineExecutorModel) || 'claude',
      reviewerModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'reviewer')
          : (thread.reviewerModel as PipelineExecutorModel) || 'codex',
      verifierModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'verifier')
          : (thread.verifierModel as PipelineExecutorModel) || 'claude',
      executorModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'executor')
          : (thread.executorModel as PipelineExecutorModel) || 'claude',
      plannerModelIdOverride:
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'planner')
          : (project?.plannerModelIdOverride ?? null),
      reviewerModelIdOverride:
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'reviewer')
          : (project?.reviewerModelIdOverride ?? null),
      executorModelIdOverride:
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'executor')
          : (project?.executorModelIdOverride ?? null),
      verifierModelIdOverride:
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'verifier')
          : (project?.verifierModelIdOverride ?? null),
      plannerReasoningEffort: resolveProviderReasoningEffort(
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'planner')
          : resolvePhaseModel(settings, project, 'planner'),
        project?.plannerReasoningEffortOverride ?? settings.plannerReasoningEffort,
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'planner')
          : (project?.plannerModelIdOverride ?? null),
      ).effective,
      reviewerReasoningEffort: resolveProviderReasoningEffort(
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'reviewer')
          : resolvePhaseModel(settings, project, 'reviewer'),
        project?.reviewerReasoningEffortOverride ?? settings.reviewerReasoningEffort,
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'reviewer')
          : (project?.reviewerModelIdOverride ?? null),
      ).effective,
      executorReasoningEffort: resolveProviderReasoningEffort(
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'executor')
          : resolvePhaseModel(settings, project, 'executor'),
        project?.executorReasoningEffortOverride ?? settings.executorReasoningEffort,
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'executor')
          : (project?.executorModelIdOverride ?? null),
      ).effective,
      verifierReasoningEffort: resolveProviderReasoningEffort(
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'verifier')
          : resolvePhaseModel(settings, project, 'verifier'),
        project?.verifierReasoningEffortOverride ?? settings.verifierReasoningEffort,
        issue && project
          ? resolvePhaseModelIdForIssue(settings, project, issue, 'verifier')
          : (project?.verifierModelIdOverride ?? null),
      ).effective,
      baseBranch: thread.baseBranch ?? '',
      forkPointSha: thread.forkPointSha ?? '',
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
      stabilizationFeedback: null,
    });
  }

  function skillCallSite(context: PipelineContext) {
    const onFallback = (
      phase: import('@shipcode/shared').PhaseSkillKey,
      error: SkillValidationError | undefined,
    ) => {
      deps.emitter.emit({
        type: 'skill:fallback',
        threadId: context.threadId,
        phase,
        reason: error?.message ?? 'override quarantined',
      });
    };
    return {
      context: { projectId: context.projectId },
      deps: { skills: deps.skills, onFallback },
    };
  }

  function listActive() {
    return Array.from(activePipelines.values()).map((context) => {
      const thread = deps.threads.getById(context.threadId);
      return {
        threadId: context.threadId,
        projectPath: context.projectPath,
        phase: (thread?.status ?? 'idle') as import('@shipcode/shared').PipelinePhase,
        startedAt: context.startedAt,
        activeProcessId: context.activeProcessId,
      };
    });
  }

  return {
    activePipelines,
    ensureContext,
    rehydrateContext,
    skillCallSite,
    listActive,
  };
}
