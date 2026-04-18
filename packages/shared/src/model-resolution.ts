import { resolveProviderReasoningEffort } from './reasoning-effort';
import type {
  AppSettings,
  ExecutorModel,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  ReasoningEffort,
} from './types';

export const RESOLVED_PHASE_MODELS = ['planner', 'reviewer', 'executor', 'verifier'] as const;
export type ResolvedPhaseModel = (typeof RESOLVED_PHASE_MODELS)[number];

type PhaseSettingsModelKey = 'plannerModel' | 'reviewerModel' | 'executorModel' | 'verifierModel';
type PhaseSettingsModelIdKey =
  | 'openrouterPlannerModel'
  | 'openrouterReviewerModel'
  | 'openrouterExecutorModel'
  | 'openrouterVerifierModel';
type PhaseSettingsReasoningKey =
  | 'plannerReasoningEffort'
  | 'reviewerReasoningEffort'
  | 'executorReasoningEffort'
  | 'verifierReasoningEffort';

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
  | 'plannerReasoningEffortOverride'
  | 'reviewerReasoningEffortOverride'
  | 'executorReasoningEffortOverride'
  | 'verifierReasoningEffortOverride'
>;

export interface ResolvedPhaseDescriptor {
  key: ResolvedPhaseModel;
  label: string;
  validProviders: readonly ExecutorModel[];
  settingsModelKey: PhaseSettingsModelKey;
  settingsModelIdKey: PhaseSettingsModelIdKey;
  settingsReasoningEffortKey: PhaseSettingsReasoningKey;
  projectModelOverrideKey: keyof Pick<
    Project,
    | 'plannerModelOverride'
    | 'reviewerModelOverride'
    | 'executorModelOverride'
    | 'verifierModelOverride'
  >;
  projectModelIdOverrideKey: keyof Pick<
    Project,
    | 'plannerModelIdOverride'
    | 'reviewerModelIdOverride'
    | 'executorModelIdOverride'
    | 'verifierModelIdOverride'
  >;
  projectReasoningEffortOverrideKey: keyof Pick<
    Project,
    | 'plannerReasoningEffortOverride'
    | 'reviewerReasoningEffortOverride'
    | 'executorReasoningEffortOverride'
    | 'verifierReasoningEffortOverride'
  >;
  issueModelOverrideKey: keyof Pick<
    GitHubIssueCacheRecord,
    | 'plannerModelOverride'
    | 'reviewerModelOverride'
    | 'executorModelOverride'
    | 'verifierModelOverride'
  >;
  issueModelIdOverrideKey: keyof Pick<
    GitHubIssueCacheRecord,
    | 'plannerModelIdOverride'
    | 'reviewerModelIdOverride'
    | 'executorModelIdOverride'
    | 'verifierModelIdOverride'
  >;
  issueReasoningEffortOverrideKey: keyof Pick<
    GitHubIssueCacheRecord,
    | 'plannerReasoningEffortOverride'
    | 'reviewerReasoningEffortOverride'
    | 'executorReasoningEffortOverride'
    | 'verifierReasoningEffortOverride'
  >;
  issueStatuses: readonly IssuePipelineStatus[];
}

const VALID_PHASE_PROVIDERS = [
  'claude',
  'codex',
  'openrouter',
] as const satisfies readonly ExecutorModel[];

export const PHASE_DESCRIPTORS: readonly ResolvedPhaseDescriptor[] = [
  {
    key: 'planner',
    label: 'Planner',
    validProviders: VALID_PHASE_PROVIDERS,
    settingsModelKey: 'plannerModel',
    settingsModelIdKey: 'openrouterPlannerModel',
    settingsReasoningEffortKey: 'plannerReasoningEffort',
    projectModelOverrideKey: 'plannerModelOverride',
    projectModelIdOverrideKey: 'plannerModelIdOverride',
    projectReasoningEffortOverrideKey: 'plannerReasoningEffortOverride',
    issueModelOverrideKey: 'plannerModelOverride',
    issueModelIdOverrideKey: 'plannerModelIdOverride',
    issueReasoningEffortOverrideKey: 'plannerReasoningEffortOverride',
    issueStatuses: ['todo', 'queued', 'planning', 'revising', 'awaiting_approval'],
  },
  {
    key: 'reviewer',
    label: 'Reviewer',
    validProviders: VALID_PHASE_PROVIDERS,
    settingsModelKey: 'reviewerModel',
    settingsModelIdKey: 'openrouterReviewerModel',
    settingsReasoningEffortKey: 'reviewerReasoningEffort',
    projectModelOverrideKey: 'reviewerModelOverride',
    projectModelIdOverrideKey: 'reviewerModelIdOverride',
    projectReasoningEffortOverrideKey: 'reviewerReasoningEffortOverride',
    issueModelOverrideKey: 'reviewerModelOverride',
    issueModelIdOverrideKey: 'reviewerModelIdOverride',
    issueReasoningEffortOverrideKey: 'reviewerReasoningEffortOverride',
    issueStatuses: ['reviewing'],
  },
  {
    key: 'executor',
    label: 'Executor',
    validProviders: VALID_PHASE_PROVIDERS,
    settingsModelKey: 'executorModel',
    settingsModelIdKey: 'openrouterExecutorModel',
    settingsReasoningEffortKey: 'executorReasoningEffort',
    projectModelOverrideKey: 'executorModelOverride',
    projectModelIdOverrideKey: 'executorModelIdOverride',
    projectReasoningEffortOverrideKey: 'executorReasoningEffortOverride',
    issueModelOverrideKey: 'executorModelOverride',
    issueModelIdOverrideKey: 'executorModelIdOverride',
    issueReasoningEffortOverrideKey: 'executorReasoningEffortOverride',
    issueStatuses: ['executing', 'testing'],
  },
  {
    key: 'verifier',
    label: 'Verifier',
    validProviders: VALID_PHASE_PROVIDERS,
    settingsModelKey: 'verifierModel',
    settingsModelIdKey: 'openrouterVerifierModel',
    settingsReasoningEffortKey: 'verifierReasoningEffort',
    projectModelOverrideKey: 'verifierModelOverride',
    projectModelIdOverrideKey: 'verifierModelIdOverride',
    projectReasoningEffortOverrideKey: 'verifierReasoningEffortOverride',
    issueModelOverrideKey: 'verifierModelOverride',
    issueModelIdOverrideKey: 'verifierModelIdOverride',
    issueReasoningEffortOverrideKey: 'verifierReasoningEffortOverride',
    issueStatuses: ['verifying', 'shipping'],
  },
] as const;

export function getPhaseDescriptor(phase: ResolvedPhaseModel): ResolvedPhaseDescriptor {
  return PHASE_DESCRIPTORS.find((descriptor) => descriptor.key === phase) ?? PHASE_DESCRIPTORS[0];
}

function asExecutorModel(value: string | null | undefined): ExecutorModel | null {
  if (value === 'claude' || value === 'codex' || value === 'openrouter') return value;
  return null;
}

export function resolvePhaseModel(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ExecutorModel {
  const descriptor = getPhaseDescriptor(phase);
  const projectOverride = project?.[descriptor.projectModelOverrideKey];
  const globalValue = settings[descriptor.settingsModelKey];

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
  const descriptor = getPhaseDescriptor(phase);
  const issueOverride = issue?.[descriptor.issueModelOverrideKey];

  return asExecutorModel(issueOverride) ?? resolvePhaseModel(settings, project, phase);
}

export function resolvePhaseReasoningEffort(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ReasoningEffort {
  const descriptor = getPhaseDescriptor(phase);
  const projectOverride = project?.[descriptor.projectReasoningEffortOverrideKey];
  if (projectOverride != null) return projectOverride;
  return settings[descriptor.settingsReasoningEffortKey];
}

export function resolveEffectivePhaseReasoningEffort(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ReasoningEffort {
  const provider = resolvePhaseModel(settings, project, phase);
  const modelId = resolvePhaseModelId(settings, project, phase);
  const configured = resolvePhaseReasoningEffort(settings, project, phase);
  return resolveProviderReasoningEffort(provider, configured, modelId).effective;
}

export function resolvePhaseModelId(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): string | null {
  const descriptor = getPhaseDescriptor(phase);
  const projectOverride = project?.[descriptor.projectModelIdOverrideKey];
  if (projectOverride) return projectOverride;

  const resolvedProvider = resolvePhaseModel(settings, project, phase);
  if (resolvedProvider !== 'openrouter') return null;
  return settings[descriptor.settingsModelIdKey];
}

export function resolvePhaseModelIdForIssue(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  issue: IssuePhaseOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): string | null {
  const descriptor = getPhaseDescriptor(phase);
  const issueOverride = issue?.[descriptor.issueModelIdOverrideKey];
  if (issueOverride) return issueOverride;
  return resolvePhaseModelId(settings, project, phase);
}

export function resolvePhaseReasoningEffortForIssue(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  issue: IssuePhaseOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ReasoningEffort {
  const descriptor = getPhaseDescriptor(phase);
  const issueOverride = issue?.[descriptor.issueReasoningEffortOverrideKey];
  if (issueOverride != null) return issueOverride;
  return resolvePhaseReasoningEffort(settings, project, phase);
}

export function resolveEffectivePhaseReasoningEffortForIssue(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  issue: IssuePhaseOverrides | null | undefined,
  phase: ResolvedPhaseModel,
): ReasoningEffort {
  const provider = resolvePhaseModelForIssue(settings, project, issue, phase);
  const modelId = resolvePhaseModelIdForIssue(settings, project, issue, phase);
  const configured = resolvePhaseReasoningEffortForIssue(settings, project, issue, phase);
  return resolveProviderReasoningEffort(provider, configured, modelId).effective;
}

export function getIssueCardPhase(
  status: GitHubIssueCacheRecord['pipelineStatus'],
): ResolvedPhaseModel | null {
  return (
    PHASE_DESCRIPTORS.find((descriptor) => descriptor.issueStatuses.includes(status))?.key ?? null
  );
}
