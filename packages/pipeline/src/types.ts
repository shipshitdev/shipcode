import type { ProcessManager } from '@shipcode/agents'
import type { ThreadQueries, PlanQueries, ReviewQueries, VerificationQueries, GitHubIssueQueries } from '@shipcode/db'
import type { ShipCodePlan, PipelinePhase, PlanReview, VerificationResult } from '@shipcode/shared'

// Typed event contract -- both desktop and CLI adapters must handle these
export type PipelineEvent =
  | { type: 'pipeline:phase'; threadId: string; phase: PipelinePhase }
  | { type: 'plan:parsed'; threadId: string; plan: ShipCodePlan }
  | { type: 'review:parsed'; threadId: string; review: PlanReview }
  | { type: 'verification:parsed'; threadId: string; verification: VerificationResult }

export interface PipelineEmitter {
  emit(event: PipelineEvent): void
}

export interface PipelineContext {
  threadId: string
  projectPath: string
  worktreePath: string | null
  retryCount: number
  autonomous: boolean
  reviewRound: number
  verificationRetries: number
  githubIssueNumber: number | null
  githubRepo: string | null
  executorModel: 'claude' | 'codex'
  baseBranch: string
  forkPointSha: string
  activeProcessId: string | null
  cancelled: boolean
  verifiedSha: string | null
}

export interface PipelineDeps {
  emitter: PipelineEmitter
  processManager: ProcessManager
  threads: ThreadQueries
  plans: PlanQueries
  reviews: ReviewQueries
  verifications: VerificationQueries
  githubIssues: GitHubIssueQueries
}
