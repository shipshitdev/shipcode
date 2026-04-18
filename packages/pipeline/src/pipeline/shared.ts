import type { ProviderPhase, SkillValidationError } from '@shipcode/agents';
import type {
  GitHubPrCheckSummary,
  GitHubPrReviewCommentSummary,
  PhaseSkillKey,
  PipelinePhase,
  ShipCodePlan,
} from '@shipcode/shared';
import type {
  ActivePipelineSummary,
  PipelineContext,
  PipelineDeps,
  PipelineExecutorModel,
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
  resolveAgentForPhase: (context: PipelineContext, phase: ProviderPhase) => PipelineExecutorModel;
  runProviderPhase: (
    context: PipelineContext,
    phase: ProviderPhase,
    prompt: string,
    phaseHints: {
      maxTurns?: number;
      reasoningEffort?: PipelineContext['plannerReasoningEffort'];
    },
  ) => Promise<{ rawOutput: string; exitCode: number; resolvedModel?: string }>;
  emitPhase: (
    threadId: string,
    phase: Parameters<PipelineDeps['threads']['updateStatus']>[1],
    error?: string,
  ) => void;
  postPlanComment: (context: PipelineContext, plan: ShipCodePlan) => Promise<void>;
}

export interface PipelinePhaseHandlers {
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
}

export interface PipelineHelperEnv {
  deps: PipelineDeps;
  contextHelpers: PipelineContextHelpers;
  runtime: PipelineRuntime;
  handlers: PipelinePhaseHandlers;
}

export type ThreadStatus = Parameters<PipelineDeps['threads']['updateStatus']>[1];
export type ProviderPhaseHints = {
  maxTurns?: number;
  reasoningEffort?: PipelineContext['plannerReasoningEffort'];
};

export type ListedPipelinePhase = PipelinePhase;
