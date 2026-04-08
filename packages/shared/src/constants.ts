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

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultWorktreeEnabled: true,
  terminalScrollback: 10_000,
  plannerModel: 'claude',
  reviewerModel: 'codex',
  githubPollingEnabled: false,
  githubPollingIntervalMs: 30_000,
  githubBotUsername: '',
  autoPickupEnabled: false,
  statusLabelMappings: DEFAULT_STATUS_LABEL_MAPPINGS as Record<string, string>,
  onboardingVersion: 0,
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

export const PLAN_FENCE_TAG = 'shipcode-plan'
export const REVIEW_FENCE_TAG = 'shipcode-review'
export const VERIFICATION_FENCE_TAG = 'shipcode-verification'
export const MAX_REVIEW_ROUNDS = 2
export const MAX_VERIFICATION_RETRIES = 1
export const GITHUB_POLL_INTERVAL_MS = 30_000
export const STALE_LEASE_THRESHOLD_MS = 30 * 60 * 1000
export const ORPHAN_CLAIM_THRESHOLD_MS = 5 * 60 * 1000
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
