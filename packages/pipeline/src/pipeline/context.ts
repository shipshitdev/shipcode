import type { SkillValidationError } from '@shipcode/agents';
import { resolvePhaseReasoningEffort, toPipelinePromptScope } from '@shipcode/agents/source';
import {
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import type { PipelineContext, PipelineDeps, PipelineExecutorModel } from '../types';
import type { PipelineContextHelpers } from './shared';

function buildPhasePromptScopes(): PipelineContext['phasePromptScopes'] {
  return {
    plan: toPipelinePromptScope('plan'),
    review: toPipelinePromptScope('review'),
    revision: toPipelinePromptScope('revision'),
    verify: toPipelinePromptScope('verify'),
    execute: toPipelinePromptScope('execute'),
  };
}

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
      const phaseReasoningOverrides = {
        plan:
          seed.phaseReasoningOverrides?.plan ??
          existing.phaseReasoningOverrides.plan ??
          seed.plannerReasoningEffort ??
          existing.phaseReasoningOverrides.plan ??
          settings.plannerReasoningEffort,
        review:
          seed.phaseReasoningOverrides?.review ??
          existing.phaseReasoningOverrides.review ??
          seed.reviewerReasoningEffort ??
          settings.reviewerReasoningEffort,
        revision:
          seed.phaseReasoningOverrides?.revision ??
          existing.phaseReasoningOverrides.revision ??
          seed.plannerReasoningEffort ??
          existing.phaseReasoningOverrides.plan ??
          settings.plannerReasoningEffort,
        execute:
          seed.phaseReasoningOverrides?.execute ??
          existing.phaseReasoningOverrides.execute ??
          seed.executorReasoningEffort ??
          settings.executorReasoningEffort,
        verify:
          seed.phaseReasoningOverrides?.verify ??
          existing.phaseReasoningOverrides.verify ??
          seed.verifierReasoningEffort ??
          settings.verifierReasoningEffort,
      } satisfies PipelineContext['phaseReasoningOverrides'];
      const phaseReasoningEfforts = {
        plan: resolveProviderReasoningEffort(
          plannerModel,
          resolvePhaseReasoningEffort('plan', phaseReasoningOverrides.plan),
          plannerModelIdOverride,
        ).effective,
        review: resolveProviderReasoningEffort(
          reviewerModel,
          resolvePhaseReasoningEffort('review', phaseReasoningOverrides.review),
          reviewerModelIdOverride,
        ).effective,
        revision: resolveProviderReasoningEffort(
          plannerModel,
          resolvePhaseReasoningEffort('revision', phaseReasoningOverrides.revision),
          plannerModelIdOverride,
        ).effective,
        execute: resolveProviderReasoningEffort(
          executorModel,
          resolvePhaseReasoningEffort('execute', phaseReasoningOverrides.execute),
          executorModelIdOverride,
        ).effective,
        verify: resolveProviderReasoningEffort(
          verifierModel,
          resolvePhaseReasoningEffort('verify', phaseReasoningOverrides.verify),
          verifierModelIdOverride,
        ).effective,
      } satisfies PipelineContext['phaseReasoningEfforts'];
      const plannerReasoningEffort = resolveProviderReasoningEffort(
        plannerModel,
        phaseReasoningEfforts.plan,
        plannerModelIdOverride,
      ).effective;
      const reviewerReasoningEffort = resolveProviderReasoningEffort(
        reviewerModel,
        phaseReasoningEfforts.review,
        reviewerModelIdOverride,
      ).effective;
      const executorReasoningEffort = resolveProviderReasoningEffort(
        executorModel,
        phaseReasoningEfforts.execute,
        executorModelIdOverride,
      ).effective;
      const verifierReasoningEffort = resolveProviderReasoningEffort(
        verifierModel,
        phaseReasoningEfforts.verify,
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
        phasePromptScopes: seed.phasePromptScopes ?? existing.phasePromptScopes,
        phaseReasoningOverrides,
        phaseReasoningEfforts,
        plannerReasoningEffort,
        reviewerReasoningEffort,
        executorReasoningEffort,
        verifierReasoningEffort,
        repoPromptMaterials: seed.repoPromptMaterials ?? existing.repoPromptMaterials ?? null,
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
    const phaseReasoningOverrides = {
      plan:
        seed.phaseReasoningOverrides?.plan ??
        seed.plannerReasoningEffort ??
        settings.plannerReasoningEffort,
      review:
        seed.phaseReasoningOverrides?.review ??
        seed.reviewerReasoningEffort ??
        settings.reviewerReasoningEffort,
      revision:
        seed.phaseReasoningOverrides?.revision ??
        seed.plannerReasoningEffort ??
        settings.plannerReasoningEffort,
      execute:
        seed.phaseReasoningOverrides?.execute ??
        seed.executorReasoningEffort ??
        settings.executorReasoningEffort,
      verify:
        seed.phaseReasoningOverrides?.verify ??
        seed.verifierReasoningEffort ??
        settings.verifierReasoningEffort,
    } satisfies PipelineContext['phaseReasoningOverrides'];
    const phaseReasoningEfforts = {
      plan: resolveProviderReasoningEffort(
        plannerModel,
        resolvePhaseReasoningEffort('plan', phaseReasoningOverrides.plan),
        plannerModelIdOverride,
      ).effective,
      review: resolveProviderReasoningEffort(
        reviewerModel,
        resolvePhaseReasoningEffort('review', phaseReasoningOverrides.review),
        reviewerModelIdOverride,
      ).effective,
      revision: resolveProviderReasoningEffort(
        plannerModel,
        resolvePhaseReasoningEffort('revision', phaseReasoningOverrides.revision),
        plannerModelIdOverride,
      ).effective,
      execute: resolveProviderReasoningEffort(
        executorModel,
        resolvePhaseReasoningEffort('execute', phaseReasoningOverrides.execute),
        executorModelIdOverride,
      ).effective,
      verify: resolveProviderReasoningEffort(
        verifierModel,
        resolvePhaseReasoningEffort('verify', phaseReasoningOverrides.verify),
        verifierModelIdOverride,
      ).effective,
    } satisfies PipelineContext['phaseReasoningEfforts'];
    const plannerReasoningEffort = phaseReasoningEfforts.plan;
    const reviewerReasoningEffort = phaseReasoningEfforts.review;
    const executorReasoningEffort = phaseReasoningEfforts.execute;
    const verifierReasoningEffort = phaseReasoningEfforts.verify;

    const seededProjectId = seed.projectId ?? deps.threads.getById(threadId)?.projectId ?? null;

    const context: PipelineContext = {
      threadId,
      projectPath: seed.projectPath,
      projectId: seededProjectId,
      worktreePath: seed.worktreePath ?? null,
      retryCount: seed.retryCount ?? 0,
      autonomous: seed.autonomous ?? false,
      reviewRound: seed.reviewRound ?? 0,
      clarificationRound: seed.clarificationRound ?? 0,
      clarificationRequest: seed.clarificationRequest ?? null,
      clarificationAnswers: seed.clarificationAnswers ?? [],
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
      repoPromptMaterials: seed.repoPromptMaterials ?? null,
      phasePromptScopes: seed.phasePromptScopes ?? buildPhasePromptScopes(),
      phaseReasoningOverrides,
      phaseReasoningEfforts,
      promptMaterialSummaries: seed.promptMaterialSummaries ?? {},
      promptTelemetry: seed.promptTelemetry ?? [],
      promptTelemetryDiagnostics: seed.promptTelemetryDiagnostics ?? [],
      repoSetupContract: seed.repoSetupContract ?? null,
      repoSetupLoaded: seed.repoSetupLoaded ?? false,
      abort: seed.abort ?? new AbortController(),
      stabilizationFeedback: seed.stabilizationFeedback ?? null,
      previousPlanRawOutput: seed.previousPlanRawOutput ?? null,
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
      clarificationRound: thread.clarificationRound,
      clarificationRequest: thread.clarificationRequest,
      clarificationAnswers: thread.clarificationAnswers,
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
      plannerReasoningEffort:
        project?.plannerReasoningEffortOverride ?? settings.plannerReasoningEffort,
      reviewerReasoningEffort:
        project?.reviewerReasoningEffortOverride ?? settings.reviewerReasoningEffort,
      executorReasoningEffort:
        project?.executorReasoningEffortOverride ?? settings.executorReasoningEffort,
      verifierReasoningEffort:
        project?.verifierReasoningEffortOverride ?? settings.verifierReasoningEffort,
      baseBranch: thread.baseBranch ?? '',
      forkPointSha: thread.forkPointSha ?? '',
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
      stabilizationFeedback: null,
      previousPlanRawOutput: null,
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
        projectId: context.projectId ?? thread?.projectId ?? null,
        projectPath: context.projectPath,
        worktreePath: context.worktreePath ?? null,
        phase: (thread?.status ?? 'idle') as import('@shipcode/shared').PipelinePhase,
        startedAt: context.startedAt,
        activeProcessId: context.activeProcessId,
      };
    });
  }

  function listActiveInPhases(phases: readonly string[]) {
    const phaseSet = new Set(phases);
    return listActive().filter((s) => phaseSet.has(s.phase));
  }

  return {
    activePipelines,
    ensureContext,
    rehydrateContext,
    skillCallSite,
    listActive,
    listActiveInPhases,
  };
}
