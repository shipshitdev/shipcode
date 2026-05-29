import type {
  LoadedRepoSetupContract,
  PhasePromptTelemetry,
  ProcessManager,
  PromptMaterial,
  PromptMaterialSummary,
  ProviderRegistry,
  TerminalEvent,
} from '@shipcode/agents/source';
import type {
  AgentConversationQueries,
  CheckpointQueries,
  DiffQueries,
  FeatureQaResultQueries,
  GitHubIssueQueries,
  PhaseLogQueries,
  PipelineRunQueries,
  PipelineStepQueries,
  PlanQueries,
  ProjectQueries,
  PromptTelemetryQueries,
  ReviewQueries,
  SettingsQueries,
  SkillResolutionLogQueries,
  SkillsQueries,
  ThreadQueries,
  VerificationQueries,
} from '@shipcode/db';
import type {
  AnsweredClarification,
  ClarificationAnswer,
  ClarificationRequest,
  ExecutorModel,
  FeatureQaState,
  GitHubPrCheckSummary,
  GitHubPrReviewCommentSummary,
  PhaseSkillKey,
  PipelinePhase,
  PlanReview,
  ProjectFailureRecord,
  ReasoningEffort,
  ShipCodePlan,
  VerificationResult,
} from '@shipcode/shared';
import type {
  TaskGraphBuildOptions,
  TaskGraphWithNodes,
  TaskNodeStatus,
} from '@shipcode/shared/source';
import type { WorkflowLoadWarning, WorkflowPolicy } from './workflow-loader';

// Temporary alias while pipeline adopts the shared executor-model type directly.
export type PipelineExecutorModel = ExecutorModel;
export type PipelinePromptPhase = 'plan' | 'review' | 'revision' | 'verify' | 'execute';
export interface PipelinePromptScope {
  phase: PipelinePromptPhase;
  allowedContextSlices: readonly ('repoContextFiles' | 'testingContext')[];
  allowedMaterialKinds: readonly PromptMaterial['kind'][];
  defaultReasoningEffort: ReasoningEffort;
}

export interface PromptTelemetryPersistenceDiagnostic {
  phase: PipelinePromptPhase;
  message: string;
  nonFatal: true;
}

export interface CpuTaskGateDecision {
  allowed: boolean;
  reason?: string;
  cpuPercent?: number | null;
  thresholdPercent?: number | null;
}

export interface CpuTaskGate {
  canStartCpuTask(): CpuTaskGateDecision;
  retryDelayMs?: number;
}

export interface PipelineTaskGraphQueries {
  replaceForPlan(
    threadId: string,
    planId: string,
    plan: ShipCodePlan,
    options?: TaskGraphBuildOptions,
  ): TaskGraphWithNodes;
  getByPlanId(planId: string): TaskGraphWithNodes | null;
  getNextReadyNode(graphId: string): TaskGraphWithNodes['nodes'][number] | null;
  updateNodeStatus(nodeId: string, status: TaskNodeStatus): unknown;
  markNodeCompletedAndPromote(nodeId: string): TaskGraphWithNodes;
  markNodeFailed(nodeId: string): TaskGraphWithNodes;
  resetForRetry(graphId: string): TaskGraphWithNodes;
  updateGraphStatus(graphId: string, status: TaskGraphWithNodes['status']): TaskGraphWithNodes;
  updateNodeGithubIssueNumber(nodeId: string, issueNumber: number): TaskGraphWithNodes;
}

export interface ProjectFailureLedgerQueries {
  claimOrCreate(input: {
    projectId: string;
    baseBranch: string | null;
    fingerprint: string;
    threadId: string;
    command: string;
    summary: string;
    outputExcerpt: string;
    implicatedFiles: string[];
  }): ProjectFailureRecord;
  resolveOwnedByThread(threadId: string, commitSha: string): number;
}

// Typed event contract -- both desktop and CLI adapters must handle these
export type PipelineEvent =
  | { type: 'pipeline:phase'; threadId: string; phase: PipelinePhase; runId?: string | null }
  | {
      type: 'pipeline:start-context';
      threadId: string;
      source:
        | 'github:start-issue'
        | 'quick-task:start'
        | 'pipeline:start'
        | 'pipeline:retry'
        | 'pipeline:resume'
        | 'pipeline:approve'
        | 'automation:tick';
      projectPath: string;
      githubIssueNumber: number | null;
      autonomous: boolean;
      requireApproval: boolean;
      reviewRound: number;
    }
  | {
      type: 'pipeline:approval-gate';
      threadId: string;
      outcome: 'approval' | 'auto_execute';
      reviewDecision: 'approve' | 'request_changes' | 'reject' | 'parse_failure';
      planVersion: number | null;
      requireApproval: boolean;
      autonomous: boolean;
      reviewRound: number;
      revisionCount: number;
      hasCriticalOrMajor: boolean;
      reasons: (
        | 'requireApproval'
        | 'nonAutonomous'
        | 'criticalFindings'
        | 'reviewApproved'
        | 'revisionsExhausted'
        | 'parseFailure'
        | 'manualSkipReview'
        | 'reviewRejected'
      )[];
    }
  | {
      type: 'pipeline:verification-exhausted';
      threadId: string;
      retries: number;
      testSummary?: string;
    }
  | { type: 'pipeline:turn-started'; threadId: string; turnNumber: number }
  | {
      type: 'pipeline:turn-completed';
      threadId: string;
      turnNumber: number;
      result: 'success' | 'failed' | 'max_turns_reached' | 'issue_closed';
    }
  | {
      /**
       * Emitted after every provider call that reports which model
       * actually served the request. For openrouter/auto this is the
       * meta-router's pick; for claude/codex it's just the CLI name.
       * Carries token + cost totals for the individual call so the CLI
       * and desktop adapters can surface per-phase cost without
       * re-reading the DB.
       */
      type: 'pipeline:model-resolved';
      threadId: string;
      runId?: string | null;
      /**
       * The provider phase name (narrower than PipelinePhase: always
       * one of plan|review|revision|execute|verify, never idle etc.)
       */
      phase: 'plan' | 'review' | 'revision' | 'execute' | 'verify';
      /** What the caller requested (the model hint or tier default). */
      requestedModel: string;
      /** What the provider actually served (e.g. 'anthropic/claude-sonnet-4-6'). */
      resolvedModel: string;
      tokensUsed?: { prompt: number; completion: number };
      costUsd?: number;
    }
  | { type: 'pipeline:output'; threadId: string; chunk: string }
  | { type: 'plan:parsed'; threadId: string; plan: ShipCodePlan }
  | { type: 'review:parsed'; threadId: string; review: PlanReview }
  | { type: 'verification:parsed'; threadId: string; verification: VerificationResult }
  | {
      /**
       * Emitted when a phase skill resolved to a lower tier than expected
       * because the higher-tier override failed validation. The desktop
       * adapter routes this into the inbox/toaster so the user knows their
       * customization is broken AND that the pipeline did not silently
       * execute a wrong prompt — the bundled default was used instead.
       */
      type: 'skill:fallback';
      threadId: string;
      phase: PhaseSkillKey;
      reason: string;
    }
  | {
      type: 'workflow:warning';
      threadId: string;
      warning: WorkflowLoadWarning;
    }
  | {
      /**
       * Canonical terminal event emitted by providers and the test phase.
       * The renderer reads these instead of parsing raw agent output.
       */
      type: 'terminal:event';
      threadId: string;
      runId?: string | null;
      event: TerminalEvent;
    };

export interface PipelineEmitter {
  emit(event: PipelineEvent): void;
}

/**
 * Persistent pipeline state owned by the orchestrator for the lifetime of a
 * single run. Every field here survives across all phases and is never cleared
 * by `resetPhaseState` (contrast `PHASE_LOCAL_FIELDS`). `PipelineContext`
 * extends this, so existing context access is unchanged; the #137 dispatch loop
 * will own an `OrchestratorState` directly and derive a `PhasePayload` per phase
 * from it via `buildPhasePayload`.
 *
 * Intentionally mutable (no `readonly`): external callers write some fields
 * after `getContext()` (e.g. the desktop IPC handler updates `clarification*`).
 * The frozen, read-only view is `PhasePayload`, not this.
 */
export interface OrchestratorState {
  threadId: string;
  projectPath: string;
  runId: string | null;
  /** Project ID this thread belongs to. Used to scope per-project skill overrides. */
  projectId: string | null;
  worktreePath: string | null;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  autonomous: boolean;
  reviewRound: number;
  clarificationRound: number;
  clarificationRequest: ClarificationRequest | null;
  clarificationAnswers: ClarificationAnswer[];
  clarificationHistory: AnsweredClarification[];
  verificationRetries: number;
  testRetries: number;
  githubIssueNumber: number | null;
  githubIssueTitle: string | null;
  githubRepo: string | null;
  plannerModel: PipelineExecutorModel;
  reviewerModel: PipelineExecutorModel;
  verifierModel: PipelineExecutorModel;
  executorModel: PipelineExecutorModel;
  plannerModelIdOverride: string | null;
  reviewerModelIdOverride: string | null;
  executorModelIdOverride: string | null;
  verifierModelIdOverride: string | null;
  plannerReasoningEffort: ReasoningEffort;
  reviewerReasoningEffort: ReasoningEffort;
  executorReasoningEffort: ReasoningEffort;
  verifierReasoningEffort: ReasoningEffort;
  /** Optional per-run model slug override (e.g. 'openrouter/auto'). */
  executorModelOverride: string | null;
  baseBranch: string;
  forkPointSha: string;
  activeProcessId: string | null;
  cancelled: boolean;
  verifiedSha: string | null;
  startedAt: number;
  phasePromptScopes: Record<PipelinePromptPhase, PipelinePromptScope>;
  phaseReasoningOverrides: Partial<Record<PipelinePromptPhase, ReasoningEffort>>;
  phaseReasoningEfforts: Record<PipelinePromptPhase, ReasoningEffort>;
  promptTelemetry: PhasePromptTelemetry[];
  promptTelemetryDiagnostics: PromptTelemetryPersistenceDiagnostic[];
  /**
   * Optional repo-owned setup contract loaded from `.shipcode/setup.json`.
   * `repoSetupLoaded` distinguishes "no file exists" from "not read yet".
   */
  repoSetupContract: LoadedRepoSetupContract | null;
  repoSetupLoaded: boolean;
  workflowPolicy: WorkflowPolicy;
  workflowWarningEmitted: boolean;
  /**
   * Per-run AbortController. Providers honor `abort.signal` to cancel
   * in-flight work (subprocess kill OR HTTP abort). cancel(threadId)
   * calls abort() in addition to killing any active process.
   */
  abort: AbortController;
  /** Per-node verification retry counter. Reset to 0 when active node advances. */
  nodeVerificationRetries: number;
  /** Git SHA before current node's execution. Used to compute node-scoped diff. */
  nodeAnchorSha: string | null;
  /**
   * Number of full plan→review→execute→verify turns completed so far.
   * Incremented after each turn; the loop exits when `turnCount >= maxTurns`
   * or verify passes.
   */
  turnCount: number;
  /**
   * Feature QA contract extracted from the PRD `## QA State` section.
   * When present, the verifier evaluates each critical flow and
   * persists per-flow pass/fail results.
   */
  featureQaState: FeatureQaState | null;
  /**
   * True when this run was started via startFromAutomation (cron tick).
   * The executor prompt drops file-restriction language because the
   * synthesized plan has empty files/steps arrays — the prompt itself
   * is the source of truth and the executor must discover files itself.
   */
  isAutomationRun: boolean;
}

/**
 * Live, mutable per-run context. Extends `OrchestratorState` with the
 * phase-local fields cleared by `resetPhaseState` (see `PHASE_LOCAL_FIELDS`) and
 * the lazily materialized prompt-material cache. The split is naming-only:
 * `PipelineContext` still carries every field it always has, so all existing
 * reads, writes, construction, and persistence are unchanged.
 */
export interface PipelineContext extends OrchestratorState {
  testOutput: string | null;
  /**
   * Pre-loaded repo context string for injection into phase prompts.
   * Read once from `<projectPath>/.agents/memory/` at pipeline start.
   */
  repoContext: string | null;
  repoPromptMaterials: PromptMaterial[] | null;
  promptMaterialSummaries: Partial<Record<PipelinePromptPhase, PromptMaterialSummary>>;
  /**
   * Optional follow-up inputs from a linked draft PR. When set, the next
   * execute pass appends them to the prompt and then clears the field.
   */
  stabilizationFeedback: string | null;
  /**
   * Optional context for semantic resume after an interrupted execution.
   * When set, the next execute pass appends it to the prompt and then clears it.
   */
  executionResumeContext: string | null;
  /**
   * Raw output from a previous failed plan attempt. When set,
   * `startPlanGeneration` appends format-correction context so the
   * model can fix its output format instead of starting from scratch.
   * Consumed (cleared) after use.
   */
  previousPlanRawOutput: string | null;
  /** Cleanup function for a running runtime QA server. Called on cancel. */
  runtimeQaCleanup: (() => Promise<void>) | null;
  /** Captured output from runtime QA test commands. Fed to verifier. */
  runtimeQaOutput: string | null;
  /** Timestamp when this thread started waiting for a CPU-heavy local command slot. */
  cpuQueueStartedAt: number | null;
  /** Last terminal notice emitted while waiting for a CPU-heavy local command slot. */
  cpuQueueLastNotifiedAt: number | null;
}

/**
 * Read-only snapshot of context fields relevant to a single provider call.
 * Created by `snapshotPhaseInput` before each `runProviderPhase` invocation
 * so the provider sees a frozen view — mutations go through the return value
 * of `runProviderPhase`, not through direct context access.
 */
export interface PhaseInput {
  readonly threadId: string;
  readonly projectPath: string;
  readonly projectId: string | null;
  readonly worktreePath: string | null;
  readonly baseBranch: string;
  readonly forkPointSha: string;
  readonly githubIssueNumber: number | null;
  readonly githubIssueTitle: string | null;
  readonly githubRepo: string | null;
  readonly autonomous: boolean;
}

/**
 * Consumed-once carry threaded from the previous phase into the next phase's
 * `PhasePayload` via `buildPhasePayload`'s `prevOutput` arg. Each field is read
 * once by the receiving phase when building its prompt. All optional: an omitted
 * field means "no carry of this kind". (#138 builds the pipe; #139 will move the
 * *writes* off `PipelineContext` into typed `PhaseOutcome` results.)
 */
export interface PhaseCarryOutput {
  readonly stabilizationFeedback?: string | null;
  readonly executionResumeContext?: string | null;
  readonly previousPlanRawOutput?: string | null;
  readonly testOutput?: string | null;
  readonly runtimeQaOutput?: string | null;
}

/**
 * Context mutations produced by a `runProviderPhaseCore` call, returned instead
 * of being applied directly. The orchestrator appends `promptTelemetry` to
 * `context.promptTelemetry`, and — only when telemetry persistence failed —
 * appends `diagnosticEntry` to `context.promptTelemetryDiagnostics`.
 */
export interface ProviderPhaseDeltas {
  promptTelemetry: PhasePromptTelemetry;
  diagnosticEntry: PromptTelemetryPersistenceDiagnostic | null;
}

/**
 * Frozen, per-phase input built by `buildPhasePayload` before a phase runs.
 * Carries identity, the phase-resolved model + model-id override + reasoning
 * effort, the phase's prompt materials, the prompt-telemetry counter, and the
 * consumed-once `carry` from the previous phase — everything a single phase
 * reads, and nothing it mutates. Read-only by design; the live `PipelineContext`
 * remains the orchestrator's mutable store.
 *
 * The single per-phase snapshot (#138): `runProviderPhaseCore` reads this
 * directly. The `runProviderPhase` wrapper builds one per invocation via
 * `buildPhasePayload` and threads it to the provider call.
 */
export interface PhasePayload {
  readonly threadId: string;
  readonly projectPath: string;
  readonly projectId: string | null;
  readonly worktreePath: string | null;
  readonly baseBranch: string;
  readonly forkPointSha: string;
  readonly githubIssueNumber: number | null;
  readonly githubIssueTitle: string | null;
  readonly githubRepo: string | null;
  readonly autonomous: boolean;
  readonly runId: string | null;
  readonly isAutomationRun: boolean;
  /** The live abort signal (not the controller) so the core can read `.aborted`. */
  readonly abort: AbortSignal;
  /** `promptTelemetry.length` at build time; the next attempt is this + 1. */
  readonly promptTelemetryCount: number;
  readonly phase: PipelinePromptPhase;
  /** Model resolved for this phase (mirrors `resolveAgentForPhase`). */
  readonly model: PipelineExecutorModel;
  /** Model-id override resolved for this phase, or null. */
  readonly modelIdOverride: string | null;
  readonly reasoningEffort: ReasoningEffort;
  readonly repoContext: string | null;
  readonly repoPromptMaterials: readonly PromptMaterial[];
  readonly promptMaterialSummary: PromptMaterialSummary | undefined;
  /** Consumed-once carry from the previous phase; `{}` when none. */
  readonly carry: PhaseCarryOutput;
}

/**
 * Fields on PipelineContext that are scoped to a single phase and should be
 * cleared between transitions. `resetPhaseState` nulls these before handing
 * control to the next phase handler.
 */
export type PhaseLocalField =
  | 'stabilizationFeedback'
  | 'executionResumeContext'
  | 'previousPlanRawOutput'
  | 'testOutput'
  | 'runtimeQaOutput'
  | 'runtimeQaCleanup'
  | 'cpuQueueStartedAt'
  | 'cpuQueueLastNotifiedAt';

export const PHASE_LOCAL_FIELDS: readonly PhaseLocalField[] = [
  'stabilizationFeedback',
  'executionResumeContext',
  'previousPlanRawOutput',
  'testOutput',
  'runtimeQaOutput',
  'runtimeQaCleanup',
  'cpuQueueStartedAt',
  'cpuQueueLastNotifiedAt',
] as const;

export interface ActivePipelineSummary {
  threadId: string;
  projectId: string | null;
  projectPath: string;
  /** Absolute worktree path the pipeline is operating in, if any. */
  worktreePath: string | null;
  phase: PipelinePhase;
  approvedAwaitingExecution?: boolean;
  startedAt: number;
  activeProcessId: string | null;
}

export interface PipelineDeps {
  emitter: PipelineEmitter;
  processManager: ProcessManager;
  threads: ThreadQueries;
  plans: PlanQueries;
  reviews: ReviewQueries;
  diffs: DiffQueries;
  verifications: VerificationQueries;
  githubIssues: GitHubIssueQueries;
  checkpoints: CheckpointQueries;
  projects: ProjectQueries;
  projectFailures?: ProjectFailureLedgerQueries;
  settings: SettingsQueries;
  providers: ProviderRegistry;
  /** Per-phase prompt skill overrides (project + global). The pipeline passes
   *  this into every prompt builder so resolveSkill walks the tier chain. */
  skills: SkillsQueries;
  /** Internal task graph persistence for decomposed plan execution contracts. */
  taskGraphs?: PipelineTaskGraphQueries;
  promptTelemetry?: PromptTelemetryQueries;
  /** Closed phase durations across non-provider work such as testing and shipping. */
  phaseLogs?: PhaseLogQueries;
  /** Durable per-attempt run ledger tying phases, provider calls, and issue locks together. */
  pipelineRuns?: PipelineRunQueries;
  /**
   * Lifecycle envelope for individual provider invocations. When provided,
   * the runtime emits one started -> completed/failed/aborted row per phase
   * attempt so the UI / debug tools can correlate token + cost + error
   * across the whole pipeline.
   */
  pipelineSteps?: PipelineStepQueries;
  /**
   * Append-only conversation log. When provided, runProviderPhase writes
   * one prompt + one response row per provider invocation so all agent
   * dialogue is queryable and viewable in the Conversations tab.
   */
  agentConversations?: AgentConversationQueries;
  /** Local skill resolution/fallback telemetry for prompt skill performance. */
  skillResolutionLogs?: SkillResolutionLogQueries;
  /**
   * Feature QA result persistence. When provided, the pipeline persists
   * per-flow QA results after verification when a ## QA State section
   * exists in the PRD.
   */
  featureQaResults?: FeatureQaResultQueries;
  /** Optional host-resource gate for local shell test/runtime QA commands. */
  cpuTaskGate?: CpuTaskGate;
}

export interface Pipeline {
  startPlanGeneration: (
    threadId: string,
    prompt: string,
    projectPath: string,
    worktreePath: string | null,
  ) => Promise<void>;
  startReview: (threadId: string, plan: ShipCodePlan) => Promise<void>;
  startRevision: (threadId: string, plan: ShipCodePlan, reviewFeedback: string) => Promise<void>;
  startExecution: (threadId: string, plan: ShipCodePlan) => Promise<void>;
  startTesting: (threadId: string) => Promise<void>;
  startVerification: (threadId: string) => Promise<void>;
  startCommitAndPush: (threadId: string) => Promise<void>;
  startShipping: (threadId: string) => Promise<void>;
  startStabilization: (
    threadId: string,
    inputs: {
      prNumber: number;
      prUrl: string | null;
      failingChecks: GitHubPrCheckSummary[];
      unresolvedReviewComments: GitHubPrReviewCommentSummary[];
    },
  ) => Promise<void>;
  /**
   * Re-create in-memory PipelineContext from persisted Thread state.
   * Called before startExecution/startPlanGeneration when the user
   * approves or rejects a plan that was generated in a previous app
   * session (activePipelines lost on restart).
   */
  rehydrateContext: (threadId: string, projectPath: string, issueTitle?: string | null) => void;
  startFromGitHubIssue: (
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: PipelineExecutorModel,
    options?: {
      baseBranch?: string;
      worktreePath?: string | null;
      executorModelOverride?: string | null;
      plannerModel?: PipelineExecutorModel;
      reviewerModel?: PipelineExecutorModel;
      verifierModel?: PipelineExecutorModel;
      plannerModelIdOverride?: string | null;
      reviewerModelIdOverride?: string | null;
      executorModelIdOverride?: string | null;
      verifierModelIdOverride?: string | null;
      plannerReasoningEffort?: ReasoningEffort;
      reviewerReasoningEffort?: ReasoningEffort;
      executorReasoningEffort?: ReasoningEffort;
      verifierReasoningEffort?: ReasoningEffort;
    },
  ) => Promise<void>;
  /**
   * Entry path for Quick Mode tasks. Same flow as startFromGitHubIssue but
   * without a real GitHub issue: the cache row holds a negative sentinel
   * issueNumber and there is no workpad protocol or PR shipping.
   */
  startFromQuickTask: (
    threadId: string,
    projectPath: string,
    task: { issueNumber: number; title: string; text: string },
    executorModel: PipelineExecutorModel,
    options?: {
      baseBranch?: string;
      worktreePath?: string | null;
      executorModelOverride?: string | null;
      plannerModel?: PipelineExecutorModel;
      reviewerModel?: PipelineExecutorModel;
      verifierModel?: PipelineExecutorModel;
      plannerModelIdOverride?: string | null;
      reviewerModelIdOverride?: string | null;
      executorModelIdOverride?: string | null;
      verifierModelIdOverride?: string | null;
      plannerReasoningEffort?: ReasoningEffort;
      reviewerReasoningEffort?: ReasoningEffort;
      executorReasoningEffort?: ReasoningEffort;
      verifierReasoningEffort?: ReasoningEffort;
    },
  ) => Promise<void>;
  /**
   * Entry path for cron-driven automation runs. Synthesizes an approved
   * plan in-place and skips planner + reviewer phases — the executor reads
   * the prompt directly. Caller MUST have already invoked initializeContext
   * with the seed (projectPath, models, autonomous=true).
   */
  startFromAutomation: (
    threadId: string,
    prompt: string,
    projectPath: string,
    automationName: string,
  ) => Promise<void>;
  initializeContext: (
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ) => PipelineContext;
  cancel: (threadId: string) => void;
  pause: (threadId: string) => void;
  getContext: (threadId: string) => PipelineContext | undefined;
  listActive: () => ActivePipelineSummary[];
  listActiveInPhases: (phases: readonly string[]) => ActivePipelineSummary[];
}
