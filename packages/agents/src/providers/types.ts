/**
 * Provider abstraction for pipeline phase execution.
 *
 * The pipeline has historically spawned claude/codex CLIs directly via
 * ProcessManager + node-pty. This module introduces a thin layer so that
 * HTTP-backed providers (OpenRouter, etc.) can be used interchangeably
 * without the pipeline knowing the transport.
 *
 * Key design notes:
 *
 * - Each phase has its own completion semantics (PLAN salvages parsed
 *   output on non-zero exit; EXECUTE requires exitCode === 0; REVIEW and
 *   VERIFY parse regardless of exit). The provider does NOT try to unify
 *   these. It returns rawOutput + exitCode and the phase code in
 *   `pipeline.ts` keeps its existing rules.
 *
 * - Providers MUST honor `signal` for cancellation. The CLI provider
 *   translates it into `ProcessManager.kill()`; the OpenRouter provider
 *   passes it to `fetch(..., { signal })` so streams abort cleanly.
 *
 * - OpenRouter now supports all five phases. PLAN / REVIEW / REVISION /
 *   VERIFY run as HTTP chat completions; EXECUTE runs through the
 *   in-process tool-call harness.
 */

import type {
  AgentType,
  ClarificationRequest,
  ProviderRunMode,
  ReasoningEffort,
} from '@shipcode/shared';
import type { PromptMaterialSummary, PromptTelemetry } from '../prompt-scope';
import type { TerminalEvent } from '../terminal-events';
import type { GithubGraphqlDeps } from '../tools/types';

export type ProviderPhase = 'plan' | 'review' | 'revision' | 'verify' | 'execute';

/**
 * Declarative per-phase tool policy. The pipeline passes these as
 * `phaseHints` so that toolset scoping is data, not code buried in
 * `buildClaudeCommand`. When a hint is present it takes precedence
 * over the hardcoded defaults.
 */
export const PHASE_TOOL_POLICIES: Record<
  ProviderPhase,
  { allowedTools?: string[]; disallowedTools?: string[]; sandbox?: 'read-only' | 'workspace-write' }
> = {
  plan: {
    disallowedTools: [
      'Edit',
      'Write',
      'MultiEdit',
      'Bash',
      'NotebookEdit',
      'NotebookRead',
      'Read',
      'Glob',
      'Grep',
      'Task',
      'WebFetch',
      'WebSearch',
    ],
    sandbox: 'read-only',
  },
  revision: {
    disallowedTools: [
      'Edit',
      'Write',
      'MultiEdit',
      'Bash',
      'NotebookEdit',
      'NotebookRead',
      'Read',
      'Glob',
      'Grep',
      'Task',
      'WebFetch',
      'WebSearch',
    ],
    sandbox: 'read-only',
  },
  review: {
    disallowedTools: [
      'Edit',
      'Write',
      'MultiEdit',
      'Bash',
      'NotebookEdit',
      'NotebookRead',
      'Read',
      'Glob',
      'Grep',
      'Task',
      'WebFetch',
      'WebSearch',
    ],
    sandbox: 'read-only',
  },
  verify: {
    disallowedTools: [
      'Edit',
      'Write',
      'MultiEdit',
      'Bash',
      'NotebookEdit',
      'NotebookRead',
      'Read',
      'Glob',
      'Grep',
      'Task',
      'WebFetch',
      'WebSearch',
    ],
    sandbox: 'read-only',
  },
  execute: {
    allowedTools: ['Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Read'],
    sandbox: 'workspace-write',
  },
};

/**
 * Phase-specific hints the pipeline passes to the provider. Providers are
 * free to ignore anything they don't understand — these are not part of
 * the completion contract. Intended for the CLI provider to carry through
 * the claude/codex flags that phases used to build inline.
 */
export interface ProviderPhaseHints {
  /** Tools the model is allowed to call (execute phase). */
  allowedTools?: string[];
  /** Tools the model is explicitly denied (revision phase). */
  disallowedTools?: string[];
  /** claude --output-format value when applicable. */
  outputFormat?: 'text' | 'json';
  /** claude --max-turns value when applicable. */
  maxTurns?: number;
  /** codex --sandbox value when applicable. */
  sandbox?: 'read-only' | 'workspace-write';
  /** codex -a (approval) value when applicable. */
  approval?: 'never' | 'untrusted' | 'on-failure';
  /** Shared reasoning effort. Providers map unsupported values to the nearest supported level. */
  reasoningEffort?: ReasoningEffort;
  /** Runtime transport selected from AppSettings.agentRunModes. */
  runMode?: ProviderRunMode;
  /**
   * OS-sandbox config for programmatic Claude EXECUTE. Set by the pipeline
   * runtime (from AppSettings) only when claude + execute + programmatic +
   * sandbox enabled. When present, the provider wraps `claude -p` in `srt`
   * (Seatbelt/bubblewrap). When absent, programmatic claude execute fails
   * closed — it is never run unsandboxed.
   */
  osSandbox?: {
    backend: 'srt';
    networkPolicy: 'anthropic-only' | 'anthropic-github';
    extraWritePaths: string[];
  };
}

export interface ProviderRequest {
  phase: ProviderPhase;
  prompt: string;
  /**
   * Working directory. For execute/revision/verify this is the worktree
   * path; for plan/review it's the project path. Providers that mutate
   * the filesystem (only execute) MUST confine to this directory.
   */
  cwd: string;
  /**
   * The raw project root. The openrouter execute harness refuses to run
   * if `cwd === projectPath` — defense in depth against a caller that
   * forgot to create a worktree. All other phases can ignore this.
   */
  projectPath: string;
  /**
   * The configured workspace root (matches `AppSettings.worktreeRoot`).
   * When set, the CLI provider asserts the spawn cwd is a safe workspace
   * before launching the agent (basename + prefix check). Omit to disable
   * the check (e.g. instant terminals running at the project root).
   *   - `null`/undefined  → use default ~/.shipcode/worktrees
   *   - `''`              → project-local mode (skip prefix check)
   *   - absolute / `~/x`  → custom worktree root
   */
  workspaceRoot?: string | null;
  /** Explicit model override. Takes precedence over settings defaults. */
  modelHint?: string;
  /**
   * Cancellation signal. Providers MUST abort in-flight work when this
   * fires. Wired through `PipelineContext.abort.signal` by the pipeline.
   */
  signal: AbortSignal;
  /** Phase-specific hints (see ProviderPhaseHints). */
  phaseHints?: ProviderPhaseHints;
  promptMaterialSummary?: PromptMaterialSummary;
  /**
   * The threadId this provider call is attributed to. Used by telemetry
   * (Tier 3) to persist resolved-model + token usage against the thread.
   * Providers may log against this ID but must not read thread state.
   */
  threadId: string;
  /** Notifies the orchestrator which managed process owns this provider run. */
  onProcessStart?: (processId: string) => void;
  /**
   * Optional callback for streaming canonical terminal events.
   * Providers emit TerminalEvents through this so the terminal drawer
   * can render a unified stream regardless of backend.
   */
  onTerminalEvent?: (event: TerminalEvent) => void;
  /**
   * Orchestrator-supplied deps for the `github_graphql` tool. Plumbed
   * by `runProviderPhase` from the project's stored credential. When
   * omitted (e.g. project has no GH auth), the tool itself returns a
   * structured `auth_missing` error.
   */
  githubGraphql?: GithubGraphqlDeps;
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'not_found'
  | 'aborted'
  | 'tool_loop_overflow'
  | 'unexpected_stop'
  | 'binary_missing'
  | 'agent_sdk_pool_exhausted'
  | 'unknown';

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  /** If true, the pipeline's per-phase retry logic may retry this call. */
  retryable: boolean;
}

export interface ProviderResponse {
  /**
   * For PLAN/REVIEW/REVISION/VERIFY: the concatenated stream the
   * StreamParser should `feed()`. For EXECUTE: empty string — EXECUTE
   * success is signaled by exitCode, not parsed output.
   */
  rawOutput: string;
  /**
   * Mirrors subprocess semantics so existing phase completion handlers
   * in pipeline.ts continue to work without change:
   *   - CLI provider: the actual process exit code
   *   - OpenRouter provider: 0 on success-shape, non-zero on provider error
   */
  exitCode: number;
  /** Structured error diagnostics when `exitCode !== 0`. */
  providerError?: ProviderError;
  /** What model actually served the request (e.g. openrouter/auto resolution). */
  resolvedModel?: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  promptTelemetry?: PromptTelemetry;
  clarificationRequest?: ClarificationRequest;
}

export interface AgentProvider {
  readonly id: 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'cursor-cli' | 'grok-cli' | 'openrouter';
  readonly supports: ReadonlySet<ProviderPhase>;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<{ ok: boolean; reason?: string }>;
}

/**
 * Registry that dispatches (AgentType, ProviderPhase) to the right
 * provider instance. Implemented in `./registry.ts`.
 */
export interface ProviderRegistry {
  /**
   * Resolve the provider to use for the given agent + phase.
   * Throws if no provider supports the phase for this agent.
   */
  for(agent: AgentType, phase: ProviderPhase): AgentProvider;
  /** All registered providers, keyed by their `id`. */
  all(): ReadonlyMap<AgentProvider['id'], AgentProvider>;
}
