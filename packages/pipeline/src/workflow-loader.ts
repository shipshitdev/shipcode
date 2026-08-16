import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExecutorModel } from '@shipcode/shared';
import { CLAUDE_MODEL_IDS, isClaudeRollingModelAlias, resolveModelAlias } from '@shipcode/shared';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_MAX_RETRY_BACKOFF_MS } from './retry-scheduler';

export const DEFAULT_MAX_CONCURRENT_AGENTS = 10;
export const DEFAULT_MAX_TURNS = 20;
const DEFAULT_FAN_OUT_WORKER_COUNT = 3;
export const MAX_FAN_OUT_WORKER_COUNT = 8;

/**
 * Judge model used when a fan-out run leaves `agent.fan_out_judge_model` unset
 * AND the run's executor is the Claude CLI. Picking/merging N candidate diffs is
 * the single most judgment-dense step in a fan-out execute, so it gets the
 * strongest model rather than inheriting whatever the verifier phase is pinned
 * to (which a repo may have deliberately set cheap).
 *
 * Deliberately a concrete id, not the rolling `fable` alias: the judge site
 * infers the provider from this string via `inferProviderFromModel`, which only
 * recognizes the `claude-` prefix.
 */
const DEFAULT_FAN_OUT_JUDGE_CLAUDE_MODEL: string = CLAUDE_MODEL_IDS.fable5;

export type ExecuteOrchestration = 'single' | 'fan-out';

export type WorkflowLoadWarningCode =
  | 'workflow_file_unreadable'
  | 'workflow_parse_error'
  | 'workflow_front_matter_not_a_map';

export interface WorkflowLoadWarning {
  code: WorkflowLoadWarningCode;
  message: string;
  path: string;
}

export interface WorkflowAgentPolicy {
  maxConcurrentAgents: number;
  maxRetryBackoffMs: number;
  /**
   * Per-state concurrency caps from `agent.max_concurrent_agents_by_state`.
   * Keys are lowercase phase names; values are positive integers.
   * When a key exists for the current phase, both this cap AND the global
   * `maxConcurrentAgents` must pass for dispatch.
   */
  maxConcurrentAgentsByState: Record<string, number>;
  /**
   * Maximum number of full plan→review→execute→verify turns before the
   * pipeline gives up. Default 20 (matching Symphony §7.1).
   */
  maxTurns: number;
  /**
   * Execute-phase orchestration. `single` (default) runs one executor agent.
   * `fan-out` runs `fanOutWorkerCount` cheap workers in isolated worktrees and
   * has a judge (Fable 5 by default on Claude runs) pick/merge the best result
   * — opt-in per repo via `agent.execute_orchestration: fan-out` in WORKFLOW.md.
   */
  executeOrchestration: ExecuteOrchestration;
  /** Number of parallel workers when `executeOrchestration` is `fan-out`. */
  fanOutWorkerCount: number;
  /**
   * Configured model id for the fan-out judge, or `null` when WORKFLOW.md leaves
   * it unset. This is the raw policy value — resolve the *effective* judge model
   * with `resolveFanOutJudgeModel`, which applies the Fable 5 default on Claude
   * runs and keeps every other executor on its verifier phase model.
   *
   * Slug aliases are normalized at parse time, so `fable-5` / `fable5` land here
   * as `claude-fable-5`.
   */
  fanOutJudgeModel: string | null;
}

export interface WorkflowPolicy {
  path: string | null;
  config: Record<string, unknown>;
  promptTemplate: string | null;
  /**
   * Optional Liquid template for continuation turns (after verify failure).
   * Rendered with the same context as promptTemplate plus `prior_failure_reason`.
   * Must NOT re-send the full PRD body — the agent already has it in context.
   */
  continuationPromptTemplate: string | null;
  agent: WorkflowAgentPolicy;
  warning: WorkflowLoadWarning | null;
}

export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  path: null,
  config: {},
  promptTemplate: null,
  continuationPromptTemplate: null,
  agent: {
    maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
    maxRetryBackoffMs: DEFAULT_MAX_RETRY_BACKOFF_MS,
    maxConcurrentAgentsByState: {},
    maxTurns: DEFAULT_MAX_TURNS,
    executeOrchestration: 'single',
    fanOutWorkerCount: DEFAULT_FAN_OUT_WORKER_COUNT,
    fanOutJudgeModel: null,
  },
  warning: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

/**
 * Exported for loader error normalization tests.
 *
 * @knipignore
 */
export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Parse `agent.max_concurrent_agents_by_state` from front matter.
 * Keys normalized to lowercase; non-positive/non-numeric values silently dropped.
 */
function parseExecuteOrchestration(raw: unknown): ExecuteOrchestration {
  return raw === 'fan-out' ? 'fan-out' : 'single';
}

/** Clamp the fan-out worker count to [1, MAX_FAN_OUT_WORKER_COUNT]. */
function parseFanOutWorkerCount(raw: unknown): number {
  const n = positiveInteger(raw);
  if (n === null) return DEFAULT_FAN_OUT_WORKER_COUNT;
  return Math.min(n, MAX_FAN_OUT_WORKER_COUNT);
}

/**
 * Normalize `agent.fan_out_judge_model` from front matter.
 *
 * Values run through `resolveModelAlias` so a human-typed shorthand becomes the
 * concrete id the judge site needs — `fable-5` / `fable5` → `claude-fable-5`.
 * The provider is fixed to `claude` for that call because the loader parses
 * WORKFLOW.md with no knowledge of the run's executor, and `claude` is the one
 * provider for which the resolver never throws: slug aliases are
 * provider-agnostic, and a bare rolling family alias (`fable`, `opus`, …) is
 * passed through instead of being rejected. Honoring a rolling alias is then the
 * job of `resolveFanOutJudgeModel`, which does know the executor.
 */
function parseFanOutJudgeModel(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return resolveModelAlias('claude', raw);
}

/**
 * Resolve the effective fan-out judge model for a run.
 *
 * - An explicit `fan_out_judge_model` always wins, except for a bare rolling
 *   Claude alias on a non-Claude executor: that alias is Claude-CLI-only (see
 *   `resolveModelAlias`, which throws on it for every other provider), so it is
 *   dropped rather than handed to a CLI that will reject the id.
 * - Unset on a Claude run resolves to Fable 5 — judging fan-out candidates is
 *   exactly the strongest-model job, and it should not silently inherit a
 *   cost-tuned verifier phase model.
 * - Unset on any other executor stays `null`, which keeps the judge on the
 *   verifier phase model of that run's own provider. Defaulting a Claude id here
 *   would force a Claude CLI onto a codex/gemini/cursor/grok/openrouter run,
 *   since the judge site derives its provider from this very string.
 */
export function resolveFanOutJudgeModel(
  configured: string | null,
  executorModel: ExecutorModel,
): string | null {
  if (configured) {
    if (isClaudeRollingModelAlias(configured) && executorModel !== 'claude') return null;
    return configured;
  }
  return executorModel === 'claude' ? DEFAULT_FAN_OUT_JUDGE_CLAUDE_MODEL : null;
}

function parsePerStateCaps(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const cap = positiveInteger(value);
    if (cap !== null) {
      result[key.toLowerCase()] = cap;
    }
  }
  return result;
}

export function resolveWorkflowPath(repoPath: string): string | null {
  const preferred = path.join(repoPath, '.shipcode', 'WORKFLOW.md');
  if (existsSync(preferred)) return preferred;

  const fallback = path.join(repoPath, 'WORKFLOW.md');
  if (existsSync(fallback)) return fallback;

  return null;
}

function splitWorkflow(raw: string): { frontMatter: string | null; body: string } {
  if (!raw.startsWith('---')) {
    return { frontMatter: null, body: raw.trim() };
  }

  const end = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!end) {
    throw new Error('YAML front matter block is missing a closing --- delimiter.');
  }

  return {
    frontMatter: end[1] as string,
    body: raw.slice(end[0].length).trim(),
  };
}

export function parseWorkflowPolicy(raw: string, sourcePath: string): WorkflowPolicy {
  const { frontMatter, body } = splitWorkflow(raw);
  let config: Record<string, unknown> = {};

  if (frontMatter?.trim()) {
    let parsed: unknown;
    try {
      parsed = parseYaml(frontMatter);
    } catch (error) {
      return {
        ...DEFAULT_WORKFLOW_POLICY,
        path: sourcePath,
        warning: {
          code: 'workflow_parse_error',
          message: `WORKFLOW.md front matter could not be parsed: ${formatUnknownError(error)}`,
          path: sourcePath,
        },
      };
    }
    if (!isRecord(parsed)) {
      return {
        ...DEFAULT_WORKFLOW_POLICY,
        path: sourcePath,
        warning: {
          code: 'workflow_front_matter_not_a_map',
          message: 'WORKFLOW.md front matter must parse to a YAML map/object.',
          path: sourcePath,
        },
      };
    }
    config = parsed;
  }

  const agent = isRecord(config.agent) ? config.agent : {};
  const continuationPrompt =
    typeof config.continuation_prompt === 'string' && config.continuation_prompt.trim()
      ? config.continuation_prompt.trim()
      : null;
  return {
    path: sourcePath,
    config,
    promptTemplate: body || null,
    continuationPromptTemplate: continuationPrompt,
    agent: {
      maxConcurrentAgents:
        positiveInteger(agent.max_concurrent_agents) ?? DEFAULT_MAX_CONCURRENT_AGENTS,
      maxRetryBackoffMs:
        positiveInteger(agent.max_retry_backoff_ms) ?? DEFAULT_MAX_RETRY_BACKOFF_MS,
      maxConcurrentAgentsByState: parsePerStateCaps(agent.max_concurrent_agents_by_state),
      maxTurns: positiveInteger(agent.max_turns) ?? DEFAULT_MAX_TURNS,
      executeOrchestration: parseExecuteOrchestration(agent.execute_orchestration),
      fanOutWorkerCount: parseFanOutWorkerCount(agent.fan_out_worker_count),
      fanOutJudgeModel: parseFanOutJudgeModel(agent.fan_out_judge_model),
    },
    warning: null,
  };
}

// Short-lived cache: loadWorkflowPolicy is called on every slot-freed event
// (every pipeline phase transition). WORKFLOW.md rarely changes — 30s TTL
// avoids redundant existsSync + readFileSync on a hot path.
const _policyCache = new Map<string, { policy: WorkflowPolicy; expiresAt: number }>();
const POLICY_CACHE_TTL_MS = 30_000;

function evictExpiredPolicyCacheEntries(now: number): void {
  for (const [repoPath, entry] of _policyCache) {
    if (now >= entry.expiresAt) {
      _policyCache.delete(repoPath);
    }
  }
}

export function loadWorkflowPolicy(repoPath: string): WorkflowPolicy {
  const now = Date.now();
  evictExpiredPolicyCacheEntries(now);

  const cached = _policyCache.get(repoPath);
  if (cached) return cached.policy;

  const policy = _loadWorkflowPolicyUncached(repoPath);
  _policyCache.set(repoPath, { policy, expiresAt: now + POLICY_CACHE_TTL_MS });
  return policy;
}

function _loadWorkflowPolicyUncached(repoPath: string): WorkflowPolicy {
  const workflowPath = resolveWorkflowPath(repoPath);
  if (!workflowPath) return DEFAULT_WORKFLOW_POLICY;

  let raw: string;
  try {
    raw = readFileSync(workflowPath, 'utf-8');
  } catch (error) {
    return {
      ...DEFAULT_WORKFLOW_POLICY,
      path: workflowPath,
      warning: {
        code: 'workflow_file_unreadable',
        message: `WORKFLOW.md could not be read: ${formatUnknownError(error)}`,
        path: workflowPath,
      },
    };
  }

  try {
    return parseWorkflowPolicy(raw, workflowPath);
  } catch (error) {
    return {
      ...DEFAULT_WORKFLOW_POLICY,
      path: workflowPath,
      warning: {
        code: 'workflow_parse_error',
        message: `WORKFLOW.md could not be parsed: ${formatUnknownError(error)}`,
        path: workflowPath,
      },
    };
  }
}

/**
 * Reload a repo's WORKFLOW policy from disk WITHOUT touching the cache.
 *
 * The workflow watcher uses this to compute a *candidate* policy on a file
 * change so it can decide whether to commit it (valid) or preserve the
 * last-known-good (invalid) — a plain `loadWorkflowPolicy` would otherwise
 * cache an invalid result.
 */
export function loadWorkflowPolicyUncached(repoPath: string): WorkflowPolicy {
  return _loadWorkflowPolicyUncached(repoPath);
}

/**
 * Return the currently cached policy for a repo without extending its TTL, or
 * null when nothing is cached. The watcher captures this as the last-known-good
 * policy before attempting a reload.
 */
export function peekWorkflowPolicyCache(repoPath: string): WorkflowPolicy | null {
  return _policyCache.get(repoPath)?.policy ?? null;
}

/**
 * Overwrite the cached policy for a repo and reset its TTL. The watcher uses
 * this to apply a fresh policy immediately — so the next dispatch/reconcile tick
 * sees the edit without waiting out the 30s TTL — or to re-assert the prior
 * policy after a failed reload.
 */
export function setWorkflowPolicyCache(
  repoPath: string,
  policy: WorkflowPolicy,
  now: number = Date.now(),
): void {
  _policyCache.set(repoPath, { policy, expiresAt: now + POLICY_CACHE_TTL_MS });
}

/**
 * Exported for cache eviction tests.
 *
 * @knipignore
 */
export const _internals = {
  policyCache: _policyCache,
  policyCacheTtlMs: POLICY_CACHE_TTL_MS,
};
