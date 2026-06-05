import type { AnsweredClarification, ClarificationAnswer, ClarificationRequest } from './terminal';

// === Thread Types ===

export const PIPELINE_PHASE = {
  idle: 'idle',
  planning: 'planning',
  clarifying: 'clarifying',
  reviewing: 'reviewing',
  revising: 'revising',
  approval: 'approval',
  executing: 'executing',
  testing: 'testing',
  verifying: 'verifying',
  shipping: 'shipping',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
} as const;

export type PipelinePhase = (typeof PIPELINE_PHASE)[keyof typeof PIPELINE_PHASE];

export type ThreadStatus = PipelinePhase;
export const THREAD_KIND = {
  pipeline: 'pipeline',
  instant: 'instant',
} as const;

export type ThreadKind = (typeof THREAD_KIND)[keyof typeof THREAD_KIND];
export type InstantFixScope = 'user' | 'project' | 'custom';
export type ProviderRunMode = 'programmatic' | 'interactive';

/**
 * Per-agent run-mode selection. Each pipeline phase (plan/review/revision/
 * verify/execute) carries its own transport: `interactive` drives the official
 * CLI in a PTY (billed against the interactive subscription seat), while
 * `programmatic` uses `claude -p` / `codex exec --json` (claude draws from the
 * rationed Agent-SDK credit pool). `issueTerminal` is always interactive.
 */
export interface AgentRunModeConfig {
  issueTerminal: 'interactive';
  plan: ProviderRunMode;
  review: ProviderRunMode;
  revision: ProviderRunMode;
  verify: ProviderRunMode;
  execute: ProviderRunMode;
  terminalFix: ProviderRunMode;
  instant: ProviderRunMode;
}

export interface AgentRunModeSettings {
  claude: AgentRunModeConfig;
  codex: AgentRunModeConfig;
}

export interface Thread {
  id: string;
  projectId: string;
  currentRunId?: string | null;
  kind: ThreadKind;
  title: string;
  prompt: string;
  status: ThreadStatus;
  worktreeBranch: string | null;
  worktreePath: string | null;
  plannerModel: string;
  reviewerModel: string;
  verifierModel: string;
  executorModel: string;
  reviewRound: number;
  clarificationRound: number;
  clarificationRequest: ClarificationRequest | null;
  clarificationAnswers: ClarificationAnswer[];
  answeredClarification: AnsweredClarification | null;
  verificationStatus: string | null;
  verificationRetries: number;
  autonomous: boolean;
  baseBranch: string | null;
  forkPointSha: string | null;
  githubIssueNumber: number | null;
  githubPrNumber: number | null;
  githubRepo: string | null;
  automationId: string | null;
  lastError: string | null;
  failurePhase: string | null;
  failureCount: number;
  pausedPhase: PipelinePhase | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Tier 3 telemetry: what openrouter/auto (or claude/codex) actually
  // served each phase. For non-openrouter runs these just hold 'claude'
  // or 'codex'. Null until the phase runs.
  plannerResolvedModel: string | null;
  reviewerResolvedModel: string | null;
  revisorResolvedModel: string | null;
  executorResolvedModel: string | null;
  verifierResolvedModel: string | null;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalCostUsd: number;
  doneAt: string | null;
  archivedAt?: string | null;
}
