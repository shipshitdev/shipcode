// === Plan Types ===

export interface ShipCodePlan {
  id: string
  threadId: string
  version: number
  objective: string
  files: PlanFileChange[]
  steps: PlanStep[]
  acceptanceCriteria: string[]
  outOfScope: string[]
  estimatedComplexity: 'low' | 'medium' | 'high'
  dependencies: string[]
}

export interface PlanStep {
  order: number
  description: string
  files: string[]
  rationale: string
}

export interface PlanFileChange {
  path: string
  action: 'create' | 'modify' | 'delete' | 'rename'
  description: string
  fromPath?: string
}

// === Review Types ===

export interface PlanReview {
  planId: string
  decision: 'approve' | 'request_changes' | 'reject'
  confidence: 'high' | 'medium' | 'low'
  summary: string
  findings: ReviewFinding[]
  suggestedChanges: string[]
}

export interface ReviewFinding {
  id: string
  severity: 'critical' | 'major' | 'minor' | 'nit'
  category: 'correctness' | 'security' | 'performance' | 'design' | 'missing'
  filePath?: string
  stepOrder?: number
  description: string
  suggestion?: string
}

// === Project Types ===

export interface Project {
  id: string
  name: string
  path: string
  gitRemote: string | null
  defaultBranch: string
  createdAt: string
  updatedAt: string
}

// === Thread Types ===

export type ThreadStatus =
  | 'idle'
  | 'planning'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed'

export interface Thread {
  id: string
  projectId: string
  title: string
  prompt: string
  status: ThreadStatus
  worktreeBranch: string | null
  worktreePath: string | null
  plannerModel: string
  reviewerModel: string
  executorModel: string
  reviewRound: number
  verificationStatus: string | null
  verificationRetries: number
  autonomous: boolean
  baseBranch: string | null
  forkPointSha: string | null
  githubIssueNumber: number | null
  githubPrNumber: number | null
  githubRepo: string | null
  createdAt: string
  updatedAt: string
}

// === Pipeline Types ===

export type PipelinePhase =
  | 'idle'
  | 'planning'
  | 'reviewing'
  | 'revising'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed'

export type AgentType = 'claude' | 'codex' | 'gh'

export type AgentState = 'starting' | 'running' | 'idle' | 'errored' | 'exited'

export interface AgentProcess {
  id: string
  type: AgentType
  state: AgentState
  cwd: string
  exitCode: number | null
}

// === Plan DB Record ===

export type PlanStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'superseded'

export interface PlanRecord {
  id: string
  threadId: string
  version: number
  rawOutput: string
  structured: ShipCodePlan | null
  status: PlanStatus
  createdAt: string
}

// === Review DB Record ===

export interface ReviewRecord {
  id: string
  planId: string
  decision: PlanReview['decision']
  confidence: PlanReview['confidence']
  rawOutput: string
  structured: PlanReview | null
  createdAt: string
}

// === Diff Types ===

export interface DiffRecord {
  id: string
  threadId: string
  filePath: string
  action: 'create' | 'modify' | 'delete' | 'rename'
  diffContent: string | null
  beforeHash: string | null
  afterHash: string | null
  createdAt: string
}

// === Git Types ===

export interface GitState {
  branch: string
  commitHash: string
  isDirty: boolean
  untrackedCount: number
  stagedCount: number
  modifiedCount: number
}

// === Settings ===

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  defaultWorktreeEnabled: boolean
  terminalScrollback: number
  plannerModel: AgentType
  reviewerModel: AgentType
  githubPollingEnabled: boolean
  githubPollingIntervalMs: number
  githubBotUsername: string
  autoPickupEnabled: boolean
  statusLabelMappings: StatusLabelMapping
  onboardingVersion: number
}

export interface StatusLabelMapping {
  [pipelineStatus: string]: string
}

// === CLI Health ===

export interface CliHealth {
  available: boolean
  version: string | null
  path: string | null
  error: string | null
  authenticated: boolean
}

export interface SystemHealth {
  claude: CliHealth
  codex: CliHealth
  git: CliHealth
  gh: CliHealth
}

// === File Change Events ===

export interface FileChange {
  path: string
  type: 'add' | 'change' | 'unlink'
}

// === GitHub Types ===

export interface GitHubIssue {
  number: number
  title: string
  body: string | null
  labels: string[]
  assignee: string | null
  state: 'open' | 'closed'
  url: string
}

export interface GitHubIssueCacheRecord {
  id: string
  projectId: string
  issueNumber: number
  title: string
  body: string | null
  labels: string[]
  assignee: string | null
  state: string
  pipelineStatus: IssuePipelineStatus
  threadId: string | null
  claimedAt: string | null
  claimedBy: string | null
  lastPhaseUpdate: string | null
  lastStatusLabel: string | null
  fetchedAt: string
}

export type IssuePipelineStatus =
  | 'todo'
  | 'queued'
  | 'planning'
  | 'reviewing'
  | 'revising'
  | 'executing'
  | 'verifying'
  | 'shipping'
  | 'completed'
  | 'failed'

// === Verification Types ===

export interface VerificationResult {
  threadId: string
  planId: string
  result: 'passed' | 'failed'
  summary: string
  criteriaResults: CriteriaCheck[]
  issues: VerificationIssue[]
}

export interface CriteriaCheck {
  criterion: string
  passed: boolean
  evidence: string
}

export interface VerificationIssue {
  severity: 'blocker' | 'warning'
  description: string
  filePath?: string
}

export interface VerificationRecord {
  id: string
  threadId: string
  planId: string
  rawOutput: string
  structured: VerificationResult | null
  result: 'passed' | 'failed'
  retryCount: number
  createdAt: string
}

// === GitHub Status Labels ===

export type GitHubStatusLabel =
  | 'status:queued'
  | 'status:in-progress'
  | 'status:ready-for-review'
  | 'status:failed'
  | 'status:needs-human-review'
  | 'status:invalid-config'

// === Onboarding Types ===

export type OnboardingStep = 'ai-auth' | 'github-project' | 'model-preferences' | 'label-mapping' | 'complete'

export interface GhAuthStatus {
  installed: boolean
  authenticated: boolean
  username: string | null
  error: string | null
}
