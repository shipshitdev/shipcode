import {
  type ResolveResult,
  resolvePhaseReasoningEffort,
  type SkillValidationError,
  toPipelinePromptScope,
} from '@shipcode/agents/source';
import {
  type PhaseSkillKey,
  type PromptTelemetryPhase,
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
  resolveProviderReasoningEffort,
  type SkillResolutionSource,
} from '@shipcode/shared';
import {
  type OrchestratorState,
  PHASE_LOCAL_FIELDS,
  type PhaseCarryOutput,
  type PhaseInput,
  type PhasePayload,
  type PipelineContext,
  type PipelineDeps,
  type PipelineExecutorModel,
  type PipelinePromptPhase,
} from '../types';
import { loadWorkflowPolicy } from '../workflow-loader';
import type { PipelineContextHelpers } from './shared';

/**
 * Create a frozen snapshot of context fields for a single provider call.
 * The provider receives this instead of the full mutable PipelineContext.
 */
export function snapshotPhaseInput(context: PipelineContext): PhaseInput {
  return Object.freeze({
    threadId: context.threadId,
    projectPath: context.projectPath,
    projectId: context.projectId,
    worktreePath: context.worktreePath,
    baseBranch: context.baseBranch,
    forkPointSha: context.forkPointSha,
    githubIssueNumber: context.githubIssueNumber,
    githubIssueTitle: context.githubIssueTitle,
    githubRepo: context.githubRepo,
    autonomous: context.autonomous,
  });
}

type PhasePayloadSource = OrchestratorState;

/**
 * Resolve the executor model for a phase. Mirrors `resolveAgentForPhase` in
 * runtime.ts so `PhasePayload.model` matches what the provider call will use.
 */
function resolveModelForPhase(
  state: Pick<
    OrchestratorState,
    'plannerModel' | 'reviewerModel' | 'verifierModel' | 'executorModel'
  >,
  phase: PipelinePromptPhase,
): PipelineExecutorModel {
  switch (phase) {
    case 'plan':
    case 'revision':
      return state.plannerModel;
    case 'review':
      return state.reviewerModel;
    case 'verify':
      return state.verifierModel;
    case 'execute':
      return state.executorModel || 'claude';
  }
}

/**
 * Resolve the model-id override for a phase. Mirrors the `modelHint` logic in
 * `runProviderPhaseCore`: the executor override wins when the phase resolves to
 * the executor model, otherwise the phase's own id override applies.
 */
function resolveModelIdOverrideForPhase(
  state: Pick<
    OrchestratorState,
    | 'plannerModel'
    | 'reviewerModel'
    | 'verifierModel'
    | 'executorModel'
    | 'executorModelOverride'
    | 'plannerModelIdOverride'
    | 'reviewerModelIdOverride'
    | 'executorModelIdOverride'
    | 'verifierModelIdOverride'
  >,
  phase: PipelinePromptPhase,
): string | null {
  const model = resolveModelForPhase(state, phase);
  if (model === state.executorModel && state.executorModelOverride) {
    return state.executorModelOverride;
  }
  switch (phase) {
    case 'plan':
    case 'revision':
      return state.plannerModelIdOverride;
    case 'review':
      return state.reviewerModelIdOverride;
    case 'execute':
      return state.executorModelIdOverride;
    case 'verify':
      return state.verifierModelIdOverride;
  }
}

/**
 * Build a frozen `PhasePayload` for a single phase invocation from orchestrator
 * state plus the previous phase's consumed-once `prevOutput`. Identity + the
 * phase-resolved model, model-id override, and reasoning effort + the phase's
 * prompt materials + `promptTelemetryCount` + `carry`. The phase reads this
 * scoped view; it never mutates orchestrator state.
 *
 * `promptTelemetryCount` captures `promptTelemetry.length` at this instant; the
 * `runProviderPhase` wrapper must apply the returned telemetry delta with no
 * intervening `await` that could push to `promptTelemetry`, or the count goes
 * stale. `PipelineContext` satisfies `PhasePayloadSource`, so callers pass the
 * live context directly.
 */
export function buildPhasePayload(
  state: PhasePayloadSource,
  phase: PipelinePromptPhase,
  prevOutput?: PhaseCarryOutput,
): PhasePayload {
  const repoPromptMaterials = Object.freeze(
    (state.repoPromptMaterials ?? []).map((material) => Object.freeze({ ...material })),
  );
  const promptMaterialSummary = state.promptMaterialSummaries[phase];

  return Object.freeze({
    threadId: state.threadId,
    projectPath: state.projectPath,
    projectId: state.projectId,
    worktreePath: state.worktreePath,
    baseBranch: state.baseBranch,
    forkPointSha: state.forkPointSha,
    githubIssueNumber: state.githubIssueNumber,
    githubIssueTitle: state.githubIssueTitle,
    githubRepo: state.githubRepo,
    autonomous: state.autonomous,
    runId: state.runId,
    isAutomationRun: state.isAutomationRun,
    abort: state.abort.signal,
    promptTelemetryCount: state.promptTelemetry.length,
    phase,
    model: resolveModelForPhase(state, phase),
    modelIdOverride: resolveModelIdOverrideForPhase(state, phase),
    reasoningEffort: state.phaseReasoningEfforts[phase],
    repoContext: state.repoContext,
    repoPromptMaterials,
    promptMaterialSummary: promptMaterialSummary
      ? Object.freeze({ ...promptMaterialSummary })
      : undefined,
    carry: prevOutput ?? {},
  });
}

/**
 * Clear phase-local runtime state on PipelineContext before entering the next
 * phase. Only live state remains here (the QA-server cleanup handle and the
 * CPU-queue timestamps); all cross-phase data — fix/test/QA output, resume and
 * retry seeds — now travels typed on the `PhaseOutcome` carry, not on context.
 */
export function resetPhaseState(context: PipelineContext): void {
  for (const field of PHASE_LOCAL_FIELDS) {
    (context as unknown as Record<string, unknown>)[field] = null;
  }
}

function buildPhasePromptScopes(): PipelineContext['phasePromptScopes'] {
  return {
    plan: toPipelinePromptScope('plan'),
    review: toPipelinePromptScope('review'),
    revision: toPipelinePromptScope('revision'),
    verify: toPipelinePromptScope('verify'),
    execute: toPipelinePromptScope('execute'),
  };
}

const PROMPT_PHASE_BY_SKILL: Partial<Record<PhaseSkillKey, PromptTelemetryPhase>> = {
  'plan-generation': 'plan',
  'adversarial-review': 'review',
  'plan-revision': 'revision',
  'plan-execution': 'execute',
  'plan-verification': 'verify',
};

function toSkillResolutionSource(source: ResolveResult['skill']['source']): SkillResolutionSource {
  return source === 'default' ? 'bundled' : source;
}

function emitWorkflowWarning(deps: PipelineDeps, context: PipelineContext): void {
  if (!context.workflowPolicy.warning || context.workflowWarningEmitted) return;
  context.workflowWarningEmitted = true;
  deps.emitter.emit({
    type: 'workflow:warning',
    threadId: context.threadId,
    warning: context.workflowPolicy.warning,
  });
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
      const executorModel =
        seed.executorModel ??
        existing.executorModel ??
        (settings.executorModel as PipelineExecutorModel);
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
        clarificationHistory: seed.clarificationHistory ?? existing.clarificationHistory ?? [],
        repoPromptMaterials: seed.repoPromptMaterials ?? existing.repoPromptMaterials ?? null,
        workflowPolicy: seed.workflowPolicy ?? existing.workflowPolicy,
        workflowWarningEmitted:
          seed.workflowWarningEmitted ?? existing.workflowWarningEmitted ?? false,
      });
      emitWorkflowWarning(deps, existing);
      return existing;
    }

    const plannerModel = seed.plannerModel ?? (settings.plannerModel as PipelineExecutorModel);
    const reviewerModel = seed.reviewerModel ?? (settings.reviewerModel as PipelineExecutorModel);
    const verifierModel = seed.verifierModel ?? (settings.verifierModel as PipelineExecutorModel);
    const executorModel = seed.executorModel ?? (settings.executorModel as PipelineExecutorModel);
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

    const persistedThread = deps.threads.getById(threadId);
    const seededProjectId = seed.projectId ?? persistedThread?.projectId ?? null;
    const workflowPolicy =
      seed.workflowPolicy ?? loadWorkflowPolicy(seed.worktreePath ?? seed.projectPath);

    const context: PipelineContext = {
      threadId,
      projectPath: seed.projectPath,
      runId: seed.runId ?? persistedThread?.currentRunId ?? null,
      projectId: seededProjectId,
      worktreePath: seed.worktreePath ?? null,
      retryCount: seed.retryCount ?? 0,
      retryTimer: seed.retryTimer ?? null,
      autonomous: seed.autonomous ?? false,
      reviewRound: seed.reviewRound ?? 0,
      clarificationRound: seed.clarificationRound ?? 0,
      clarificationRequest: seed.clarificationRequest ?? null,
      clarificationAnswers: seed.clarificationAnswers ?? [],
      clarificationHistory: seed.clarificationHistory ?? [],
      verificationRetries: seed.verificationRetries ?? 0,
      nodeVerificationRetries: seed.nodeVerificationRetries ?? 0,
      nodeAnchorSha: seed.nodeAnchorSha ?? null,
      testRetries: seed.testRetries ?? 0,
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
      workflowPolicy,
      workflowWarningEmitted: seed.workflowWarningEmitted ?? false,
      abort: seed.abort ?? new AbortController(),
      turnCount: seed.turnCount ?? 0,
      featureQaState: seed.featureQaState ?? null,
      runtimeQaCleanup: null,
      cpuQueueStartedAt: seed.cpuQueueStartedAt ?? null,
      cpuQueueLastNotifiedAt: seed.cpuQueueLastNotifiedAt ?? null,
      isAutomationRun: seed.isAutomationRun ?? false,
    };
    activePipelines.set(threadId, context);
    emitWorkflowWarning(deps, context);
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
      runId: thread.currentRunId ?? null,
      worktreePath: thread.worktreePath ?? null,
      retryCount: 0,
      autonomous: thread.autonomous,
      reviewRound: thread.reviewRound,
      clarificationRound: thread.clarificationRound,
      clarificationRequest: thread.clarificationRequest,
      clarificationAnswers: thread.clarificationAnswers,
      clarificationHistory: thread.answeredClarification ? [thread.answeredClarification] : [],
      verificationRetries: thread.verificationRetries,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      githubIssueTitle: issueTitle ?? null,
      githubRepo: thread.githubRepo ?? null,
      plannerModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'planner')
          : (thread.plannerModel as PipelineExecutorModel) ||
            (settings.plannerModel as PipelineExecutorModel),
      reviewerModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'reviewer')
          : (thread.reviewerModel as PipelineExecutorModel) || 'codex',
      verifierModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'verifier')
          : (thread.verifierModel as PipelineExecutorModel) ||
            (settings.verifierModel as PipelineExecutorModel),
      executorModel:
        issue && project
          ? resolvePhaseModelForIssue(settings, project, issue, 'executor')
          : (thread.executorModel as PipelineExecutorModel) ||
            (settings.executorModel as PipelineExecutorModel),
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
    });
  }

  function skillCallSite(context: PipelineContext) {
    const onFallback = (phase: PhaseSkillKey, error: SkillValidationError | undefined) => {
      deps.emitter.emit({
        type: 'skill:fallback',
        threadId: context.threadId,
        phase,
        reason: error?.message ?? 'override quarantined',
      });
    };
    const onResolved = (phase: PhaseSkillKey, result: ResolveResult) => {
      const providerPhase = PROMPT_PHASE_BY_SKILL[phase];
      if (!providerPhase) return;
      try {
        deps.skillResolutionLogs?.create({
          threadId: context.threadId,
          providerPhase,
          skillKey: phase,
          source: toSkillResolutionSource(result.skill.source),
          baseVersion: result.skill.baseVersion,
          fallbackUsed: result.fallbackUsed,
          errorCode: result.error?.code ?? null,
          errorMessage: result.error?.message ?? null,
        });
      } catch (error) {
        console.error(
          `[pipeline] skill resolution log failed for thread ${context.threadId}:`,
          error,
        );
      }
    };
    return {
      context: { projectId: context.projectId },
      deps: { skills: deps.skills, onFallback, onResolved },
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
