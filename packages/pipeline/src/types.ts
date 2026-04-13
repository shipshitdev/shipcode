import type {
  ProcessManager,
  ProviderRegistry,
  TerminalEvent,
  LoadedRepoSetupContract,
} from '@shipcode/agents';
import type { PhaseSkillKey } from '@shipcode/shared';
import type {
  CheckpointQueries,
  ProjectQueries,
  ThreadQueries,
  PlanQueries,
  ReviewQueries,
  VerificationQueries,
  GitHubIssueQueries,
  SettingsQueries,
  SkillsQueries,
} from '@shipcode/db';
import type {
  AgentType,
  GitHubPrCheckSummary,
  GitHubPrReviewCommentSummary,
  ReasoningEffort,
  ShipCodePlan,
  PipelinePhase,
  PlanReview,
  VerificationResult,
} from '@shipcode/shared';

// Models that can drive a pipeline phase. Excludes 'gh' which is a
// data-plane CLI, not an LLM executor.
export type PipelineExecutorModel = Exclude<AgentType, 'gh'>;

// Typed event contract -- both desktop and CLI adapters must handle these
export type PipelineEvent =
  | { type: 'pipeline:phase'; threadId: string; phase: PipelinePhase }
  | { type: 'pipeline:verification-exhausted'; threadId: string; retries: number }
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
      /**
       * Canonical terminal event emitted by providers and the test phase.
       * The renderer reads these instead of parsing raw agent output.
       */
      type: 'terminal:event';
      threadId: string;
      event: TerminalEvent;
    };

export interface PipelineEmitter {
  emit(event: PipelineEvent): void;
}

export interface PipelineContext {
  threadId: string;
  projectPath: string;
  /** Project ID this thread belongs to. Used to scope per-project skill overrides. */
  projectId: string | null;
  worktreePath: string | null;
  retryCount: number;
  autonomous: boolean;
  reviewRound: number;
  verificationRetries: number;
  testRetries: number;
  testOutput: string | null;
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
  /**
   * Pre-loaded repo context string for injection into phase prompts.
   * Read once from `<projectPath>/.agents/context/` at pipeline start.
   */
  repoContext: string | null;
  /**
   * Optional repo-owned setup contract loaded from `.shipcode/setup.json`.
   * `repoSetupLoaded` distinguishes "no file exists" from "not read yet".
   */
  repoSetupContract: LoadedRepoSetupContract | null;
  repoSetupLoaded: boolean;
  /**
   * Per-run AbortController. Providers honor `abort.signal` to cancel
   * in-flight work (subprocess kill OR HTTP abort). cancel(threadId)
   * calls abort() in addition to killing any active process.
   */
  abort: AbortController;
  /**
   * Optional follow-up inputs from a linked draft PR. When set, the next
   * execute pass appends them to the prompt and then clears the field.
   */
  stabilizationFeedback: string | null;
}

export interface ActivePipelineSummary {
  threadId: string;
  projectPath: string;
  phase: PipelinePhase;
  startedAt: number;
  activeProcessId: string | null;
}

export interface PipelineDeps {
  emitter: PipelineEmitter;
  processManager: ProcessManager;
  threads: ThreadQueries;
  plans: PlanQueries;
  reviews: ReviewQueries;
  verifications: VerificationQueries;
  githubIssues: GitHubIssueQueries;
  checkpoints: CheckpointQueries;
  projects: ProjectQueries;
  settings: SettingsQueries;
  providers: ProviderRegistry;
  /** Per-phase prompt skill overrides (project + global). The pipeline passes
   *  this into every prompt builder so resolveSkill walks the tier chain. */
  skills: SkillsQueries;
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
  initializeContext: (
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ) => PipelineContext;
  cancel: (threadId: string) => void;
  getContext: (threadId: string) => PipelineContext | undefined;
  listActive: () => ActivePipelineSummary[];
}
