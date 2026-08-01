// === Pipeline Types ===

export type AgentType =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'cursor'
  | 'grok'
  | 'gh'
  | 'openrouter'
  | 'shell';

/**
 * The subset of AgentType that can drive a pipeline phase. Excludes
 * 'gh' which is a data-plane CLI, not an LLM executor.
 *
 * Single source of truth for every executor-model type annotation in
 * the monorepo (DB row types, IPC payloads, UI Select values, pipeline
 * context, etc). Keep this in sync with the `executor_model` SQLite
 * column contents.
 *
 * We use a string literal union rather than a TS enum because:
 *  - Enums compile to runtime objects (bundle weight in a published
 *    CLI package). String literals are zero-cost at runtime.
 *  - SQLite stores strings; no enum ⇄ ordinal round-trip needed.
 *  - GitHub label values are already strings (`shipcode:agent:claude`, etc).
 */
export type ExecutorModel = 'claude' | 'codex' | 'gemini' | 'cursor' | 'grok' | 'openrouter';
export type TriageModel = Exclude<ExecutorModel, 'gemini' | 'cursor' | 'grok'>;
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type GeneratorCli = 'claude' | 'codex';
export type PhaseCliProvider = Extract<
  ExecutorModel,
  'claude' | 'codex' | 'gemini' | 'cursor' | 'grok'
>;
export type ContextGeneratorCli = GeneratorCli;
export type RevisionCount = 0 | 1 | 2 | 3 | 4 | 5;
export type PipelineSpeedProfile = 'smart_fast' | 'thorough';

/**
 * `terminating` means a kill signal was sent but the OS has not reported exit
 * yet. Only the real pty `exit` / child `close` event may set `exited` — a
 * process that ignores SIGTERM stays `terminating` so escalation checks can
 * still see it as alive.
 */
export type AgentState = 'starting' | 'running' | 'idle' | 'errored' | 'terminating' | 'exited';

export interface AgentProcess {
  id: string;
  type: AgentType;
  state: AgentState;
  cwd: string;
  exitCode: number | null;
}
