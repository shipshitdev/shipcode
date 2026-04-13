import type { AppSettings, ExecutorModel, GitHubIssueCacheRecord, Project } from './types';

export type ResolvedPhaseModel = 'planner' | 'reviewer' | 'executor' | 'verifier';

type ProjectModelOverrides = Pick<
  Project,
  | 'plannerModelOverride'
  | 'reviewerModelOverride'
  | 'executorModelOverride'
  | 'verifierModelOverride'
>;

type IssueExecutorOverride = Pick<GitHubIssueCacheRecord, 'executorModelOverride'>;

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
  issue: IssueExecutorOverride | null | undefined,
): ExecutorModel {
  return asExecutorModel(issue?.executorModelOverride) ?? resolvePhaseModel(settings, project, 'executor');
}

export function resolvePhaseReasoningEffort(
  settings: AppSettings,
  phase: ResolvedPhaseModel,
): 'low' | 'medium' | 'high' {
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
