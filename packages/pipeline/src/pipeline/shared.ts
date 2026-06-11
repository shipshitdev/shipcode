import type {
  PromptMaterial,
  ProviderPhase,
  ResolveResult,
  SkillValidationError,
} from '@shipcode/agents/source';
import type {
  ClarificationRequest,
  GitHubPrCheckSummary,
  GitHubPrReviewCommentSummary,
  PhaseSkillKey,
  PipelinePhase,
  ShipCodePlan,
} from '@shipcode/shared';
import type { TaskGraphWithNodes } from '@shipcode/shared/source';
import type {
  ActivePipelineSummary,
  ExecutePhaseCarry,
  PhasePayload,
  PipelineContext,
  PipelineDeps,
  PipelineExecutorModel,
  PlanPhaseCarry,
  ProviderPhaseDeltas,
  VerifyPhaseCarry,
} from '../types';

export interface PipelineContextHelpers {
  activePipelines: Map<string, PipelineContext>;
  ensureContext: (
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ) => PipelineContext;
  rehydrateContext: (threadId: string, projectPath: string, issueTitle?: string | null) => void;
  skillCallSite: (context: PipelineContext) => {
    context: { projectId: string | null };
    deps: {
      skills: PipelineDeps['skills'];
      onFallback: (phase: PhaseSkillKey, error: SkillValidationError | undefined) => void;
      onResolved: (phase: PhaseSkillKey, result: ResolveResult) => void;
    };
  };
  listActive: () => ActivePipelineSummary[];
  listActiveInPhases: (phases: readonly string[]) => ActivePipelineSummary[];
}

export interface PipelineRuntime {
  emitTerminalRaw: (threadId: string, content: string) => void;
  emitTerminalLifecycle: (threadId: string, message: string) => void;
  ensureRepoSetupContract: (context: PipelineContext) => PipelineContext['repoSetupContract'];
  runShellCommand: (
    threadId: string,
    cwd: string,
    command: string,
    signal: AbortSignal,
    options?: { extraEnv?: Record<string, string>; timeoutMs?: number },
  ) => Promise<{ exitCode: number; output: string }>;
  prepareWorktree: (
    context: PipelineContext,
    stage: 'execute' | 'verify',
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  getTestingContext: (context: PipelineContext) => string | null;
  getVerifyCommands: (context: PipelineContext) => string[];
  buildRepoSetupPlannerNote: (context: PipelineContext) => string;
  formatStabilizationFeedback: (inputs: {
    prNumber: number;
    prUrl: string | null;
    failingChecks: GitHubPrCheckSummary[];
    unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  }) => string;
  formatTestFixFeedback: (testOutput: string, attempt: number) => string;
  resolveAgentForPhase: (context: PipelineContext, phase: ProviderPhase) => PipelineExecutorModel;
  runProviderPhase: (
    context: PipelineContext,
    payload: PhasePayload,
    prompt: string,
    promptMaterials: PromptMaterial[],
    phaseHints: {
      maxTurns?: number;
      reasoningEffort?: PipelineContext['plannerReasoningEffort'];
    },
  ) => Promise<{
    rawOutput: string;
    exitCode: number;
    resolvedModel?: string;
    clarificationRequest?: ClarificationRequest;
  }>;
  /**
   * Pure variant of `runProviderPhase`: reads a frozen `PhasePayload` snapshot
   * (phase, resolved model + override, materials, telemetry counter) and returns
   * the context mutations as `deltas` for the caller to apply.
   */
  runProviderPhaseCore: (
    payload: PhasePayload,
    prompt: string,
    promptMaterials: PromptMaterial[],
    phaseHints: {
      maxTurns?: number;
      reasoningEffort?: PipelineContext['plannerReasoningEffort'];
    },
  ) => Promise<{
    rawOutput: string;
    exitCode: number;
    resolvedModel?: string;
    clarificationRequest?: ClarificationRequest;
    deltas: ProviderPhaseDeltas;
  }>;
  emitPhase: (
    threadId: string,
    phase: Parameters<PipelineDeps['threads']['updateStatus']>[1],
    error?: string,
  ) => void;
  postPlanComment: (context: PipelineContext, plan: ShipCodePlan) => Promise<void>;
  postTaskGraphComment: (context: PipelineContext, graph: TaskGraphWithNodes) => Promise<void>;
}

/**
 * The result of running a single pipeline phase. A phase no longer calls the
 * next phase directly; it returns one of these and the orchestrator dispatch
 * loop (pipeline.ts) advances. This replaces the implicit `handlers.startX()`
 * call graph with an explicit state machine.
 *
 * Ownership: for `done` / `paused` / `failed`, the phase has ALREADY called
 * `emitPhase` (and `activePipelines.delete` for `done`/`failed`) together with
 * its ordered side-effects (approval-gate event, plan comment, turn-completed,
 * etc.); the loop treats them as pure stop signals and never re-emits.
 * `retry` emits nothing — the loop owns the (cancelable) delay, then dispatches
 * `then`.
 */
export type PhaseOutcome =
  | {
      next: 'plan';
      prompt: string;
      projectPath: string;
      worktreePath: string | null;
      /** Typed carry into the (re)entered plan phase; see `PlanPhaseCarry`. */
      carry?: PlanPhaseCarry;
    }
  | { next: 'review'; plan: ShipCodePlan }
  | { next: 'revision'; plan: ShipCodePlan; reviewFeedback: string }
  | {
      next: 'execute';
      plan: ShipCodePlan;
      /** Typed carry into the execute phase; see `ExecutePhaseCarry`. */
      carry?: ExecutePhaseCarry;
    }
  | { next: 'testing' }
  | {
      next: 'verification';
      /** Typed carry into the verify phase (passing test output); see `VerifyPhaseCarry`. */
      carry?: VerifyPhaseCarry;
    }
  | { next: 'commit' }
  | { next: 'shipping' }
  | { next: 'done' }
  | { next: 'paused' }
  | { next: 'failed' }
  | { next: 'retry'; delayMs: number; andThen: PhaseOutcome };

export interface PipelineHelperEnv {
  deps: PipelineDeps;
  contextHelpers: PipelineContextHelpers;
  runtime: PipelineRuntime;
}

export type ThreadStatus = Parameters<PipelineDeps['threads']['updateStatus']>[1];
export type ProviderPhaseHints = {
  maxTurns?: number;
  reasoningEffort?: PipelineContext['plannerReasoningEffort'];
};

export type ListedPipelinePhase = PipelinePhase;
