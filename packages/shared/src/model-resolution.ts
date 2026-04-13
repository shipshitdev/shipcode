import type {
  AppSettings,
  ExecutorModel,
  GitHubIssueCacheRecord,
  Project,
  ReasoningEffort,
} from './types';

export type ResolvedPhaseModel = 'planner' | 'reviewer' | 'executor' | 'verifier';

type ProjectModelOverrides = Pick<
  Project,
  | 'plannerModelOverride'
  | 'reviewerModelOverride'
  | 'executorModelOverride'
  | 'verifierModelOverride'
  | 'plannerModelIdOverride'
  | 'reviewerModelIdOverride'
  | 'executorModelIdOverride'
  | 'verifierModelIdOverride'
  | 'plannerReasoningEffortOverride'
  | 'reviewerReasoningEffortOverride'
  | 'executorReasoningEffortOverride'
  | 'verifierReasoningEffortOverride'
>;

type IssuePhaseOverrides = Pick<
  GitHubIssueCacheRecord,
  | 'plannerModelOverride'
  | 'reviewerModelOverride'
  | 'executorModelOverride'
  | 'verifierModelOverride'
  | 'plannerModelIdOverride'
  | 'reviewerModelIdOverride'
  | 'executorModelIdOverride'
  | 'verifierModelIdOverride'
>;

function asExecutorModel(value: string | null | undefined): ExecutorModel | null {
  if (value === 'claude' || value === 'codex' || value === 'openrouter') return value;
  return null;
}

export function resolvePhaseModel(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ExecutorModel {
  const projectOverride =
    phase === 'planner'
      ? project?.plannerModelOverride
      : phase === 'reviewer'
        ? project?.reviewerModelOverride
        : phase === 'executor'
          ? project?.executorModelOverride
          : project?.verifierModelOverride;

  const globalValue =
    phase === 'planner'
      ? settings.plannerModel
      : phase === 'reviewer'
        ? settings.reviewerModel
        : phase === 'executor'
          ? settings.executorModel
          : settings.verifierModel;

  return asExecutorModel(projectOverride) ?? asExecutorModel(globalValue) ?? 'claude';
}

export function resolveExecutorModelForIssue(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  issue: IssuePhaseOverrides | null | undefined,
): ExecutorModel {
  return resolvePhaseModelForIssue(settings, project, issue, 'executor');
}

export function resolvePhaseModelForIssue(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  issue: IssuePhaseOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ExecutorModel {
  const issueOverride =
    phase === 'planner'
      ? issue?.plannerModelOverride
      : phase === 'reviewer'
        ? issue?.reviewerModelOverride
        : phase === 'executor'
          ? issue?.executorModelOverride
          : issue?.verifierModelOverride;

  return asExecutorModel(issueOverride) ?? resolvePhaseModel(settings, project, phase);
}

export function resolvePhaseReasoningEffort(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ReasoningEffort {
  const projectOverride =
    phase === 'planner'
      ? project?.plannerReasoningEffortOverride
      : phase === 'reviewer'
        ? project?.reviewerReasoningEffortOverride
        : phase === 'executor'
          ? project?.executorReasoningEffortOverride
          : project?.verifierReasoningEffortOverride;
  if (projectOverride) return projectOverride;

  switch (phase) {
    case 'planner':
      return settings.plannerReasoningEffort;
    case 'reviewer':
      return settings.reviewerReasoningEffort;
    case 'executor':
      return settings.executorReasoningEffort;
    case 'verifier':
      return settings.verifierReasoningEffort;
  }
}

export function resolvePhaseModelId(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): string | null {
  const projectOverride =
    phase === 'planner'
      ? project?.plannerModelIdOverride
      : phase === 'reviewer'
        ? project?.reviewerModelIdOverride
        : phase === 'executor'
          ? project?.executorModelIdOverride
          : project?.verifierModelIdOverride;
  if (projectOverride) return projectOverride;

  const resolvedProvider = resolvePhaseModel(settings, project, phase);
  if (resolvedProvider !== 'openrouter') return null;

  switch (phase) {
    case 'planner':
      return settings.openrouterPlannerModel;
    case 'reviewer':
      return settings.openrouterReviewerModel;
    case 'executor':
      return settings.openrouterExecutorModel;
    case 'verifier':
      return settings.openrouterVerifierModel;
  }
}

export function resolvePhaseModelIdForIssue(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  issue: IssuePhaseOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): string | null {
  const issueOverride =
    phase === 'planner'
      ? issue?.plannerModelIdOverride
      : phase === 'reviewer'
        ? issue?.reviewerModelIdOverride
        : phase === 'executor'
          ? issue?.executorModelIdOverride
          : issue?.verifierModelIdOverride;
  if (issueOverride) return issueOverride;
  return resolvePhaseModelId(settings, project, phase);
}

export function getIssueCardPhase(status: GitHubIssueCacheRecord['pipelineStatus']): ResolvedPhaseModel | null {
  switch (status) {
    case 'todo':
    case 'queued':
    case 'planning':
    case 'revising':
      return 'planner';
    case 'reviewing':
      return 'reviewer';
    case 'awaiting_approval':
    case 'executing':
    case 'testing':
      return 'executor';
    case 'verifying':
      return 'verifier';
    case 'completed':
    case 'failed':
      return null;
    case 'shipping':
      return 'verifier';
  }
}
