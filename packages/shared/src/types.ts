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
   * When null, the Kanban header falls back to `${repoBase}/projects` (the
   * repo's Projects tab that lists linked boards).
   */
  githubProjectUrl: string | null;
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

// === Thread Types ===

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
export type ThreadKind = 'pipeline' | 'instant';
export type InstantFixScope = 'user' | 'project' | 'custom';

export interface Thread {
  id: string;
  projectId: string;
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
  verificationStatus: string | null;
  verificationRetries: number;
  autonomous: boolean;
  baseBranch: string | null;
  forkPointSha: string | null;
  githubIssueNumber: number | null;
  githubPrNumber: number | null;
  githubRepo: string | null;
  lastError: string | null;
  failurePhase: string | null;
  failureCount: number;
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

export type CanonicalTerminalEvent =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool_start'; name: string; summary: string }
  | { kind: 'tool_end'; name: string; durationMs?: number; exitCode?: number }
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
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ContextGeneratorCli = 'claude' | 'codex';
export type RevisionCount = 0 | 1 | 2 | 3 | 4 | 5;

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
  | 'awaiting_approval'
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
  fontStyle: 'dm-sans' | 'system' | 'serif';
  fontSize: 12 | 13 | 14 | 15;
  defaultWorktreeEnabled: boolean;
  terminalScrollback: number;
  projectOpenTarget: ProjectOpenTarget;
  plannerModel: AgentType;
  reviewerModel: AgentType;
  verifierModel: AgentType;
  executorModel: AgentType;
  prdRewriteCli: ContextGeneratorCli;
  prdRewriteClaudeModel: string | null;
  prdRewriteCodexModel: string | null;
  prdRewriteReasoningEffort: ReasoningEffort;
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
  // Default review→revise cycles before falling through to execute/awaiting_approval.
  // 0 = skip review/revise entirely for the fastest path.
  revisionCount: RevisionCount;
  // When true, pipeline pauses at awaiting_approval after review loop for human sign-off.
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
  /** Max concurrent pipelines in execution phases (executing/testing/verifying/shipping).
   *  Approved pipelines wait in awaiting_approval until an execution slot opens. */
  maxConcurrentExecutions: number;
  /** Default number of terminal panes when opening the Instant view. */
  instantDefaultPanes: 1 | 2 | 4;
  /** Persisted log level for the electron-log file transport. Console stays at 'info'. */
  devLogLevel: 'error' | 'warn' | 'info' | 'debug';
}

export interface DeveloperInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  osRelease: string;
  cliVersions: {
    claude: string | null;
    codex: string | null;
    git: string | null;
    gh: string | null;
  };
}

export interface RepoSetupEnvFile {
  source: string;
  target?: string;
  required: boolean;
}

export interface RepoSetupContract {
  version: 1;
  setupCommands: string[];
  verifyCommands: string[];
  envFiles: RepoSetupEnvFile[];
  setupBeforeVerify: boolean;
  testingContext: string | null;
}

export type ProjectSetupStatus = 'configured' | 'missing' | 'invalid';

export type DetectedProjectKind = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'xcode' | 'swiftpm' | 'unknown';

export interface DetectedProjectProfile {
  kind: DetectedProjectKind;
  label: string;
  recommended: boolean;
  evidence: string[];
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
  awaitingApproval: boolean;
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

export type ProjectOpenTarget = 'cursor' | 'finder' | 'terminal' | 'ghostty' | 'vscode';

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
}

export interface SystemHealth {
  claude: CliHealth;
  codex: CliHealth;
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
  lastPhaseUpdate: string | null;
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
  linkedPrNumber: number | null;
  linkedPrUrl: string | null;
  linkedPrIsDraft: boolean;
  ciBlocked: boolean;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
  prLastSyncAt: string | null;
  fetchedAt: string;
}

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

export interface PipelineModelResolvedEvent {
  threadId: string;
  phase: 'plan' | 'review' | 'revision' | 'execute' | 'verify';
  requestedModel: string;
  resolvedModel: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
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
  startedAt: number;
  activeProcessId: string | null;
  githubIssueNumber: number | null;
  modelProvider: ExecutorModel | null;
  model: string | null;
  reasoningEffort: string | null;
}

// === Notifications ===

export type NotificationKind =
  | 'awaiting_approval'
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
