import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_MAX_RETRY_BACKOFF_MS } from './retry-scheduler';

export const DEFAULT_MAX_CONCURRENT_AGENTS = 10;

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
}

export interface WorkflowPolicy {
  path: string | null;
  config: Record<string, unknown>;
  promptTemplate: string | null;
  agent: WorkflowAgentPolicy;
  warning: WorkflowLoadWarning | null;
}

export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  path: null,
  config: {},
  promptTemplate: null,
  agent: {
    maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS,
    maxRetryBackoffMs: DEFAULT_MAX_RETRY_BACKOFF_MS,
    maxConcurrentAgentsByState: {},
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
 * Parse `agent.max_concurrent_agents_by_state` from front matter.
 * Keys normalized to lowercase; non-positive/non-numeric values silently dropped.
 */
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
    frontMatter: end[1] ?? '',
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
          message: `WORKFLOW.md front matter could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
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
  return {
    path: sourcePath,
    config,
    promptTemplate: body || null,
    agent: {
      maxConcurrentAgents:
        positiveInteger(agent.max_concurrent_agents) ?? DEFAULT_MAX_CONCURRENT_AGENTS,
      maxRetryBackoffMs:
        positiveInteger(agent.max_retry_backoff_ms) ?? DEFAULT_MAX_RETRY_BACKOFF_MS,
      maxConcurrentAgentsByState: parsePerStateCaps(agent.max_concurrent_agents_by_state),
    },
    warning: null,
  };
}

// Short-lived cache: loadWorkflowPolicy is called on every slot-freed event
// (every pipeline phase transition). WORKFLOW.md rarely changes — 30s TTL
// avoids redundant existsSync + readFileSync on a hot path.
const _policyCache = new Map<string, { policy: WorkflowPolicy; expiresAt: number }>();
const POLICY_CACHE_TTL_MS = 30_000;

export function loadWorkflowPolicy(repoPath: string): WorkflowPolicy {
  const cached = _policyCache.get(repoPath);
  if (cached && Date.now() < cached.expiresAt) return cached.policy;

  const policy = _loadWorkflowPolicyUncached(repoPath);
  _policyCache.set(repoPath, { policy, expiresAt: Date.now() + POLICY_CACHE_TTL_MS });
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
        message: `WORKFLOW.md could not be read: ${error instanceof Error ? error.message : String(error)}`,
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
        message: `WORKFLOW.md could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
        path: workflowPath,
      },
    };
  }
}
