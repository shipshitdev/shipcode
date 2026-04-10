import type { AppSettings } from './types'

export const DEFAULT_STATUS_LABEL_MAPPINGS: Record<string, string> = {
  todo: '',
  queued: 'status:queued',
  planning: 'status:in-progress',
  reviewing: 'status:in-progress',
  revising: 'status:in-progress',
  executing: 'status:in-progress',
  verifying: 'status:in-progress',
  shipping: 'status:in-progress',
  completed: 'status:done',
  failed: 'status:failed',
}

export const DEFAULT_NOTIFICATION_EVENTS = {
  awaitingApproval: true,
  failed: true,
  completed: true,
  verificationExhausted: true,
} as const

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultWorktreeEnabled: true,
  terminalScrollback: 10_000,
  plannerModel: 'claude',
  reviewerModel: 'codex',
  verifierModel: 'claude',
  githubPollingEnabled: false,
  githubPollingIntervalMs: 30_000,
  githubBotUsername: '',
  autoPickupEnabled: false,
  statusLabelMappings: DEFAULT_STATUS_LABEL_MAPPINGS as Record<string, string>,
  onboardingVersion: 0,
  worktreeRoot: null,
  notificationsEnabled: true,
  notificationOsEnabled: true,
  notificationBadgeEnabled: true,
  notificationSoundEnabled: true,
  notificationEvents: { ...DEFAULT_NOTIFICATION_EVENTS },
  // OpenRouter — all disabled/null by default so existing deployments are unaffected.
  openrouterEnabled: false,
  openrouterPlannerModel: null,
  openrouterReviewerModel: null,
  openrouterVerifierModel: null,
  openrouterExecutorModel: null,
  openrouterDefaultPaidModel: 'openrouter/auto',
  openrouterDefaultFreeModel: 'openrouter/free',
  openrouterExplicitFallback: 'qwen/qwen3.6-plus',
}

export const CURRENT_ONBOARDING_VERSION = 1

export const PIPELINE_MAX_RETRIES = 3

export const HEARTBEAT_TIMEOUT_MS = 120_000

export const FILE_WATCH_DEBOUNCE_MS = 300

export const IGNORED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.shipcode',
]

export const ERROR_PATTERNS = [
  { pattern: /ENOENT/, type: 'binary_missing' as const },
  { pattern: /rate limit/i, type: 'rate_limited' as const },
  { pattern: /authentication.*failed/i, type: 'auth_failed' as const },
  { pattern: /API key/i, type: 'api_key_issue' as const },
  { pattern: /SIGTERM|SIGKILL/, type: 'process_killed' as const },
  { pattern: /out of memory/i, type: 'oom' as const },
  { pattern: /timeout/i, type: 'timeout' as const },
] as const

export type ErrorType = (typeof ERROR_PATTERNS)[number]['type']

export const WORKTREE_DIR = '.shipcode/worktrees'

export const DEFAULT_WORKTREE_ROOT = '~/.shipcode/worktrees'

export const PLAN_FENCE_TAG = 'shipcode-plan'
export const REVIEW_FENCE_TAG = 'shipcode-review'
export const VERIFICATION_FENCE_TAG = 'shipcode-verification'
export const MAX_REVIEW_ROUNDS = 2
export const MAX_VERIFICATION_RETRIES = 1
export const GITHUB_POLL_INTERVAL_MS = 30_000
export const STALE_LEASE_THRESHOLD_MS = 30 * 60 * 1000
export const ORPHAN_CLAIM_THRESHOLD_MS = 5 * 60 * 1000
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000

// === OpenRouter ===
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'
export const OPENROUTER_BACKOFF_BASE_MS = 500
export const OPENROUTER_BACKOFF_MAX_MS = 30_000
export const OPENROUTER_MAX_HTTP_RETRIES = 5
export const OPENROUTER_REQUEST_TIMEOUT_MS = 120_000

// === Tier 2: Tool-call execute harness ===

/** Hard cap on agent-loop iterations per execute run. */
export const MAX_TOOL_CALL_ITERATIONS = 30

/** Same (toolName, argsHash) firing this many times in a row = pathological loop, fail out. */
export const MAX_DUPLICATE_TOOL_CALLS = 3

/** Total tokens (prompt + completion) across one execute run. Circuit breaker, not $ budget. */
export const MAX_EXECUTE_TOTAL_TOKENS = 500_000

/** Upper bound on a single read tool's return size. */
export const MAX_READ_BYTES = 500_000

/** Wall-clock timeout for a single shell-readonly tool invocation. */
export const SHELL_EXEC_TIMEOUT_MS = 30_000

/**
 * Commands the read-only shell tool is allowed to execute. Intentionally
 * excludes any shell interpreter (bash, zsh, sh) to prevent command
 * chaining; the harness always invokes execFile with shell:false.
 *
 * Subcommand restrictions (e.g. `git push` is forbidden) are enforced
 * at the tool level, not here.
 */
export const SHELL_ALLOWLIST: readonly string[] = [
  // Source control (read-only subcommands only — enforced in shell-readonly.ts)
  'git',
  // Runtimes (version checks, script execution, etc.)
  'node', 'bun', 'deno',
  // Package managers (list, info, exec, run scripts — read-mostly)
  'npm', 'pnpm', 'yarn',
  // TypeScript + build tools
  'tsc', 'bunx',
  // Search / navigation
  'rg', 'grep', 'find', 'ls', 'tree',
  // File inspection
  'cat', 'head', 'tail', 'wc', 'file', 'stat',
  // Scripting runtimes
  'python', 'python3',
]

/**
 * Git subcommands the shell-readonly tool refuses outright. These mutate
 * refs or the working tree in ways the tool-call harness should not be
 * able to trigger — file edits go through the dedicated Edit/Write tools.
 */
export const GIT_BLOCKED_SUBCOMMANDS: readonly string[] = [
  'push', 'reset', 'checkout', 'clean', 'rm', 'mv',
  'rebase', 'merge', 'cherry-pick', 'revert',
  'commit', 'add', 'stash', 'tag', 'branch',
  'config', 'remote', 'fetch', 'pull',
  'worktree',
]
