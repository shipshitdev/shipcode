// === Repo Memory Types ===

export interface MemoryFileInfo {
  name: string;
  exists: boolean;
  size?: number;
  updatedAt?: string;
}

export interface RepoMemoryStatus {
  files: MemoryFileInfo[];
  hasObsoleteContextDirectory: boolean;
}

// Back-compat aliases for the generated repo-memory tooling surface used by
// the desktop context tab and agents package.
export type ContextFileInfo = MemoryFileInfo;

// === Plan Types ===

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

export interface PlanStep {
  order: number;
  description: string;
  files: string[];
  rationale: string;
}

export interface PlanFileChange {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  description: string;
  fromPath?: string;
}

// === Review Types ===

export interface PlanReview {
  planId: string;
  decision: 'approve' | 'request_changes' | 'reject';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  findings: ReviewFinding[];
  suggestedChanges: string[];
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

// === Project Types ===

export interface Project {
  id: string;
  name: string;
  path: string;
  pathExists?: boolean;
  setupStatus?: ProjectSetupStatus;
  setupPath?: string;
  setupError?: string | null;
  gitRemote: string | null;
  githubRepoId: string | null;
  githubRepoFullName: string | null;
  starterIssueNumber: number | null;
  starterIssueCreatedAt: string | null;
  /**
   * Optional override for the Kanban `board` quick-link. GitHub Projects v2
   * live under a user/org (`/users/<name>/projects/<n>` or `/orgs/<name>/projects/<n>`)
   * and can span multiple repos, so we can't derive this from `gitRemote` alone.
   * When null, the Kanban header hides the `board` quick-link.
   */
  githubProjectUrl: string | null;
  /**
   * Per-project mapping from ShipCode macro columns to GH Projects v2 Status
   * option names. Auto-detected when `githubProjectUrl` is set. When null,
   * GH Status sync is disabled for this project.
   */
  githubStatusMapping: GhStatusMapping | null;
  plannerModelOverride: AgentType | null;
  reviewerModelOverride: AgentType | null;
  executorModelOverride: AgentType | null;
  verifierModelOverride: AgentType | null;
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
  pipelineSpeedProfileOverride?: PipelineSpeedProfile | null;
  prdQualityGate?: boolean | null;
  discordRouting: ProjectNotificationRoutingMode;
  discordWebhookUrlOverride: string | null;
  telegramRouting: ProjectNotificationRoutingMode;
  telegramChatIdOverride: string | null;
  defaultBranch: string;
  pinned: boolean;
  archived: boolean;
  hidden: boolean;
  notifyGithubUser: string | null;
  createdAt: string;
  updatedAt: string;
}

// === Automation Types ===

export type AutomationLastStatus = 'running' | 'completed' | 'failed';

export interface Automation {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  cronExpr: string;
  enabled: boolean;
  executorProvider: AgentType | null;
  executorModelId: string | null;
  executorReasoningEffort: ReasoningEffort | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: AutomationLastStatus | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationInput {
  projectId: string;
  name: string;
  prompt: string;
  cronExpr: string;
  enabled?: boolean;
  executorProvider?: AgentType | null;
  executorModelId?: string | null;
  executorReasoningEffort?: ReasoningEffort | null;
}

export interface UpdateAutomationInput {
  name?: string;
  prompt?: string;
  cronExpr?: string;
  enabled?: boolean;
  executorProvider?: AgentType | null;
  executorModelId?: string | null;
  executorReasoningEffort?: ReasoningEffort | null;
}

// === Thread Types ===

export const PIPELINE_PHASE = {
  idle: 'idle',
  planning: 'planning',
  clarifying: 'clarifying',
  reviewing: 'reviewing',
  revising: 'revising',
  approval: 'approval',
  executing: 'executing',
  testing: 'testing',
  verifying: 'verifying',
  shipping: 'shipping',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
} as const;

export type PipelinePhase = (typeof PIPELINE_PHASE)[keyof typeof PIPELINE_PHASE];

export type ThreadStatus = PipelinePhase;
export const THREAD_KIND = {
  pipeline: 'pipeline',
  instant: 'instant',
} as const;

export type ThreadKind = (typeof THREAD_KIND)[keyof typeof THREAD_KIND];
export type InstantFixScope = 'user' | 'project' | 'custom';
export type ProviderRunMode = 'programmatic' | 'interactive';

export interface AgentRunModeSettings {
  claude: {
    issueTerminal: 'interactive';
    execute: ProviderRunMode;
    terminalFix: ProviderRunMode;
    instant: ProviderRunMode;
  };
  codex: {
    issueTerminal: 'interactive';
    execute: ProviderRunMode;
    terminalFix: ProviderRunMode;
    instant: ProviderRunMode;
  };
}

export interface Thread {
  id: string;
  projectId: string;
  currentRunId?: string | null;
  kind: ThreadKind;
  title: string;
  prompt: string;
  status: ThreadStatus;
  worktreeBranch: string | null;
  worktreePath: string | null;
  plannerModel: string;
  reviewerModel: string;
  verifierModel: string;
  executorModel: string;
  reviewRound: number;
  clarificationRound: number;
  clarificationRequest: ClarificationRequest | null;
  clarificationAnswers: ClarificationAnswer[];
  answeredClarification: AnsweredClarification | null;
  verificationStatus: string | null;
  verificationRetries: number;
  autonomous: boolean;
  baseBranch: string | null;
  forkPointSha: string | null;
  githubIssueNumber: number | null;
  githubPrNumber: number | null;
  githubRepo: string | null;
  automationId: string | null;
  lastError: string | null;
  failurePhase: string | null;
  failureCount: number;
  pausedPhase: PipelinePhase | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Tier 3 telemetry: what openrouter/auto (or claude/codex) actually
  // served each phase. For non-openrouter runs these just hold 'claude'
  // or 'codex'. Null until the phase runs.
  plannerResolvedModel: string | null;
  reviewerResolvedModel: string | null;
  revisorResolvedModel: string | null;
  executorResolvedModel: string | null;
  verifierResolvedModel: string | null;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalCostUsd: number;
  doneAt: string | null;
  archivedAt?: string | null;
}

export type PromptTelemetryPhase = 'plan' | 'review' | 'revision' | 'verify' | 'execute';

export interface PromptTelemetryMaterialSummary {
  count: number;
  labels: string[];
  kinds: string[];
}

export interface PromptTelemetryRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  phase: PromptTelemetryPhase;
  invocationId: string;
  attempt: number | null;
  provider: string | null;
  model: string | null;
  promptCharacters: number;
  promptBytes: number;
  promptLines: number;
  selectedMaterials: PromptTelemetryMaterialSummary | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  createdAt: string;
}

export interface PromptTelemetryInsert {
  threadId: string;
  runId?: string | null;
  phase: PromptTelemetryPhase;
  invocationId: string;
  attempt?: number | null;
  provider?: string | null;
  model?: string | null;
  promptCharacters: number;
  promptBytes: number;
  promptLines: number;
  selectedMaterials?: PromptTelemetryMaterialSummary | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
}

// === Pipeline run + step log ===
//
// A durable pipeline run is the execution-management primitive that ties the
// existing phase log, step log, conversations, telemetry, and issue ownership
// together. Threads are user-facing history; runs are individual attempts.

export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'interrupted';

export interface PipelineRunRecord {
  id: string;
  threadId: string;
  projectId: string | null;
  source: string;
  triggerDetail: string | null;
  status: PipelineRunStatus;
  currentPhase: PipelinePhase | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  errorKind: string | null;
  context: Record<string, unknown> | null;
  retryOfRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunInsert {
  threadId: string;
  projectId?: string | null;
  source: string;
  triggerDetail?: string | null;
  currentPhase?: PipelinePhase | null;
  context?: Record<string, unknown> | null;
  retryOfRunId?: string | null;
}

export interface PipelineRunFinishUpdate {
  status: Exclude<PipelineRunStatus, 'queued' | 'running'>;
  currentPhase?: PipelinePhase | null;
  errorMessage?: string | null;
  errorKind?: string | null;
  context?: Record<string, unknown> | null;
}

export interface PipelineRunTimelineEntry {
  run: PipelineRunRecord;
  isCurrent: boolean;
  retryDepth: number;
  phaseTimeline: PipelinePhaseLogRecord[];
  steps: PipelineStepRecord[];
  terminalEvents: TerminalEventRecord[];
}

export type PipelineWakeRequestStatus =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type PipelineWakeRequestKind = 'automation' | 'pipeline' | 'execution' | 'maintenance';

export interface PipelineWakeRequestRecord {
  id: string;
  kind: PipelineWakeRequestKind;
  source: string;
  reason: string;
  targetType: string;
  targetId: string;
  projectId: string | null;
  threadId: string | null;
  runId: string | null;
  idempotencyKey: string | null;
  status: PipelineWakeRequestStatus;
  scheduledAt: string;
  claimedAt: string | null;
  claimedBy: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  coalescedCount: number;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineWakeRequestInsert {
  kind: PipelineWakeRequestKind;
  source: string;
  reason: string;
  targetType: string;
  targetId: string;
  projectId?: string | null;
  threadId?: string | null;
  runId?: string | null;
  idempotencyKey?: string | null;
  scheduledAt?: string | null;
  payload?: Record<string, unknown> | null;
}

// === Pipeline step log ===
//
// A row per provider invocation captures the lifecycle envelope around a
// single phase attempt: who ran it (provider+model), when it started/ended,
// what the outcome was (status + error kind + message), and what it cost.
// Designed to be the join key correlating `pipeline:phase`, `terminal:event`,
// `pipeline:model-resolved`, and `prompt_telemetry` rows for a given attempt.

export type PipelineStepStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'clarification_requested';

export type PipelineStepPhase = PromptTelemetryPhase;

export interface PipelineStepRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  phase: PipelineStepPhase;
  attempt: number;
  provider: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  status: PipelineStepStatus;
  errorKind: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface PipelineStepInsert {
  threadId: string;
  runId?: string | null;
  phase: PipelineStepPhase;
  attempt: number;
  provider?: string | null;
  requestedModel?: string | null;
}

export interface PipelineStepCompletionUpdate {
  status: Exclude<PipelineStepStatus, 'started'>;
  resolvedModel?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  /** Links this step to its conversation prompt/response pair. */
  conversationId?: string | null;
}

// === Pipeline analytics ===

export type PipelinePhaseTerminalStatus = PipelinePhase | PipelineStepStatus | 'unknown';

export interface PipelinePhaseLogRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  phase: PipelinePhase;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  terminalStatus: PipelinePhaseTerminalStatus | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PipelinePhaseLogInsert {
  threadId: string;
  runId?: string | null;
  phase: PipelinePhase;
  startedAt?: string;
  metadata?: Record<string, unknown> | null;
}

export type SkillResolutionSource = 'project' | 'global' | 'bundled' | 'fallback' | 'unknown';

export interface SkillResolutionLogRecord {
  id: string;
  threadId: string;
  providerPhase: PromptTelemetryPhase;
  skillKey: string;
  source: SkillResolutionSource;
  baseVersion: string | null;
  fallbackUsed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface SkillResolutionLogInsert {
  threadId: string;
  providerPhase: PromptTelemetryPhase;
  skillKey: string;
  source: SkillResolutionSource;
  baseVersion?: string | null;
  fallbackUsed?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface PipelineTimeToPrSummary {
  sampleSize: number;
  medianMs: number | null;
  p75Ms: number | null;
  p95Ms: number | null;
}

export interface PipelinePhaseDurationSummary {
  phase: PipelinePhase;
  runCount: number;
  averageMs: number;
  medianMs: number;
  p75Ms: number;
  p95Ms: number;
}

export interface PipelineTokensByPhase {
  phase: PromptTelemetryPhase;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  attemptCount: number;
}

export interface PipelinePromptByPhase {
  phase: PromptTelemetryPhase;
  promptCount: number;
  averageCharacters: number;
  averageBytes: number;
  averageLines: number;
  materialCount: number;
  materialKinds: string[];
}

export interface PipelineSlowRunSummary {
  threadId: string;
  title: string;
  projectName: string | null;
  githubPrNumber: number | null;
  durationMs: number;
  completedAt: string | null;
  bottleneckPhase: PipelinePhase | null;
  bottleneckDurationMs: number | null;
}

export interface PipelineSkillFallbackSummary {
  totalResolutions: number;
  fallbackCount: number;
  fallbackRate: number;
  parseFailureRate: number;
  retryRate: number;
  downstreamSuccessRate: number;
  score: number;
}

export interface PipelineAnalyticsOverview {
  timeToPr: PipelineTimeToPrSummary;
  averagePhaseDurations: PipelinePhaseDurationSummary[];
  slowestRecentRuns: PipelineSlowRunSummary[];
  tokensByPhase: PipelineTokensByPhase[];
  promptByPhase: PipelinePromptByPhase[];
  skillFallback: PipelineSkillFallbackSummary;
}

export interface PipelineThreadAnalytics {
  threadId: string;
  phaseTimeline: PipelinePhaseLogRecord[];
  providerAttempts: PipelineStepRecord[];
  promptTelemetry: PromptTelemetryRecord[];
  skillResolutions: SkillResolutionLogRecord[];
  tokensByPhase: PipelineTokensByPhase[];
  promptByPhase: PipelinePromptByPhase[];
  bottleneckPhase: PipelinePhase | null;
  bottleneckDurationMs: number | null;
  totalDurationMs: number | null;
  skillFallback: PipelineSkillFallbackSummary;
}

// === Terminal Types ===

export interface ClarificationChoice {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface ClarificationQuestion {
  id: string;
  title: string;
  prompt: string;
  description: string | null;
  choices: ClarificationChoice[];
  allowFreeform: boolean;
  freeformPlaceholder: string | null;
}

export interface ClarificationRequest {
  id: string;
  threadId: string;
  phase: 'plan' | 'revision';
  summary: string;
  questions: ClarificationQuestion[];
}

export interface ClarificationAnswer {
  questionId: string;
  selectedChoiceId: string | null;
  freeformText: string | null;
}

export interface AnsweredClarification {
  request: ClarificationRequest;
  answers: ClarificationAnswer[];
}

export type CanonicalTerminalEvent =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | {
      kind: 'tool_start';
      name: string;
      summary: string;
      command?: string;
      filePath?: string;
      pattern?: string;
    }
  | {
      kind: 'tool_end';
      name: string;
      durationMs?: number;
      exitCode?: number;
      outputSummary?: string;
    }
  | { kind: 'turn_start'; turn: number }
  | {
      kind: 'turn_end';
      turn: number;
      tokensUsed?: { prompt: number; completion: number };
      costUsd?: number;
    }
  | { kind: 'lifecycle'; message: string }
  | { kind: 'raw'; content: string }
  | { kind: 'error'; message: string }
  | { kind: 'action'; label: string; action: 'open-issue-detail' }
  | {
      kind: 'clarification_requested';
      summary: string;
      questionCount: number;
    }
  | {
      kind: 'clarification_answered';
      questionCount: number;
    }
  | {
      kind: 'done';
      totalTokens?: { prompt: number; completion: number };
      totalCostUsd?: number;
    };

export interface TerminalEventRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  event: CanonicalTerminalEvent;
  createdAt: string;
}

export type PipelineCheckpointPhase = 'executing' | 'verifying' | 'shipping';

export interface PipelineCheckpoint {
  id: string;
  threadId: string;
  projectId: string | null;
  phase: PipelineCheckpointPhase;
  reason: string;
  label: string;
  branch: string | null;
  commitSha: string;
  createdAt: string;
}

// === Pipeline Types ===

export type AgentType = 'claude' | 'codex' | 'gemini' | 'cursor' | 'gh' | 'openrouter' | 'shell';

/**
 * The subset of AgentType that can drive a pipeline phase. Excludes
 * 'gh' which is a data-plane CLI, not an LLM executor.
 *
 * Single source of truth for every executor-model type annotation in
 * the monorepo (DB row types, IPC payloads, UI Select values, pipeline
 * context, etc). Keep this in sync with the `executor_model` SQLite
 * column contents.
 *
 * We use a string literal union rather than a TS enum because:
 *  - Enums compile to runtime objects (bundle weight in a published
 *    CLI package). String literals are zero-cost at runtime.
 *  - SQLite stores strings; no enum ⇄ ordinal round-trip needed.
 *  - GitHub label values are already strings (`shipcode:agent:claude`, etc).
 */
export type ExecutorModel = 'claude' | 'codex' | 'gemini' | 'cursor' | 'openrouter';
export type TriageModel = Exclude<ExecutorModel, 'gemini' | 'cursor'>;
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type GeneratorCli = 'claude' | 'codex';
export type PhaseCliProvider = Extract<ExecutorModel, 'claude' | 'codex' | 'gemini' | 'cursor'>;
export type ContextGeneratorCli = GeneratorCli;
export type RevisionCount = 0 | 1 | 2 | 3 | 4 | 5;
export type PipelineSpeedProfile = 'smart_fast' | 'thorough';

export type AgentState = 'starting' | 'running' | 'idle' | 'errored' | 'exited';

export interface AgentProcess {
  id: string;
  type: AgentType;
  state: AgentState;
  cwd: string;
  exitCode: number | null;
}

// === Plan DB Record ===

export type PlanStatus =
  | 'draft'
  | 'pending_review'
  | 'approval'
  | 'approved'
  | 'rejected'
  | 'superseded';

export interface PlanRecord {
  id: string;
  threadId: string;
  version: number;
  rawOutput: string;
  structured: ShipCodePlan | null;
  status: PlanStatus;
  createdAt: string;
}

// === Review DB Record ===

export interface ReviewRecord {
  id: string;
  planId: string;
  decision: PlanReview['decision'];
  confidence: PlanReview['confidence'];
  rawOutput: string;
  structured: PlanReview | null;
  createdAt: string;
}

// === Activity Heatmap Types ===

export type HeatmapMetric = 'costUsd' | 'tokens' | 'runs' | 'prsOpened';
export type HeatmapRange = 30 | 90 | 365;
export type HeatmapScope = 'global' | 'project' | 'thread';

export interface HeatmapDayRecord {
  /** ISO date `YYYY-MM-DD` (UTC). */
  date: string;
  costUsd: number;
  tokens: number;
  runs: number;
  prsOpened: number;
}

export interface HeatmapQueryArgs {
  scope: HeatmapScope;
  rangeDays: HeatmapRange;
  projectId?: string;
  threadId?: string;
}

// === Code Browse Types ===

export type CodeEntryType = 'file' | 'dir';

export interface CodeTreeEntry {
  name: string;
  relativePath: string;
  type: CodeEntryType;
  sizeBytes: number | null;
  isModified: boolean;
}

export interface CodeFileContent {
  relativePath: string;
  content: string;
  isBinary: boolean;
  sizeBytes: number;
  truncated: boolean;
}

// === Diff Types ===

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

// === Git Types ===

export interface GitState {
  branch: string;
  commitHash: string;
  isDirty: boolean;
  untrackedCount: number;
  stagedCount: number;
  modifiedCount: number;
  aheadCount: number;
  behindCount: number;
  compareRef: string | null;
  preCommitHookPath: string | null;
}

export type GitWorktreeKind = 'main' | 'shipcode';

export interface GitWorktreeSummary {
  id: string;
  kind: GitWorktreeKind;
  path: string;
  branch: string;
  commitHash: string;
  isDirty: boolean;
  untrackedCount: number;
  stagedCount: number;
  modifiedCount: number;
  aheadCount: number;
  behindCount: number;
  compareRef: string | null;
  preCommitHookPath: string | null;
  threadId: string | null;
  issueNumber: number | null;
  title: string | null;
  status: ThreadStatus | null;
}

export interface GitVisualizerData {
  project: Project;
  branches: string[];
  worktrees: GitWorktreeSummary[];
}

// === Settings ===

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  fontStyle: 'dm-sans' | 'system' | 'serif';
  fontSize: 12 | 13 | 14 | 15;
  /**
   * User consent for crash/error reporting.
   * null = undecided; true = allowed; false = declined.
   */
  telemetryEnabled: boolean | null;
  defaultWorktreeEnabled: boolean;
  terminalScrollback: number;
  agentRunModes: AgentRunModeSettings;
  localPreview: LocalPreviewSettings;
  projectOpenTarget: ProjectOpenTarget;
  terminalOpenTarget: TerminalOpenTarget;
  plannerModel: AgentType;
  reviewerModel: AgentType;
  verifierModel: AgentType;
  executorModel: AgentType;
  triageModel: TriageModel;
  triageModelId: string | null;
  triageReasoningEffort: ReasoningEffort;
  triageAutoApplyThreshold: number;
  prdRewriteCli: GeneratorCli;
  prdRewriteClaudeModel: string | null;
  prdRewriteCodexModel: string | null;
  prdRewriteReasoningEffort: ReasoningEffort;
  githubPollingEnabled: boolean;
  githubPollingIntervalMs: number;
  githubBotUsername: string;
  /** Priority filter for kanban auto-run. Empty array = all priorities eligible. */
  autoRunPriorities: Array<'p0' | 'p1' | 'p2' | 'p3'>;
  /** Max issues to start per auto-run click. 0 = unlimited (all eligible). */
  autoRunMaxTasks: number;
  onboardingVersion: number;
  // Sidebar project ordering preference (pinned projects always float to top first)
  projectSortOrder: 'alpha' | 'recent' | 'added';
  // null = default (~/.shipcode/worktrees), '' = project-local legacy, else absolute or ~-prefixed
  worktreeRoot: string | null;
  // null = default (~/), else absolute or ~-prefixed path for the Add Project explorer start dir
  addProjectStartsIn: string | null;
  // Branch naming format for issue worktrees. Tokens: {id} = issue number, {slug} = slugified title.
  // Default: 'ship/{id}-{slug}'. Non-issue threads use 'shipcode/{slug}'.
  worktreeBranchFormat: string;
  // Default review→revise cycles before falling through to execute/approval.
  // 0 = skip review/revise entirely for the fastest path.
  revisionCount: RevisionCount;
  // Controls task-graph decomposition. smart_fast preserves final tests/verifier
  // while skipping redundant per-node gates for contained low-risk work.
  pipelineSpeedProfile: PipelineSpeedProfile;
  // When true, pipeline pauses at approval after review loop for human sign-off.
  // When false (default), it proceeds directly to execution.
  requireApproval: boolean;
  // Per-phase reasoning effort. Applied as:
  //   Claude: mapped to a supported thinking-token budget
  //   Codex:  mapped to supported low|medium|high levels
  //   OpenRouter: passed through as reasoning: { effort }
  plannerReasoningEffort: ReasoningEffort;
  reviewerReasoningEffort: ReasoningEffort;
  executorReasoningEffort: ReasoningEffort;
  verifierReasoningEffort: ReasoningEffort;
  // Notifications
  notificationsEnabled: boolean;
  notificationOsEnabled: boolean;
  notificationBadgeEnabled: boolean;
  notificationSoundEnabled: boolean;
  notificationEvents: NotificationEventToggles;
  discordEnabled: boolean;
  discordWebhookUrl: string | null;
  discordLastDeliveryStatus: IntegrationDeliveryStatus | null;
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramDefaultChatId: string | null;
  telegramLastDeliveryStatus: IntegrationDeliveryStatus | null;
  chatNotificationEvents: ChatNotificationEventToggles;
  // OpenRouter integration (Tier 1+). Presence of OPENROUTER_API_KEY enables
  // provider readiness. Individual phase models are optional overrides; when
  // null, the resolver falls back to the default paid/free selections below.
  openrouterPlannerModel: string | null;
  openrouterReviewerModel: string | null;
  openrouterVerifierModel: string | null;
  openrouterExecutorModel: string | null;
  openrouterDefaultPaidModel: string;
  openrouterDefaultFreeModel: string;
  openrouterExplicitFallback: string;
  testCommand: string | null;
  testingContext: string | null;
  /** Max concurrent pipeline runs. New starts queue when limit is reached. */
  maxConcurrentPipelines: number;
  /** Max concurrent pipelines per project in execution phases (executing/testing/verifying/shipping).
   *  Approved pipelines wait in approval until a project execution slot opens. */
  maxConcurrentExecutions: number;
  /** Max concurrent CPU-heavy local command phases across all projects. */
  maxConcurrentCpuTasks: number;
  /** Pause new CPU-heavy local command phases when host CPU is at or above this percentage. */
  cpuThrottleThresholdPercent: number;
  /** Default per-shell-command timeout for repo setup commands (ms). RepoSetupContract.shellCommandTimeoutMs overrides per-project. */
  shellCommandTimeoutMs: number;
  /** Default number of terminal panes when opening the Instant view. */
  instantDefaultPanes: 1 | 2 | 4;
  /** Persisted log level for the electron-log file transport. Console stays at 'info'. */
  devLogLevel: 'error' | 'warn' | 'info' | 'debug';
  /** Desktop update channel. Only master is published today; stable/nightly are reserved. */
  updateTrack: UpdateTrack;
  // Auto-commit (Git tab "Auto-commit" button)
  autoCommitEnabled: boolean;
  autoCommitProvider: ExecutorModel;
  autoCommitModel: string;
  autoCommitMode: 'split' | 'single';
  // Branch / worktree cleanup criteria (Git tab "Cleanup" button)
  cleanupCriteria: CleanupCriteria;
}

export interface LocalPreviewSettings {
  enabled: boolean;
  hostMode: 'localhost-subdomain';
  httpPort: number;
}

export type TelemetryDisabledReason =
  | 'pending-consent'
  | 'disabled-by-user'
  | 'disabled-by-env'
  | 'missing-dsn'
  | null;

export interface TelemetryStatus {
  enabled: boolean;
  initialized: boolean;
  envDisabled: boolean;
  dsnConfigured: boolean;
  pendingConsent: boolean;
  disabledReason: TelemetryDisabledReason;
}

export interface CleanupCriteria {
  worktreeMergedPr: boolean;
  worktreeClosedPr: boolean;
  localBranchMerged: boolean;
  localBranchNoRemote: boolean;
  remoteBranchMerged: boolean;
  worktreeNoPrCleanTree: boolean;
}

export type CleanupItem =
  | {
      id: string;
      kind: 'worktree-merged-pr';
      worktreePath: string;
      branch: string;
      prNumber: number;
      prUrl: string;
      dirty: boolean;
      aheadCount: number;
      behindCount: number;
      compareRef: string | null;
    }
  | {
      id: string;
      kind: 'worktree-closed-pr';
      worktreePath: string;
      branch: string;
      prNumber: number;
      prUrl: string;
      dirty: boolean;
      aheadCount: number;
      behindCount: number;
      compareRef: string | null;
    }
  | {
      id: string;
      kind: 'worktree-no-pr-clean';
      worktreePath: string;
      branch: string;
      dirty: boolean;
      aheadCount: number;
      behindCount: number;
      compareRef: string | null;
    }
  | {
      id: string;
      kind: 'worktree-artifacts';
      worktreePath: string;
      branch: string;
      artifactPaths: string[];
    }
  | {
      id: string;
      kind: 'local-branch-merged';
      branch: string;
      lastCommitDate: string;
      aheadCount: number;
      behindCount: number;
      compareRef: string | null;
      remoteBranch: string | null;
      prNumber: number | null;
    }
  | {
      id: string;
      kind: 'local-branch-no-remote';
      branch: string;
      lastCommitDate: string;
      aheadCount?: number;
      behindCount?: number;
      compareRef?: string | null;
    }
  | {
      id: string;
      kind: 'remote-branch-merged';
      branch: string;
      remote: string;
      lastCommitDate: string;
      aheadCount: number;
      behindCount: number;
      compareRef: string | null;
      prNumber: number | null;
    };

export interface AutoCommitResult {
  commits: Array<{ sha: string; message: string }>;
  fallbackUsed: boolean;
  preCommitHookPath?: string | null;
  partialFailure?: {
    groupIndex: number;
    error: string;
    hookFailure?: boolean;
    hookPath?: string | null;
  };
}

export interface CleanupAnalyzeResult {
  items: CleanupItem[];
  protectedBranches: string[];
  baseRef: string | null;
}

export interface CleanupApplyResult {
  succeeded: string[];
  failed: Array<{ itemId: string; error: string }>;
}

export interface DeveloperInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  osRelease: string;
  logDirectoryPath: string;
  eventLogPath: string;
  cliVersions: {
    claude: string | null;
    codex: string | null;
    git: string | null;
    gh: string | null;
  };
}

export interface ProcessResourceTask {
  processId: string;
  type: AgentType;
  state: AgentState;
  pid: number | null;
  childPids: number[];
  threadId: string | null;
  projectId: string | null;
  projectName: string | null;
  threadTitle: string | null;
  phase: PipelinePhase | null;
  cwd: string;
  command: string;
  cpuPercent: number;
  memoryBytes: number;
  startedAt: number;
  lastEventAt: number;
  highCpu: boolean;
}

export interface SystemResourceSnapshot {
  capturedAt: string;
  cpuPercent: number | null;
  cpuCoreCount: number;
  highCpu: boolean;
  tasks: ProcessResourceTask[];
}

export type UpdateTrack = 'master' | 'stable' | 'nightly';

export type UpdateCheckState = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';

export interface UpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseTag: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  state: UpdateCheckState;
  error: string | null;
}

export interface RepoSetupEnvFile {
  source: string;
  target?: string;
  required: boolean;
}

export interface RuntimeQaServerConfig {
  command: string;
  readinessUrl: string;
  startupTimeoutMs: number;
  portEnvVar: string;
}

export interface RuntimeQaConfig {
  server?: RuntimeQaServerConfig;
  testCommands: string[];
  discoverAgentTests: boolean;
}

export interface RepoSetupContract {
  version: 1;
  setupCommands: string[];
  verifyCommands: string[];
  envFiles: RepoSetupEnvFile[];
  setupBeforeVerify: boolean;
  testingContext: string | null;
  runtimeQa?: RuntimeQaConfig;
  /** Per-project override for shell command timeout (ms). Falls back to AppSettings.shellCommandTimeoutMs when nullish. */
  shellCommandTimeoutMs?: number | null;
}

export type ProjectSetupStatus = 'configured' | 'missing' | 'invalid';

export type DetectedProjectKind =
  | 'bun'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'xcode'
  | 'swiftpm'
  | 'rust'
  | 'go'
  | 'python'
  | 'ruby'
  | 'java'
  | 'dotnet'
  | 'php'
  | 'unknown';

export interface DetectedProjectProfile {
  kind: DetectedProjectKind;
  label: string;
  recommended: boolean;
  evidence: string[];
  suggestedContract: RepoSetupContract;
}

export interface ProjectSetupInspection {
  status: ProjectSetupStatus;
  path: string;
  contract: RepoSetupContract | null;
  error: string | null;
}

export interface ProjectSetupDraft {
  inspection: ProjectSetupInspection;
  profiles: DetectedProjectProfile[];
  suggestedContract: RepoSetupContract;
}

export interface OnboardingRepo {
  id: string;
  name: string;
  private: boolean;
}

export interface NotificationEventToggles {
  approval: boolean;
  failed: boolean;
  completed: boolean;
  verificationExhausted: boolean;
  ciBlocked: boolean;
}

export type ChatNotificationEventToggles = NotificationEventToggles;

export type ProjectNotificationRoutingMode = 'inherit' | 'disabled' | 'custom';

export interface ProjectNotificationRouting {
  discordRouting: ProjectNotificationRoutingMode;
  discordWebhookUrlOverride: string | null;
  telegramRouting: ProjectNotificationRoutingMode;
  telegramChatIdOverride: string | null;
}

export interface IntegrationDeliveryStatus {
  provider: 'discord' | 'telegram';
  destination: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

// === CLI Health ===

export interface CliHealth {
  available: boolean;
  version: string | null;
  path: string | null;
  error: string | null;
  authenticated: boolean;
}

export type CliModelCapabilitySource = 'catalog' | 'fallback' | 'unavailable';

export interface CliModelCapabilityOption {
  value: string;
  label: string;
  description: string | null;
  defaultReasoningEffort: ReasoningEffort | null;
  supportedReasoningEfforts: ReasoningEffort[];
}

export interface CliModelCapabilities {
  provider: PhaseCliProvider;
  source: CliModelCapabilitySource;
  models: CliModelCapabilityOption[];
  error: string | null;
  checkedAt: string;
}

export type CliProviderUsageProvider = 'claude' | 'codex';
export type CliProviderUsageState = 'unknown' | 'ready' | 'warning' | 'blocked';
export type CliProviderUsageWindowKey = 'session' | 'weekly' | 'model';

export interface CliProviderUsageWindow {
  key: CliProviderUsageWindowKey;
  label: string;
  usedPercent: number | null;
  leftPercent: number | null;
  resetsAt: string | null;
  resetDescription: string | null;
}

export interface CliProviderUsageStatus {
  provider: CliProviderUsageProvider;
  available: boolean;
  stale: boolean;
  state: CliProviderUsageState;
  source: string | null;
  version: string | null;
  accountEmail: string | null;
  loginMethod: string | null;
  updatedAt: string | null;
  checkedAt: string;
  message: string | null;
  creditsRemaining: number | null;
  windows: CliProviderUsageWindow[];
}

export interface CliProviderUsageMap {
  claude: CliProviderUsageStatus;
  codex: CliProviderUsageStatus;
}

export interface WritingPrdsSkillInfo {
  projectId: string;
  projectPath: string;
  absolutePath: string;
  exists: boolean;
  usingFallback: boolean;
  openTargetPath: string;
}

export type ProjectOpenTarget = 'cursor' | 'finder' | 'terminal' | 'ghostty' | 'vscode' | 't3code';
export type TerminalOpenTarget = Extract<ProjectOpenTarget, 'terminal' | 'ghostty'>;

export interface DesktopAppHealth {
  key: ProjectOpenTarget;
  label: string;
  available: boolean;
  path: string | null;
  error: string | null;
}

export interface DesktopAppHealthMap {
  cursor: DesktopAppHealth;
  finder: DesktopAppHealth;
  terminal: DesktopAppHealth;
  ghostty: DesktopAppHealth;
  vscode: DesktopAppHealth;
  t3code: DesktopAppHealth;
}

export interface SystemHealth {
  claude: CliHealth;
  codex: CliHealth;
  gemini?: CliHealth;
  cursor?: CliHealth;
  git: CliHealth;
  gh: CliHealth;
}

export type OpenRouterAuthStatus = 'missing_key' | 'valid' | 'invalid_key' | 'unreachable';

export type OpenRouterModelStatus = 'not_configured' | 'valid' | 'invalid' | 'unverified';

export interface OpenRouterModelCheck {
  key: string;
  label: string;
  modelId: string | null;
  status: OpenRouterModelStatus;
  message: string | null;
}

export interface OpenRouterHealth {
  enabled: boolean;
  keyPresent: boolean;
  authStatus: OpenRouterAuthStatus;
  message: string | null;
  label: string | null;
  modelChecks: OpenRouterModelCheck[];
}

export type ChatIntegrationValidationStatus = 'missing' | 'valid' | 'invalid';

export interface DiscordIntegrationSettings {
  enabled: boolean;
  webhookUrl: string | null;
  lastDeliveryStatus: IntegrationDeliveryStatus | null;
}

export interface TelegramIntegrationSettings {
  enabled: boolean;
  botToken: string | null;
  defaultChatId: string | null;
  lastDeliveryStatus: IntegrationDeliveryStatus | null;
}

export interface ChatIntegrationHealth {
  enabled: boolean;
  configured: boolean;
  destinationConfigured: boolean;
  validationStatus: ChatIntegrationValidationStatus;
  message: string | null;
  lastDeliveryStatus: IntegrationDeliveryStatus | null;
}

export interface IntegrationStatus {
  system: SystemHealth;
  modelCapabilities?: Record<PhaseCliProvider, CliModelCapabilities>;
  ghAuth: GhAuthStatus;
  openrouter: OpenRouterHealth;
  discord: ChatIntegrationHealth;
  telegram: ChatIntegrationHealth;
  desktopApps: DesktopAppHealthMap;
}

export interface OpenRouterModelValidation {
  modelId: string;
  status: 'valid' | 'invalid' | 'unverified';
  message: string | null;
}

// === GitHub Types ===

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
  state: 'open' | 'closed';
  url: string;
  updatedAt?: string | null;
  author?: { login: string };
}

export interface GitHubPrCheckSummary {
  name: string;
  status: 'pending' | 'success' | 'failed';
  conclusion: string | null;
  detailsUrl: string | null;
  workflowName: string | null;
}

export interface GitHubPrReviewCommentSummary {
  author: string | null;
  body: string;
  url: string;
  createdAt: string;
  path: string | null;
  line: number | null;
}

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type PullRequestReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED';
export type PullRequestListFilter = 'open' | 'closed' | 'merged' | 'all';

export interface PullRequestListItem {
  number: number;
  title: string;
  author: string | null;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: PullRequestState;
  reviewDecision: PullRequestReviewDecision | null;
  url: string;
  labels: string[];
  updatedAt: string;
  linkedIssueNumbers: number[];
}

export interface PullRequestDetail {
  number: number;
  url: string;
  title: string;
  body: string | null;
  author: string | null;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: PullRequestState;
  reviewDecision: PullRequestReviewDecision | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  linkedIssueNumbers: number[];
  ciBlocked: boolean;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
}

export interface PullRequestDetailResponse extends PullRequestDetail {
  linkedThreadId: string | null;
  diffs: DiffRecord[];
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
  executionRunId?: string | null;
  executionLockedAt?: string | null;
  executionLockOwner?: string | null;
  lastPhaseUpdate: string | null;
  pipelineStartedAt?: string | null;
  lastStatusLabel: string | null;
  // Nullable per-issue phase provider overrides. Null means "inherit from
  // project/global settings".
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
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
  prLastSyncAt: string | null;
  updatedAt?: string | null;
  fetchedAt: string;
  // GitHub Projects v2 single-select Priority field, synced via the configured
  // project board. priorityRank is the normalized bucket; priorityRaw is the
  // verbatim option name (so unknown options like "Icebox" round-trip).
  // priorityFetchedAt distinguishes "we know it has no priority" (timestamp +
  // null rank/raw) from "we never asked" (all null).
  priorityRank: 'p0' | 'p1' | 'p2' | 'p3' | null;
  priorityRaw: string | null;
  priorityFetchedAt: string | null;
  issueType?: string | null;
  rulesAppliedAt?: string | null;
  triageFailureReason?: string | null;
  // Quick mode: synthetic local-only task with negative sentinel `issueNumber`
  // and no real GitHub issue. Pipeline runs against raw text; PR/comment paths
  // must skip these rows.
  isQuickMode: boolean;
  // Renderer-only optimistic state for a GitHub issue that has been accepted
  // by the UI but has not been confirmed by GitHub yet.
  syncState?: 'creating';
}

export interface GitHubIssueTriageSummary {
  issueNumber: number;
  confidence: number;
  applied: boolean;
  suggestedLabels: string[];
  suggestedAgent: ExecutorModel | null;
  shouldStart: boolean;
  needsHuman: boolean;
  rationale: string;
}

export interface GitHubIssueTriageResult {
  provider: ExecutorModel;
  modelId: string | null;
  resolvedModel: string | null;
  consideredCount: number;
  appliedCount: number;
  skippedCount: number;
  threshold: number;
  issues: GitHubIssueTriageSummary[];
}

export const ISSUE_PIPELINE_STATUS = {
  todo: 'todo',
  queued: 'queued',
  planning: PIPELINE_PHASE.planning,
  clarifying: PIPELINE_PHASE.clarifying,
  reviewing: PIPELINE_PHASE.reviewing,
  revising: PIPELINE_PHASE.revising,
  approval: PIPELINE_PHASE.approval,
  executing: PIPELINE_PHASE.executing,
  testing: PIPELINE_PHASE.testing,
  verifying: PIPELINE_PHASE.verifying,
  shipping: PIPELINE_PHASE.shipping,
  paused: PIPELINE_PHASE.paused,
  completed: PIPELINE_PHASE.completed,
  closed: 'closed',
  deferred: 'deferred',
  failed: PIPELINE_PHASE.failed,
} as const;

export type IssuePipelineStatus =
  (typeof ISSUE_PIPELINE_STATUS)[keyof typeof ISSUE_PIPELINE_STATUS];

// === GitHub Projects v2 Status Sync Types ===

/** ShipCode macro columns that map to GH Projects v2 Status field options. */
export type GhMacroColumn = 'todo' | 'in_progress' | 'human_review' | 'deferred' | 'done';

/** A single GitHub Projects v2 Status field option with its display color. */
export interface GhStatusOption {
  name: string;
  /** GitHub color enum: GRAY | BLUE | GREEN | YELLOW | ORANGE | RED | PINK | PURPLE */
  color: string | null;
}

/**
 * Per-project mapping from ShipCode macro columns to GitHub Projects v2
 * Status field option names (with optional color). Stored as JSON in
 * `projects.github_status_mapping`.
 */
export interface GhStatusMapping {
  todo: GhStatusOption | null;
  inProgress: GhStatusOption | null;
  humanReview: GhStatusOption | null;
  deferred?: GhStatusOption | null;
  done: GhStatusOption | null;
}

// === GitHub Project Readiness Types ===

export type ProjectReadinessItemStatus = 'ready' | 'missing' | 'warning' | 'error';

export type ProjectReadinessItemKind = 'labels' | 'github-project' | 'project-field' | 'issue-type';

export interface ProjectReadinessItem {
  key: string;
  kind: ProjectReadinessItemKind;
  label: string;
  required: boolean;
  status: ProjectReadinessItemStatus;
  message: string;
  present?: string[];
  missing?: string[];
}

export interface ProjectReadinessLabelSync {
  created: string[];
  alreadyPresent: string[];
  failed: Array<{ name: string; error: string }>;
}

export interface ProjectReadinessReport {
  ok: boolean;
  checkedAt: string;
  projectUrl: string | null;
  labelSync: ProjectReadinessLabelSync;
  labelNames: string[];
  statusMapping: GhStatusMapping | null;
  items: ProjectReadinessItem[];
}

// === Verification Types ===

export interface VerificationResult {
  threadId: string;
  planId: string;
  result: 'passed' | 'failed';
  summary: string;
  criteriaResults: CriteriaCheck[];
  issues: VerificationIssue[];
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

export interface VerificationRecord {
  id: string;
  threadId: string;
  planId: string;
  rawOutput: string;
  structured: VerificationResult | null;
  result: 'passed' | 'failed';
  retryCount: number;
  createdAt: string;
}

// === Project Failure Ledger ===

export type ProjectFailureStatus = 'in_progress' | 'resolved';

export interface ProjectFailureRecord {
  id: string;
  projectId: string;
  baseBranch: string | null;
  fingerprint: string;
  status: ProjectFailureStatus;
  ownerThreadId: string | null;
  firstSeenThreadId: string | null;
  seenThreadIds: string[];
  command: string;
  summary: string;
  outputExcerpt: string;
  implicatedFiles: string[];
  resolvedByThreadId: string | null;
  resolvedCommitSha: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// === Agent Conversation Log ===

export interface AgentConversationRecord {
  id: string;
  threadId: string;
  phase: string;
  round: number;
  speaker: string;
  role: 'prompt' | 'response';
  parentId: string | null;
  provider: string | null;
  model: string | null;
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  createdAt: string;
}

// === Feature QA State ===

/**
 * Machine-readable QA contract for a feature. Declares what to test,
 * where, and what data is needed so agents can run focused verification
 * instead of a full-suite crawl.
 */
export interface FeatureQaState {
  /** Stable feature identifier (e.g. issue number or slug). */
  featureId: string;
  /** Route or surface scope the feature operates on. */
  routes: string[];
  /** Named user flows that must work for the feature to ship. */
  criticalFlows: FeatureQaCriticalFlow[];
  /** Expected UI states the feature should be able to reach. */
  expectedStates: string[];
  /** Test data or seeding assumptions required for QA. */
  testDataAssumptions: string[];
  /** Whether stable selectors exist for critical controls. */
  selectorReadiness: 'ready' | 'partial' | 'missing';
  /** Machine-checkable visual/layout assertions that must pass in a browser. */
  visualAssertions?: FeatureQaVisualAssertion[];
  /** Artifact capture policy for generated browser QA. */
  evidencePolicy?: FeatureQaEvidencePolicy;
}

export interface FeatureQaCriticalFlow {
  /** Human-readable name of the flow (e.g. "login with valid credentials"). */
  name: string;
  /** Ordered steps to exercise the flow. */
  steps: string[];
  /** What constitutes success for this flow. */
  successCriteria: string;
}

export type FeatureQaVisualAssertionKind =
  | 'top-left-of-container'
  | 'top-right-of-container'
  | 'bottom-left-of-container'
  | 'bottom-right-of-container'
  | 'visible'
  | 'not-overlapping'
  | 'above'
  | 'below'
  | 'left-of'
  | 'right-of';

export interface FeatureQaVisualAssertion {
  name: string;
  route: string;
  targetSelector: string;
  assertion: FeatureQaVisualAssertionKind;
  containerSelector?: string;
  referenceSelector?: string;
  tolerancePx?: number;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface FeatureQaEvidencePolicy {
  screenshot: 'always' | 'on-failure';
  trace: 'always' | 'on-failure' | 'on-retry';
  video: 'always' | 'on-failure' | 'on-retry' | 'off';
}

/**
 * Result of a focused QA run for a single feature.
 */
export interface FeatureQaResult {
  featureId: string;
  status: 'passed' | 'failed' | 'partial';
  /** Per-flow results. */
  flowResults: FeatureQaFlowResult[];
  /** Concise human-readable summary. */
  summary: string;
  /** Optional paths to screenshots, traces, or logs. */
  evidencePaths?: string[];
  runAt: string;
}

export interface FeatureQaFlowResult {
  flowName: string;
  passed: boolean;
  /** Failure reason if not passed. */
  failureReason?: string;
  /** Optional paths to screenshots, traces, videos, or JSON evidence for this flow. */
  evidencePaths?: string[];
  /** Machine assertion results collected for this flow. */
  assertions?: FeatureQaAssertionResult[];
}

export interface FeatureQaAssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  evidencePath?: string;
}

export interface PipelineModelResolvedEvent {
  threadId: string;
  phase: 'plan' | 'review' | 'revision' | 'execute' | 'verify';
  requestedModel: string;
  resolvedModel: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
}

// === Onboarding Types ===

export type OnboardingStep =
  | 'ai-auth'
  | 'github-project'
  | 'model-preferences'
  | 'label-mapping'
  | 'complete';

export interface GhAuthStatus {
  installed: boolean;
  authenticated: boolean;
  username: string | null;
  version: string | null;
  error: string | null;
  /**
   * Whether the gh token includes a scope sufficient to read AND write
   * GitHub Projects v2 (`project`). Required by `gh project item-add`,
   * which ShipCode uses to attach issues to a project board.
   *
   * `null` when authentication failed or the scope list could not be
   * parsed (e.g. older gh versions). UI should treat `null` as unknown
   * and not show an error.
   */
  hasProjectScope: boolean | null;
}

// === Mission Control Dashboard ===

export interface DashboardStats {
  agentsRunning: number;
  runningByPhase: Partial<Record<PipelinePhase, number>>;
  agentsRunningByProject: Record<string, number>;
  pendingApprovalsByProject: Record<string, number>;
  tasksInProgress: number;
  tasksOpen: number;
  tasksBlocked: number;
  pendingApprovals: number;
  staleApprovals: number;
  shippedLast7d: number;
  failedLast7d: number;
}

export interface DashboardOverview {
  stats: DashboardStats;
  running: ActivePipelineSummary[];
  activity: ActivityEntry[];
  activityTotal: number;
  recent: RecentTask[];
  recentTotal: number;
}

export interface ThreadPanelData {
  project: Project | null;
  settings: AppSettings;
  threads: Thread[];
  latestPlanStatusByThreadId: Record<string, PlanStatus | null>;
  branches: string[];
}

export interface GitHubIssueComment {
  id: number;
  author: string | null;
  body: string;
  createdAt: string;
  url: string;
}

export interface ProjectCostSummary {
  projectId: string;
  projectName: string;
  totalCostUsd: number;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  taskCount: number;
}

export interface CostSummary {
  totalCostAllTime: number;
  totalCost7d: number;
  totalTokensAllTime: number;
  totalTokens7d: number;
  avgCostPerTask: number;
  avgTokensPerTask: number;
  byProject: ProjectCostSummary[];
}

export interface CostTaskSummary {
  threadId: string;
  projectId: string;
  title: string;
  projectName: string;
  phase: PipelinePhase;
  provider: ExecutorModel;
  model: string | null;
  costUsd: number;
  tokensPrompt: number;
  tokensCompletion: number;
  updatedAt: string;
}

export type ActivityKind =
  | 'phase_change'
  | 'plan_parsed'
  | 'review_parsed'
  | 'verification_parsed'
  | 'pipeline_started'
  | 'pipeline_cancelled'
  | 'pipeline_failed'
  | 'pipeline_completed'
  | 'pipeline_verification_exhausted'
  | 'notification_fired';

export type ActivityActor = 'claude' | 'codex' | 'system' | 'human';

export interface ActivityEntry {
  id: string;
  threadId: string | null;
  projectId: string | null;
  kind: ActivityKind;
  actor: ActivityActor;
  title: string;
  subtitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface RecentTask {
  threadId: string;
  projectId: string;
  projectName: string;
  title: string;
  phase: PipelinePhase;
  githubIssueNumber: number | null;
  updatedAt: string;
}

export interface ActivePipelineSummary {
  threadId: string;
  projectId: string;
  projectName: string;
  threadTitle: string;
  phase: PipelinePhase;
  approvedAwaitingExecution?: boolean;
  startedAt: number;
  activeProcessId: string | null;
  githubIssueNumber: number | null;
  modelProvider: ExecutorModel | null;
  model: string | null;
  reasoningEffort: string | null;
}

// === Notifications ===

export type NotificationKind =
  | 'approval'
  | 'failed'
  | 'completed'
  | 'verification_exhausted'
  | 'ci_blocked';

export interface NotificationRecord {
  id: string;
  threadId: string;
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  dismissedAt: string | null;
}
