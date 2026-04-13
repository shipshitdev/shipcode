// === Context File Types ===

export interface ContextFileInfo {
  name: string;
  exists: boolean;
  size?: number;
  updatedAt?: string;
}

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
  gitRemote: string | null;
  /**
   * Optional override for the Kanban `board` quick-link. GitHub Projects v2
   * live under a user/org (`/users/<name>/projects/<n>` or `/orgs/<name>/projects/<n>`)
   * and can span multiple repos, so we can't derive this from `gitRemote` alone.
   * When null, the Kanban header falls back to `${repoBase}/projects` (the
   * repo's Projects tab that lists linked boards).
   */
  githubProjectUrl: string | null;
  defaultBranch: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// === Thread Types ===

export type ThreadStatus =
  | 'idle'
  | 'planning'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'testing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed';

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: ThreadStatus;
  worktreeBranch: string | null;
  worktreePath: string | null;
  plannerModel: string;
  reviewerModel: string;
  executorModel: string;
  reviewRound: number;
  verificationStatus: string | null;
  verificationRetries: number;
  autonomous: boolean;
  baseBranch: string | null;
  forkPointSha: string | null;
  githubIssueNumber: number | null;
  githubPrNumber: number | null;
  githubRepo: string | null;
  lastError: string | null;
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
}

// === Pipeline Types ===

export type PipelinePhase =
  | 'idle'
  | 'planning'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'testing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed';

export type AgentType = 'claude' | 'codex' | 'gh' | 'openrouter';

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
 *  - GitHub label values are already strings (`agent:claude`, etc).
 */
export type ExecutorModel = 'claude' | 'codex' | 'openrouter';

export type AgentState = 'starting' | 'running' | 'idle' | 'errored' | 'exited';

export interface AgentProcess {
  id: string;
  type: AgentType;
  state: AgentState;
  cwd: string;
  exitCode: number | null;
}

// === Plan DB Record ===

export type PlanStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'superseded';

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
}

// === Settings ===

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  defaultWorktreeEnabled: boolean;
  terminalScrollback: number;
  plannerModel: AgentType;
  reviewerModel: AgentType;
  verifierModel: AgentType;
  executorModel: AgentType;
  githubPollingEnabled: boolean;
  githubPollingIntervalMs: number;
  githubBotUsername: string;
  autoPickupEnabled: boolean;
  statusLabelMappings: StatusLabelMapping;
  onboardingVersion: number;
  // Sidebar project ordering preference (pinned projects always float to top first)
  projectSortOrder: 'alpha' | 'recent' | 'added';
  // null = default (~/.shipcode/worktrees), '' = project-local legacy, else absolute or ~-prefixed
  worktreeRoot: string | null;
  // Branch naming format for worktrees. Tokens: {id} = issue number, {slug} = slugified title.
  // Default: 'ship/{id}-{slug}'. Falls back to 'shipcode/{threadId}' for non-issue threads.
  worktreeBranchFormat: string;
  // Max turns the planner/verifier Claude CLI is allowed per run (--max-turns).
  // Does not apply to execute (no limit) or review (always 1, structural).
  plannerMaxTurns: number;
  // Max review→revise cycles before falling through to execute/awaiting_approval.
  maxReviewRounds: number;
  // When true, pipeline pauses at awaiting_approval after review loop for human sign-off.
  // When false (default), it proceeds directly to execution.
  requireApproval: boolean;
  // Per-phase reasoning effort. Applied as:
  //   Claude: --max-thinking-tokens (high=32000, medium=8000, low=omit)
  //   Codex:  -c model_reasoning_effort=<value> (v0.120.0+)
  //   OpenRouter: reasoning: { effort } in the chat request
  plannerReasoningEffort: 'low' | 'medium' | 'high';
  reviewerReasoningEffort: 'low' | 'medium' | 'high';
  executorReasoningEffort: 'low' | 'medium' | 'high';
  verifierReasoningEffort: 'low' | 'medium' | 'high';
  // Notifications
  notificationsEnabled: boolean;
  notificationOsEnabled: boolean;
  notificationBadgeEnabled: boolean;
  notificationSoundEnabled: boolean;
  notificationEvents: NotificationEventToggles;
  // OpenRouter integration (Tier 1+). All off by default; set openrouterEnabled=true
  // plus provide OPENROUTER_API_KEY in env to activate. Individual phase models are
  // optional overrides; when null, the resolver falls back to the tier defaults
  // (openrouterDefaultPaidModel / openrouterDefaultFreeModel).
  openrouterEnabled: boolean;
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
}

export interface NotificationEventToggles {
  awaitingApproval: boolean;
  failed: boolean;
  completed: boolean;
  verificationExhausted: boolean;
}

export interface StatusLabelMapping {
  [pipelineStatus: string]: string;
}

// === CLI Health ===

export interface CliHealth {
  available: boolean;
  version: string | null;
  path: string | null;
  error: string | null;
  authenticated: boolean;
}

export interface SystemHealth {
  claude: CliHealth;
  codex: CliHealth;
  git: CliHealth;
  gh: CliHealth;
}

// === File Change Events ===

export interface FileChange {
  path: string;
  type: 'add' | 'change' | 'unlink';
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
  // Per-issue executor choice. Widened to the full ExecutorModel union
  // in Tier 1 so issue-level selection can opt into the OpenRouter HTTP
  // provider the same way the `agent:openrouter/auto` GitHub label can
  // at queue time. The DB column is plain TEXT (v4 migration), so
  // writing this wider value is safe on existing rows.
  executorModel: ExecutorModel;
  fetchedAt: string;
}

export type IssuePipelineStatus =
  | 'todo'
  | 'queued'
  | 'planning'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'testing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed';

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

// === GitHub Status Labels ===

export type GitHubStatusLabel =
  | 'status:queued'
  | 'status:in-progress'
  | 'status:ready-for-review'
  | 'status:failed'
  | 'status:needs-human-review'
  | 'status:invalid-config';

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
  tasksInProgress: number;
  tasksOpen: number;
  tasksBlocked: number;
  pendingApprovals: number;
  staleApprovals: number;
  shippedLast7d: number;
  failedLast7d: number;
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
  recentByTask: Array<{
    threadId: string;
    projectId: string;
    title: string;
    projectName: string;
    phase: PipelinePhase;
    costUsd: number;
    tokensPrompt: number;
    tokensCompletion: number;
    updatedAt: string;
  }>;
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
  startedAt: number;
  activeProcessId: string | null;
}

// === Notifications ===

export type NotificationKind =
  | 'awaiting_approval'
  | 'failed'
  | 'completed'
  | 'verification_exhausted';

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
