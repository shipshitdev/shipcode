import { sanitizeResolvedModel } from './model-identifiers';
import { formatProviderReasoningEffort, resolveProviderReasoningEffort } from './reasoning-effort';
import {
  type AppSettings,
  type ExecutorModel,
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type PipelinePhase,
  type Project,
  type ReasoningEffort,
  type RevisionCount,
  type Thread,
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

type ProjectRevisionOverride = Pick<Project, 'revisionCountOverride'>;
type IssueRevisionOverride = Pick<GitHubIssueCacheRecord, 'revisionCountOverride'>;
type ProjectApprovalOverride = Pick<Project, 'requireApprovalOverride'>;
type IssueApprovalOverride = Pick<GitHubIssueCacheRecord, 'requireApprovalOverride'>;

type ThreadPhaseState = Pick<
  Thread,
  | 'plannerModel'
  | 'reviewerModel'
  | 'executorModel'
  | 'verifierModel'
  | 'plannerResolvedModel'
  | 'reviewerResolvedModel'
  | 'executorResolvedModel'
  | 'verifierResolvedModel'
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

export interface ThreadPhasePresentation {
  provider: ExecutorModel;
  model: string;
  effort: string | null;
}

export type RequireApprovalSource = 'app' | 'project' | 'issue';

export interface RequireApprovalResolution {
  required: boolean;
  source: RequireApprovalSource;
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
    issueStatuses: [
      ISSUE_PIPELINE_STATUS.todo,
      ISSUE_PIPELINE_STATUS.queued,
      ISSUE_PIPELINE_STATUS.planning,
      ISSUE_PIPELINE_STATUS.clarifying,
      ISSUE_PIPELINE_STATUS.revising,
      ISSUE_PIPELINE_STATUS.awaitingApproval,
    ],
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
    issueStatuses: [ISSUE_PIPELINE_STATUS.reviewing],
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
    issueStatuses: [ISSUE_PIPELINE_STATUS.executing, ISSUE_PIPELINE_STATUS.testing],
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
    issueStatuses: [ISSUE_PIPELINE_STATUS.verifying, ISSUE_PIPELINE_STATUS.shipping],
  },
] as const;

export function getPhaseDescriptor(phase: ResolvedPhaseModel): ResolvedPhaseDescriptor {
  return PHASE_DESCRIPTORS.find((descriptor) => descriptor.key === phase) ?? PHASE_DESCRIPTORS[0];
}

function asExecutorModel(value: string | null | undefined): ExecutorModel | null {
  if (value === 'claude' || value === 'codex' || value === 'openrouter') return value;
  return null;
}

function asRevisionCount(value: number | null | undefined): RevisionCount | null {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5
    ? value
    : null;
}

function asNullableBoolean(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function resolveRevisionCount(
  settings: Pick<AppSettings, 'revisionCount'>,
  project: ProjectRevisionOverride | null | undefined,
): RevisionCount {
  return (
    asRevisionCount(project?.revisionCountOverride) ?? asRevisionCount(settings.revisionCount) ?? 0
  );
}

export function resolveRevisionCountForIssue(
  settings: Pick<AppSettings, 'revisionCount'>,
  project: ProjectRevisionOverride | null | undefined,
  issue: IssueRevisionOverride | null | undefined,
): RevisionCount {
  return asRevisionCount(issue?.revisionCountOverride) ?? resolveRevisionCount(settings, project);
}

export function resolveRequireApproval(
  settings: Pick<AppSettings, 'requireApproval'>,
  project: ProjectApprovalOverride | null | undefined,
): boolean {
  return resolveRequireApprovalState(settings, project).required;
}

export function resolveRequireApprovalForIssue(
  settings: Pick<AppSettings, 'requireApproval'>,
  project: ProjectApprovalOverride | null | undefined,
  issue: IssueApprovalOverride | null | undefined,
): boolean {
  return resolveRequireApprovalStateForIssue(settings, project, issue).required;
}

export function resolveRequireApprovalState(
  settings: Pick<AppSettings, 'requireApproval'>,
  project: ProjectApprovalOverride | null | undefined,
): RequireApprovalResolution {
  const projectOverride = asNullableBoolean(project?.requireApprovalOverride);
  if (projectOverride != null) {
    return {
      required: projectOverride,
      source: 'project',
    };
  }

  return {
    required: settings.requireApproval,
    source: 'app',
  };
}

export function resolveRequireApprovalStateForIssue(
  settings: Pick<AppSettings, 'requireApproval'>,
  project: ProjectApprovalOverride | null | undefined,
  issue: IssueApprovalOverride | null | undefined,
): RequireApprovalResolution {
  const issueOverride = asNullableBoolean(issue?.requireApprovalOverride);
  if (issueOverride != null) {
    return {
      required: issueOverride,
      source: 'issue',
    };
  }

  return resolveRequireApprovalState(settings, project);
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

export function getPipelineCardPhase(status: PipelinePhase): ResolvedPhaseModel | null {
  if (
    status === PIPELINE_PHASE.planning ||
    status === PIPELINE_PHASE.clarifying ||
    status === PIPELINE_PHASE.revising ||
    status === PIPELINE_PHASE.awaitingApproval
  ) {
    return 'planner';
  }

  if (status === PIPELINE_PHASE.reviewing) return 'reviewer';
  if (status === PIPELINE_PHASE.executing || status === PIPELINE_PHASE.testing) {
    return 'executor';
  }
  if (status === PIPELINE_PHASE.verifying || status === PIPELINE_PHASE.shipping) {
    return 'verifier';
  }

  return null;
}

function resolveThreadProvider(
  thread: ThreadPhaseState,
  phase: ResolvedPhaseModel,
): ExecutorModel | null {
  const value =
    phase === 'planner'
      ? thread.plannerModel
      : phase === 'reviewer'
        ? thread.reviewerModel
        : phase === 'executor'
          ? thread.executorModel
          : thread.verifierModel;

  return asExecutorModel(value);
}

function resolveThreadModel(
  thread: ThreadPhaseState,
  phase: ResolvedPhaseModel,
  fallbackProvider: ExecutorModel,
): string {
  const resolved =
    phase === 'planner'
      ? sanitizeResolvedModel(thread.plannerResolvedModel)
      : phase === 'reviewer'
        ? sanitizeResolvedModel(thread.reviewerResolvedModel)
        : phase === 'executor'
          ? sanitizeResolvedModel(thread.executorResolvedModel)
          : sanitizeResolvedModel(thread.verifierResolvedModel);

  if (resolved) return resolved;

  const configured =
    phase === 'planner'
      ? thread.plannerModel
      : phase === 'reviewer'
        ? thread.reviewerModel
        : phase === 'executor'
          ? thread.executorModel
          : thread.verifierModel;

  return configured || fallbackProvider;
}

export function resolveThreadPhasePresentation(
  settings: AppSettings,
  project: ProjectModelOverrides | null | undefined,
  thread: ThreadPhaseState,
  status: PipelinePhase,
): ThreadPhasePresentation | null {
  const phase = getPipelineCardPhase(status);
  if (!phase) return null;

  const provider =
    resolveThreadProvider(thread, phase) ?? resolvePhaseModel(settings, project, phase);
  const model = resolveThreadModel(thread, phase, provider);
  const effort = formatProviderReasoningEffort(
    provider,
    resolvePhaseReasoningEffort(settings, project, phase),
    model,
  );

  return {
    provider,
    model,
    effort,
  };
}
