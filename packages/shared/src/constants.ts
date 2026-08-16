import { DEFAULT_BRANCH_FORMAT } from './branch-name';
import { PINNED_MODEL_DEFAULTS } from './model-catalog';
import { type AppSettings, type ExecutorModel, PIPELINE_PHASE, type PipelinePhase } from './types';

export const HOMEBREW_INSTALL_COMMAND =
  'brew tap shipshitdev/tap && brew install --cask shipshitdev/tap/shipcode';
export const HOMEBREW_UPDATE_COMMAND =
  'brew tap shipshitdev/tap && brew install --cask --force shipshitdev/tap/shipcode';

export const DEFAULT_NOTIFICATION_EVENTS = {
  approval: true,
  failed: true,
  completed: true,
  verificationExhausted: true,
  ciBlocked: true,
} as const;

export const DEFAULT_CHAT_NOTIFICATION_EVENTS = {
  approval: true,
  failed: true,
  completed: false,
  verificationExhausted: true,
  ciBlocked: true,
} as const;

export const PIPELINE_EXECUTOR_PROVIDERS = [
  'claude',
  'codex',
  'gemini',
  'cursor',
  'grok',
  'openrouter',
] as const satisfies readonly ExecutorModel[];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  fontStyle: 'dm-sans',
  fontSize: 13,
  telemetryEnabled: null,
  launchAtLogin: false,
  defaultWorktreeEnabled: true,
  terminalScrollback: 10_000,
  // Programmatic (`claude -p` / `codex exec --json`) is the default for the
  // structured reasoning phases — Anthropic reverted the 2026 Agent-SDK billing
  // change, so `claude -p` draws from the subscription seat again. Structured
  // claude phases run with ALL tools disallowed (pure prompt→JSON), so they
  // carry no host risk. EXCEPTIONS, kept on the interactive CLI:
  //   - Claude execute/terminalFix/instant: programmatic claude there grants
  //     host Edit/Write/Bash with NO OS sandbox (see cli-provider execute guard),
  //     so they stay interactive regardless of this default.
  //   - terminalFix/instant for both providers default to interactive because
  //     they are watched terminal-pane surfaces, not headless automation.
  // Codex execute is programmatic by default: `codex exec --sandbox` is
  // OS-sandboxed, and codex is the default executor, so the out-of-box pipeline
  // runs fully programmatic.
  agentRunModes: {
    claude: {
      issueTerminal: 'interactive',
      plan: 'programmatic',
      review: 'programmatic',
      revision: 'programmatic',
      verify: 'programmatic',
      execute: 'interactive',
      terminalFix: 'interactive',
      instant: 'interactive',
    },
    codex: {
      issueTerminal: 'interactive',
      plan: 'programmatic',
      review: 'programmatic',
      revision: 'programmatic',
      verify: 'programmatic',
      execute: 'programmatic',
      terminalFix: 'interactive',
      instant: 'interactive',
    },
  },
  forceInteractiveClaude: false,
  // Programmatic claude execute runs only inside the srt OS sandbox. Enabled by
  // default so selecting programmatic claude execute is safe out of the box; the
  // run-mode default for claude execute stays interactive, so this only engages
  // when a user opts that phase into programmatic.
  claudeExecuteSandboxEnabled: true,
  claudeExecuteSandboxNetworkPolicy: 'anthropic-github',
  claudeExecuteSandboxExtraWritePaths: [],
  localPreview: {
    enabled: true,
    hostMode: 'localhost-subdomain',
    httpPort: 3750,
  },
  projectOpenTarget: 'cursor',
  terminalOpenTarget: 'terminal',
  plannerModel: 'codex',
  reviewerModel: 'codex',
  verifierModel: 'codex',
  executorModel: 'codex',
  triageModel: 'claude',
  triageModelId: PINNED_MODEL_DEFAULTS.claude.triage,
  triageReasoningEffort: 'minimal',
  triageAutoApplyThreshold: 0.85,
  prdRewriteCli: 'claude',
  prdRewriteClaudeModel: PINNED_MODEL_DEFAULTS.claude.prdRewrite,
  prdRewriteCodexModel: PINNED_MODEL_DEFAULTS.codex.prdRewrite,
  prdRewriteReasoningEffort: 'none',
  githubPollingEnabled: false,
  githubPollingIntervalMs: 30_000,
  githubBotUsername: '',
  autoRunPriorities: [],
  autoRunMaxTasks: 0,
  onboardingVersion: 0,
  projectSortOrder: 'recent',
  worktreeRoot: null,
  addProjectStartsIn: null,
  worktreeBranchFormat: DEFAULT_BRANCH_FORMAT,
  revisionCount: 0,
  pipelineSpeedProfile: 'smart_fast',
  requireApproval: false,
  postPlanCommentsEnabled: true,
  postFormalPrReviewEnabled: true,
  postPipelineTimelineEnabled: true,
  plannerReasoningEffort: 'low',
  reviewerReasoningEffort: 'high',
  executorReasoningEffort: 'high',
  verifierReasoningEffort: 'high',
  notificationsEnabled: true,
  notificationOsEnabled: true,
  notificationBadgeEnabled: true,
  notificationSoundEnabled: true,
  notificationEvents: { ...DEFAULT_NOTIFICATION_EVENTS },
  discordEnabled: false,
  discordWebhookUrl: null,
  discordLastDeliveryStatus: null,
  telegramEnabled: false,
  telegramBotToken: null,
  telegramDefaultChatId: null,
  telegramLastDeliveryStatus: null,
  chatNotificationEvents: { ...DEFAULT_CHAT_NOTIFICATION_EVENTS },
  // OpenRouter defaults. Provider readiness is inferred from OPENROUTER_API_KEY.
  openrouterPlannerModel: null,
  openrouterReviewerModel: null,
  openrouterVerifierModel: null,
  openrouterExecutorModel: null,
  openrouterDefaultPaidModel: PINNED_MODEL_DEFAULTS.openrouter.paid,
  openrouterDefaultFreeModel: PINNED_MODEL_DEFAULTS.openrouter.free,
  openrouterExplicitFallback: PINNED_MODEL_DEFAULTS.openrouter.explicitFallback,
  testCommand: null,
  testingContext: null,
  maxConcurrentPipelines: 3,
  maxConcurrentExecutions: 3,
  maxConcurrentCpuTasks: 1,
  cpuThrottleThresholdPercent: 85,
  shellCommandTimeoutMs: 10 * 60 * 1000,
  instantDefaultPanes: 1,
  devLogLevel: 'debug',
  updateTrack: 'master',
  autoCommitEnabled: true,
  autoCommitProvider: 'openrouter',
  autoCommitModel: 'openrouter/auto',
  autoCommitMode: 'split',
  cleanupCriteria: {
    worktreeMergedPr: true,
    worktreeClosedPr: true,
    localBranchMerged: true,
    localBranchNoRemote: true,
    remoteBranchMerged: true,
    worktreeNoPrCleanTree: false,
  },
};

export const CURRENT_ONBOARDING_VERSION = 2;

export const AGENT_RUNNING_PHASES: readonly PipelinePhase[] = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
] as const;

export const EXECUTION_PHASES = [
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
] as const;

export const PAUSABLE_PIPELINE_PHASES: readonly PipelinePhase[] = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
] as const;

export const PIPELINE_MAX_RETRIES = 3;

export const HEARTBEAT_TIMEOUT_MS = 120_000;

/**
 * Default stdout-silence threshold for ProcessManager.killStalled.
 * If an agent pty has not emitted a single chunk for this long, the
 * watchdog assumes the agent is hung and kills it. 5 minutes is long
 * enough for slow tool calls (codex sandbox, npm install) but short
 * enough to recover before the user gives up.
 */
export const PROCESS_STALL_TIMEOUT_MS = 300_000;

export const IGNORED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.shipcode',
];

export const ERROR_PATTERNS = [
  { pattern: /ENOENT/, type: 'binary_missing' as const },
  { pattern: /rate limit/i, type: 'rate_limited' as const },
  { pattern: /authentication.*failed/i, type: 'auth_failed' as const },
  { pattern: /API key/i, type: 'api_key_issue' as const },
  { pattern: /SIGTERM|SIGKILL/, type: 'process_killed' as const },
  { pattern: /out of memory/i, type: 'oom' as const },
  { pattern: /timeout/i, type: 'timeout' as const },
] as const;

export type ErrorType = (typeof ERROR_PATTERNS)[number]['type'];

export const REPO_SETUP_CONTRACT_FILE = '.shipcode/setup.json';

export const DEFAULT_WORKTREE_ROOT = '~/.shipcode/worktrees';

export const PLAN_FENCE_TAG = 'shipcode-plan';
export const CLARIFICATION_FENCE_TAG = 'shipcode-clarification';
export const REVIEW_FENCE_TAG = 'shipcode-review';
export const VERIFICATION_FENCE_TAG = 'shipcode-verification';
export const MAX_PIPELINE_RAW_OUTPUT_CHARS = 16_000;
export const MAX_REVIEW_ROUNDS = 5;
export const MAX_CLARIFICATION_ROUNDS = 2;
export const MAX_VERIFICATION_RETRIES = 1;
export const MAX_TEST_RETRIES = 3;
export const MAX_NODE_VERIFICATION_RETRIES = 2;
export const GITHUB_POLL_INTERVAL_MS = 30_000;
export const STALE_LEASE_THRESHOLD_MS = 30 * 60 * 1000;
export const ORPHAN_CLAIM_THRESHOLD_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

// === PRD Quality Gate ===

/**
 * Section headings that a PRD (GitHub issue body) should contain.
 * Used by the quality gate to warn or block before planning starts.
 * Matched case-insensitively against markdown headings (## or ###).
 */
export const REQUIRED_PRD_SECTIONS = [
  'Executive Summary',
  'Problem Statement',
  'Goals',
  'Non-Goals',
  'User Stories',
  'System Specification',
  'Functional Requirements',
  'Non-Functional Requirements',
  'Feature Phase Breakdown',
  'Success Criteria',
  'Out of Scope',
  'Dependencies',
  'Verification Plan',
  'Risks & Open Questions',
] as const;

// === OpenRouter ===
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
export const OPENROUTER_BACKOFF_BASE_MS = 500;
export const OPENROUTER_BACKOFF_MAX_MS = 30_000;
export const OPENROUTER_MAX_HTTP_RETRIES = 5;
export const OPENROUTER_REQUEST_TIMEOUT_MS = 120_000;

// === OpenRouter execute harness ===

/** Hard cap on agent-loop iterations per execute run. */
export const MAX_TOOL_CALL_ITERATIONS = 30;

/** Same (toolName, argsHash) firing this many times in a row = pathological loop, fail out. */
export const MAX_DUPLICATE_TOOL_CALLS = 3;

/** Total tokens (prompt + completion) across one execute run. Circuit breaker, not $ budget. */
export const MAX_EXECUTE_TOTAL_TOKENS = 500_000;

/** Upper bound on a single read tool's return size. */
export const MAX_READ_BYTES = 500_000;

/** Wall-clock timeout for a single shell-readonly tool invocation. */
export const SHELL_EXEC_TIMEOUT_MS = 30_000;

/**
 * Commands the read-only shell tool is allowed to execute.
 *
 * This is a STRICT read-only allowlist. The previous draft included
 * `node`, `bun`, `deno`, `python`, `python3`, `npm`, `pnpm`, `yarn`,
 * and the generic `git` entry — all of which let the model execute
 * arbitrary code (`node -e`, `python -c`, `npm run`, `git alias='!…'`)
 * and so broke the "read-only" contract. Those are gone.
 *
 * What's left is binaries that inspect filesystem/process state and
 * return it, without side effects on the worktree. `git` is handled
 * specially below (GIT_ALLOWED_SUBCOMMANDS is an allowlist, not
 * blocklist, so only non-mutating subcommands pass).
 *
 * The harness always invokes execFile with `shell: false`, so
 * metacharacters in args are literal (no chaining, no redirection,
 * no expansion). This is NOT a sandbox — it's a blunt allowlist.
 */
export const SHELL_ALLOWLIST: readonly string[] = [
  // Source control (subcommand-restricted via GIT_ALLOWED_SUBCOMMANDS)
  'git',
  // Navigation — pure read.
  // NOTE: `find` and `rg` are intentionally excluded. `find` has `-exec`;
  // `rg` has `--pre`, which can execute helper programs. Use the dedicated
  // grep tool instead of the generic shell wrapper for content search.
  // `find` is intentionally excluded — its `-exec`, `-execdir`,
  // `-delete`, `-fprint` primaries execute programs or write files,
  // bypassing shell:false and path-guard. Use `ls`, `tree`, or the grep tool.
  'ls',
  'tree',
] as const;

/**
 * Git subcommands the shell-readonly tool EXPLICITLY ALLOWS. This is an
 * allowlist, not a blocklist — anything else (including new subcommands
 * git adds in the future) is rejected by default. Much safer than the
 * previous blocklist approach, which would silently permit any new
 * mutating command Git added upstream.
 */
export const GIT_ALLOWED_SUBCOMMANDS: readonly string[] = [
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'rev-list',
  'ls-files',
  'ls-tree',
  'cat-file',
  'describe',
  'name-rev',
  'shortlog',
  'for-each-ref',
  'symbolic-ref',
  'grep',
] as const;

/**
 * Git global options that are always rejected before subcommand parsing.
 * These can redirect git's effective working directory, source arbitrary
 * config, or inject shell aliases (e.g. `-c alias.x='!rm -rf /'`).
 *
 * Use startsWith so the attached-argument forms `-C<path>`,
 * `--git-dir=<p>`, `--work-tree=<p>`, `--config-env=<k>=<v>` are caught
 * together with their spaced counterparts.
 */
export const GIT_BLOCKED_GLOBAL_OPTION_PREFIXES: readonly string[] = [
  '-C',
  '--git-dir',
  '--work-tree',
  '--exec-path',
  '--namespace',
  '--config-env',
  '--super-prefix',
] as const;
