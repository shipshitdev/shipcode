export type ExecutorModel = 'claude' | 'codex' | 'openrouter';
export type AgentType = ExecutorModel | 'gh';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type RevisionCount = 0 | 1 | 2 | 3 | 4 | 5;
export type ResolvedPhaseModel = 'planner' | 'reviewer' | 'executor' | 'verifier';

export type PipelinePhase =
  | 'idle'
  | 'planning'
  | 'clarifying'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'testing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed';

export type ThreadStatus = PipelinePhase;

export type IssuePipelineStatus =
  | 'todo'
  | 'queued'
  | 'planning'
  | 'clarifying'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'testing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'done'
  | 'failed';

export interface PlanFileChange {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  description: string;
  fromPath?: string;
}

export interface PlanStep {
  order: number;
  description: string;
  files: string[];
  rationale: string;
}

export interface ShipCodePlan {
  id: string;
  threadId: string;
  version: number;
  objective: string;
  files: PlanFileChange[];
  steps: PlanStep[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  dependencies: string[];
}

export interface ReviewFinding {
  id: string;
  severity: 'critical' | 'major' | 'minor' | 'nit';
  category: 'correctness' | 'security' | 'performance' | 'design' | 'missing';
  filePath?: string;
  stepOrder?: number;
  description: string;
  suggestion?: string;
}

export interface PlanReview {
  planId: string;
  decision: 'approve' | 'request_changes' | 'reject';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  findings: ReviewFinding[];
  suggestedChanges: string[];
}

export interface DiffRecord {
  id: string;
  threadId: string;
  filePath: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  diffContent: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  createdAt: string;
}

export interface CriteriaCheck {
  criterion: string;
  passed: boolean;
  evidence: string;
}

export interface VerificationIssue {
  severity: 'blocker' | 'warning';
  description: string;
  filePath?: string;
}

export interface VerificationResult {
  threadId: string;
  planId: string;
  result: 'passed' | 'failed';
  summary: string;
  criteriaResults: CriteriaCheck[];
  issues: VerificationIssue[];
}

export interface StatusLabelMapping {
  [pipelineStatus: string]: string;
}

export interface Project {
  id?: string;
  name?: string;
  plannerModelOverride?: AgentType | null;
  reviewerModelOverride?: AgentType | null;
  executorModelOverride?: AgentType | null;
  verifierModelOverride?: AgentType | null;
  plannerModelIdOverride?: string | null;
  reviewerModelIdOverride?: string | null;
  executorModelIdOverride?: string | null;
  verifierModelIdOverride?: string | null;
  plannerReasoningEffortOverride?: ReasoningEffort | null;
  reviewerReasoningEffortOverride?: ReasoningEffort | null;
  executorReasoningEffortOverride?: ReasoningEffort | null;
  verifierReasoningEffortOverride?: ReasoningEffort | null;
  revisionCountOverride?: RevisionCount | null;
  requireApprovalOverride?: boolean | null;
}

export interface AppSettings {
  plannerModel: AgentType;
  reviewerModel: AgentType;
  executorModel: AgentType;
  verifierModel: AgentType;
  plannerReasoningEffort: ReasoningEffort;
  reviewerReasoningEffort: ReasoningEffort;
  executorReasoningEffort: ReasoningEffort;
  verifierReasoningEffort: ReasoningEffort;
  openrouterPlannerModel: string | null;
  openrouterReviewerModel: string | null;
  openrouterExecutorModel: string | null;
  openrouterVerifierModel: string | null;
  revisionCount: RevisionCount;
  requireApproval: boolean;
}

export interface Thread {
  id: string;
  plannerModel: string;
  reviewerModel: string;
  executorModel: string;
  verifierModel: string;
  plannerResolvedModel: string | null;
  reviewerResolvedModel: string | null;
  executorResolvedModel: string | null;
  verifierResolvedModel: string | null;
  reviewRound: number;
}

export interface GitHubIssueCacheRecord {
  id: string;
  projectId: string;
  issueNumber: number;
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
  state: string;
  pipelineStatus: IssuePipelineStatus;
  threadId: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  lastPhaseUpdate: string | null;
  lastStatusLabel: string | null;
  plannerModelOverride: ExecutorModel | null;
  reviewerModelOverride: ExecutorModel | null;
  executorModelOverride: ExecutorModel | null;
  verifierModelOverride: ExecutorModel | null;
  plannerModelIdOverride: string | null;
  reviewerModelIdOverride: string | null;
  executorModelIdOverride: string | null;
  verifierModelIdOverride: string | null;
  plannerReasoningEffortOverride: ReasoningEffort | null;
  reviewerReasoningEffortOverride: ReasoningEffort | null;
  executorReasoningEffortOverride: ReasoningEffort | null;
  verifierReasoningEffortOverride: ReasoningEffort | null;
  revisionCountOverride: RevisionCount | null;
  requireApprovalOverride?: boolean | null;
  linkedPrNumber: number | null;
  linkedPrUrl: string | null;
  linkedPrIsDraft: boolean;
  ciBlocked: boolean;
  failingChecks: unknown[];
  unresolvedReviewComments: unknown[];
  unresolvedReviewCommentCount: number;
  prLastSyncAt: string | null;
  fetchedAt: string;
}

export function isSyntheticResolvedModel(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === '<synthetic>';
}

export function sanitizeResolvedModel(value: string | null | undefined): string | null {
  if (!value) return null;
  return isSyntheticResolvedModel(value) ? null : value;
}

export function phaseToProgress(phase: PipelinePhase | IssuePipelineStatus): number {
  const map: Record<string, number> = {
    idle: 0,
    todo: 0,
    queued: 2,
    planning: 12,
    clarifying: 20,
    reviewing: 28,
    revising: 38,
    awaiting_approval: 48,
    executing: 72,
    testing: 82,
    verifying: 90,
    shipping: 96,
    completed: 92,
    done: 100,
    failed: 0,
  };
  return map[phase] ?? 0;
}

const KNOWN_MODEL_LABELS: Record<string, string> = {
  claude: 'Sonnet 4.6',
  codex: 'GPT-5.4',
  openrouter: 'OpenRouter',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'openrouter/auto': 'Auto (paid)',
  'openrouter/free': 'Auto (free)',
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'anthropic/claude-opus-4.6': 'Claude Opus 4.6',
  'anthropic/claude-opus-4-6': 'Claude Opus 4.6',
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
  'qwen/qwen3-coder:free': 'Qwen 3 Coder Free',
  'openai/gpt-5-codex': 'GPT-5 Codex',
};

export const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Claude',
  codex: 'Codex',
  openrouter: 'OpenRouter',
};

export const MODEL_DISPLAY: Record<string, string> = { ...KNOWN_MODEL_LABELS };

const CODEX_MODEL_PATTERN = /^gpt-5(?:[.-]|$)/i;

function normalizeModel(value: string | null | undefined): string | null {
  const sanitized = sanitizeResolvedModel(value);
  if (!sanitized) return null;
  const trimmed = sanitized.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function modelDisplay(model: string): string {
  return MODEL_DISPLAY[model] ?? model;
}

export function providerDisplay(provider: ExecutorModel): string {
  return PROVIDER_DISPLAY[provider];
}

export function inferProviderFromModel(
  ...values: Array<string | null | undefined>
): ExecutorModel | null {
  for (const value of values) {
    const normalized = normalizeModel(value);
    if (!normalized) continue;
    if (normalized === 'claude' || normalized.startsWith('claude-')) return 'claude';
    if (normalized === 'codex' || CODEX_MODEL_PATTERN.test(normalized)) return 'codex';
    if (
      normalized === 'openrouter' ||
      normalized.startsWith('openrouter/') ||
      normalized.includes('/')
    ) {
      return 'openrouter';
    }
  }
  return null;
}

export function formatProviderModelDisplay(
  provider: ExecutorModel,
  modelId: string | null | undefined,
): string {
  const providerLabel = providerDisplay(provider);
  const normalizedModel = normalizeModel(modelId);
  if (!normalizedModel) return providerLabel;
  const modelLabel = modelDisplay(normalizedModel);
  return modelLabel.toLowerCase().startsWith(providerLabel.toLowerCase())
    ? modelLabel
    : `${providerLabel} / ${modelLabel}`;
}

function chooseDisplayModel(
  provider: ExecutorModel,
  requestedModel: string | null | undefined,
  resolvedModel: string | null | undefined,
): string | null {
  const requested = normalizeModel(requestedModel);
  const resolved = normalizeModel(resolvedModel);
  if (provider === 'openrouter') return resolved ?? requested;
  if (requested && requested !== provider && inferProviderFromModel(requested) === provider) {
    return requested;
  }
  if (resolved && resolved !== provider && inferProviderFromModel(resolved) === provider) {
    return resolved;
  }
  return resolved ?? requested;
}

export function formatResolvedModelDisplay(
  requestedModel: string | null | undefined,
  resolvedModel: string | null | undefined,
): string | null {
  const provider = inferProviderFromModel(resolvedModel, requestedModel);
  if (!provider) {
    const fallback = normalizeModel(resolvedModel) ?? normalizeModel(requestedModel);
    return fallback ? modelDisplay(fallback) : null;
  }
  return formatProviderModelDisplay(
    provider,
    chooseDisplayModel(provider, requestedModel, resolvedModel),
  );
}

const PHASE_DESCRIPTORS = [
  {
    key: 'planner',
    settingsModelKey: 'plannerModel',
    settingsModelIdKey: 'openrouterPlannerModel',
    settingsReasoningEffortKey: 'plannerReasoningEffort',
    projectModelOverrideKey: 'plannerModelOverride',
    projectModelIdOverrideKey: 'plannerModelIdOverride',
    projectReasoningEffortOverrideKey: 'plannerReasoningEffortOverride',
    issueModelOverrideKey: 'plannerModelOverride',
    issueModelIdOverrideKey: 'plannerModelIdOverride',
    issueReasoningEffortOverrideKey: 'plannerReasoningEffortOverride',
    issueStatuses: ['todo', 'queued', 'planning', 'clarifying', 'revising', 'awaiting_approval'],
  },
  {
    key: 'reviewer',
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
    settingsModelKey: 'executorModel',
    settingsModelIdKey: 'openrouterExecutorModel',
    settingsReasoningEffortKey: 'executorReasoningEffort',
    projectModelOverrideKey: 'executorModelOverride',
    projectModelIdOverrideKey: 'executorModelIdOverride',
    projectReasoningEffortOverrideKey: 'executorReasoningEffortOverride',
    issueModelOverrideKey: 'executorModelOverride',
    issueModelIdOverrideKey: 'executorModelIdOverride',
    issueReasoningEffortKey: 'executorReasoningEffort',
    issueReasoningEffortOverrideKey: 'executorReasoningEffortOverride',
    issueStatuses: ['executing', 'testing'],
  },
  {
    key: 'verifier',
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

type PhaseDescriptor = (typeof PHASE_DESCRIPTORS)[number];

function getPhaseDescriptor(phase: ResolvedPhaseModel): PhaseDescriptor {
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

export function resolveRevisionCountForIssue(
  settings: Pick<AppSettings, 'revisionCount'>,
  project: Pick<Project, 'revisionCountOverride'> | null | undefined,
  issue: Pick<GitHubIssueCacheRecord, 'revisionCountOverride'> | null | undefined,
): RevisionCount {
  return (
    asRevisionCount(issue?.revisionCountOverride) ??
    asRevisionCount(project?.revisionCountOverride) ??
    asRevisionCount(settings.revisionCount) ??
    0
  );
}

export interface RequireApprovalResolution {
  required: boolean;
  source: 'app' | 'project' | 'issue';
}

export function resolveRequireApprovalStateForIssue(
  settings: Pick<AppSettings, 'requireApproval'>,
  project: Pick<Project, 'requireApprovalOverride'> | null | undefined,
  issue: Pick<GitHubIssueCacheRecord, 'requireApprovalOverride'> | null | undefined,
): RequireApprovalResolution {
  const issueOverride = asNullableBoolean(issue?.requireApprovalOverride);
  if (issueOverride != null) return { required: issueOverride, source: 'issue' };
  const projectOverride = asNullableBoolean(project?.requireApprovalOverride);
  if (projectOverride != null) return { required: projectOverride, source: 'project' };
  return { required: settings.requireApproval, source: 'app' };
}

export function resolvePhaseModel(
  settings: AppSettings,
  project: Project | null | undefined,
  phase: ResolvedPhaseModel,
): ExecutorModel {
  const descriptor = getPhaseDescriptor(phase);
  return (
    asExecutorModel(project?.[descriptor.projectModelOverrideKey]) ??
    asExecutorModel(settings[descriptor.settingsModelKey]) ??
    'claude'
  );
}

export function resolvePhaseModelForIssue(
  settings: AppSettings,
  project: Project | null | undefined,
  issue: GitHubIssueCacheRecord | null | undefined,
  phase: ResolvedPhaseModel,
): ExecutorModel {
  const descriptor = getPhaseDescriptor(phase);
  return (
    asExecutorModel(issue?.[descriptor.issueModelOverrideKey]) ??
    resolvePhaseModel(settings, project, phase)
  );
}

export function resolveExecutorModelForIssue(
  settings: AppSettings,
  project: Project | null | undefined,
  issue: GitHubIssueCacheRecord | null | undefined,
): ExecutorModel {
  return resolvePhaseModelForIssue(settings, project, issue, 'executor');
}

export function resolvePhaseReasoningEffort(
  settings: AppSettings,
  project: Project | null | undefined,
  phase: ResolvedPhaseModel,
): ReasoningEffort {
  const descriptor = getPhaseDescriptor(phase);
  return (
    project?.[descriptor.projectReasoningEffortOverrideKey] ??
    settings[descriptor.settingsReasoningEffortKey]
  );
}

export function resolvePhaseModelId(
  settings: AppSettings,
  project: Project | null | undefined,
  phase: ResolvedPhaseModel,
): string | null {
  const descriptor = getPhaseDescriptor(phase);
  const projectOverride = project?.[descriptor.projectModelIdOverrideKey];
  if (projectOverride) return projectOverride;
  return resolvePhaseModel(settings, project, phase) === 'openrouter'
    ? settings[descriptor.settingsModelIdKey]
    : null;
}

export function resolvePhaseModelIdForIssue(
  settings: AppSettings,
  project: Project | null | undefined,
  issue: GitHubIssueCacheRecord | null | undefined,
  phase: ResolvedPhaseModel,
): string | null {
  const descriptor = getPhaseDescriptor(phase);
  return (
    issue?.[descriptor.issueModelIdOverrideKey] ?? resolvePhaseModelId(settings, project, phase)
  );
}

export function getIssueCardPhase(status: IssuePipelineStatus): ResolvedPhaseModel | null {
  return (
    PHASE_DESCRIPTORS.find((descriptor) =>
      (descriptor.issueStatuses as readonly IssuePipelineStatus[]).includes(status),
    )?.key ?? null
  );
}

export function formatReasoningEffortLabel(effort: ReasoningEffort): string {
  const labels: Record<ReasoningEffort, string> = {
    none: 'None',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Max',
  };
  return labels[effort];
}

export function formatProviderReasoningEffort(
  provider: ExecutorModel,
  configured: ReasoningEffort,
  modelId?: string | null,
): ReasoningEffort {
  if (provider === 'claude') {
    if (configured === 'minimal' || configured === 'low') return 'none';
    if (configured === 'xhigh') return 'high';
    return configured;
  }
  const normalizedModelId = modelId?.trim();
  if (provider === 'openrouter' && normalizedModelId === 'qwen/qwen3-coder:free') return 'none';
  if (
    provider === 'openrouter' &&
    configured !== 'none' &&
    (normalizedModelId === 'anthropic/claude-sonnet-4.6' ||
      normalizedModelId === 'anthropic/claude-opus-4.6')
  ) {
    return 'high';
  }
  return configured;
}
