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
 * - Tier 1 supports PLAN / REVIEW / REVISION / VERIFY through the
 *   OpenRouter provider. EXECUTE is Tier 2 and currently throws
 *   `not_found` for the OpenRouter provider.
 */

import type { AgentType } from '@shipcode/shared'

export type ProviderPhase = 'plan' | 'review' | 'revision' | 'verify' | 'execute'

/**
 * Phase-specific hints the pipeline passes to the provider. Providers are
 * free to ignore anything they don't understand — these are not part of
 * the completion contract. Intended for the CLI provider to carry through
 * the claude/codex flags that phases used to build inline.
 */
export interface ProviderPhaseHints {
  /** Tools the model is allowed to call (execute phase). */
  allowedTools?: string[]
  /** Tools the model is explicitly denied (revision phase). */
  disallowedTools?: string[]
  /** claude --output-format value when applicable. */
  outputFormat?: 'text' | 'json'
  /** claude --max-turns value when applicable. */
  maxTurns?: number
  /** codex --sandbox value when applicable. */
  sandbox?: 'read-only' | 'workspace-write'
  /** codex -a (approval) value when applicable. */
  approval?: 'never' | 'untrusted' | 'on-failure'
  /** codex --reasoning-effort when applicable. */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface ProviderRequest {
  phase: ProviderPhase
  prompt: string
  /**
   * Working directory. For execute/revision/verify this is the worktree
   * path; for plan/review it's the project path. Providers that mutate
   * the filesystem (only execute) MUST confine to this directory.
   */
  cwd: string
  /**
   * The raw project root. The openrouter execute harness refuses to run
   * if `cwd === projectPath` — defense in depth against a caller that
   * forgot to create a worktree. All other phases can ignore this.
   */
  projectPath: string
  /** Explicit model override. Takes precedence over settings defaults. */
  modelHint?: string
  /**
   * Cancellation signal. Providers MUST abort in-flight work when this
   * fires. Wired through `PipelineContext.abort.signal` by the pipeline.
   */
  signal: AbortSignal
  /** Phase-specific hints (see ProviderPhaseHints). */
  phaseHints?: ProviderPhaseHints
  /**
   * The threadId this provider call is attributed to. Used by telemetry
   * (Tier 3) to persist resolved-model + token usage against the thread.
   * Providers may log against this ID but must not read thread state.
   */
  threadId: string
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'not_found'
  | 'tool_loop_overflow'
  | 'unexpected_stop'
  | 'binary_missing'
  | 'unknown'

export interface ProviderError {
  kind: ProviderErrorKind
  message: string
  /** If true, the pipeline's per-phase retry logic may retry this call. */
  retryable: boolean
}

export interface ProviderResponse {
  /**
   * For PLAN/REVIEW/REVISION/VERIFY: the concatenated stream the
   * StreamParser should `feed()`. For EXECUTE: empty string — EXECUTE
   * success is signaled by exitCode, not parsed output.
   */
  rawOutput: string
  /**
   * Mirrors subprocess semantics so existing phase completion handlers
   * in pipeline.ts continue to work without change:
   *   - CLI provider: the actual process exit code
   *   - OpenRouter provider: 0 on success-shape, non-zero on provider error
   */
  exitCode: number
  /** Structured error diagnostics when `exitCode !== 0`. */
  providerError?: ProviderError
  /** What model actually served the request (e.g. openrouter/auto resolution). */
  resolvedModel?: string
  tokensUsed?: { prompt: number; completion: number }
  costUsd?: number
}

export interface AgentProvider {
  readonly id: 'claude-cli' | 'codex-cli' | 'openrouter'
  readonly supports: ReadonlySet<ProviderPhase>
  generate(req: ProviderRequest): Promise<ProviderResponse>
  healthCheck(): Promise<{ ok: boolean; reason?: string }>
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
  for(agent: AgentType, phase: ProviderPhase): AgentProvider
  /** All registered providers, keyed by their `id`. */
  all(): ReadonlyMap<AgentProvider['id'], AgentProvider>
}
