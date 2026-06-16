import type {
  AgentState,
  AgentType,
  ExecutorModel,
  GeneratorCli,
  PipelineSpeedProfile,
  ReasoningEffort,
  RevisionCount,
  TriageModel,
} from './agents';
import type { AgentRunModeSettings, PipelinePhase } from './pipeline-core';

// === Settings ===

export type ProjectOpenTarget = 'cursor' | 'finder' | 'terminal' | 'ghostty' | 'vscode' | 't3code';
export type TerminalOpenTarget = Extract<ProjectOpenTarget, 'terminal' | 'ghostty'>;

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
  /**
   * When true, every programmatic (`claude -p`) phase is forced to the
   * interactive CLI regardless of per-phase run-mode settings. Escape hatch
   * for users who prefer Claude to always run on the interactive subscription
   * seat, or as a safety valve if Anthropic re-rations the Agent-SDK credit
   * pool (see the pool-exhaustion fallback in cli-provider / runtime).
   */
  forceInteractiveClaude: boolean;
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
