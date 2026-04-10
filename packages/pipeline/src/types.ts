import type { ProcessManager, ProviderRegistry } from '@shipcode/agents'
import type { ThreadQueries, PlanQueries, ReviewQueries, VerificationQueries, GitHubIssueQueries, SettingsQueries } from '@shipcode/db'
import type { AgentType, ShipCodePlan, PipelinePhase, PlanReview, VerificationResult } from '@shipcode/shared'

// Models that can drive a pipeline phase. Excludes 'gh' which is a
// data-plane CLI, not an LLM executor.
export type PipelineExecutorModel = Exclude<AgentType, 'gh'>

// Typed event contract -- both desktop and CLI adapters must handle these
export type PipelineEvent =
  | { type: 'pipeline:phase'; threadId: string; phase: PipelinePhase }
  | { type: 'pipeline:verification-exhausted'; threadId: string; retries: number }
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
  executorModel: PipelineExecutorModel
  /** Optional per-run model slug override (e.g. 'openrouter/auto'). */
  executorModelOverride: string | null
  baseBranch: string
  forkPointSha: string
  activeProcessId: string | null
  cancelled: boolean
  verifiedSha: string | null
  startedAt: number
  /**
   * Per-run AbortController. Providers honor `abort.signal` to cancel
   * in-flight work (subprocess kill OR HTTP abort). cancel(threadId)
   * calls abort() in addition to killing any active process.
   */
  abort: AbortController
}

export interface ActivePipelineSummary {
  threadId: string
  projectPath: string
  phase: PipelinePhase
  startedAt: number
  activeProcessId: string | null
}

export interface PipelineDeps {
  emitter: PipelineEmitter
  processManager: ProcessManager
  threads: ThreadQueries
  plans: PlanQueries
  reviews: ReviewQueries
  verifications: VerificationQueries
  githubIssues: GitHubIssueQueries
  settings: SettingsQueries
  providers: ProviderRegistry
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
    executorModel: PipelineExecutorModel,
    executorModelOverride?: string | null,
  ) => Promise<void>
  initializeContext: (
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ) => PipelineContext
  cancel: (threadId: string) => void
  getContext: (threadId: string) => PipelineContext | undefined
  listActive: () => ActivePipelineSummary[]
}
