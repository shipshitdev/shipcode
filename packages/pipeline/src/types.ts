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

export interface Pipeline {
  startPlanGeneration: (threadId: string, prompt: string, projectPath: string, worktreePath: string | null) => Promise<void>
  startReview: (threadId: string, plan: ShipCodePlan) => Promise<void>
  startRevision: (threadId: string, plan: ShipCodePlan, reviewFeedback: string) => Promise<void>
  startExecution: (threadId: string, plan: ShipCodePlan) => Promise<void>
  startVerification: (threadId: string) => Promise<void>
  startCommitAndPush: (threadId: string) => Promise<void>
  startShipping: (threadId: string) => Promise<void>
  startFromGitHubIssue: (
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: 'claude' | 'codex'
  ) => Promise<void>
  initializeContext: (
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ) => PipelineContext
  cancel: (threadId: string) => void
  getContext: (threadId: string) => PipelineContext | undefined
}
