import {
  type AgentType,
  CLAUDE_MODEL_OPTIONS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  formatReasoningEffortLabel,
  getSupportedReasoningEfforts,
  OPENROUTER_MODEL_OPTIONS,
  type ReasoningEffort,
  resolveModelAlias,
} from '@shipcode/shared';

/**
 * Curated executor-model suggestions for an automation, by provider. Backs the
 * Model ID field's <datalist> so the catalog (notably the full OpenRouter set,
 * including `openrouter/auto`) is discoverable instead of blind free-text. The
 * field stays free-text — these are suggestions, not a closed set. Returns []
 * for `inherit` (no override) and any provider without a curated list.
 */
export function executorModelSuggestions(
  provider: 'inherit' | AgentType,
): ReadonlyArray<{ value: string; label: string }> {
  switch (provider) {
    case 'openrouter':
      return OPENROUTER_MODEL_OPTIONS;
    case 'claude':
      return CLAUDE_MODEL_OPTIONS;
    case 'codex':
      return CODEX_FALLBACK_MODEL_OPTIONS;
    default:
      return [];
  }
}

const ALL_AUTOMATION_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];

/**
 * Reasoning-effort choices for an automation override, narrowed to what the
 * selected provider (and typed model id, shorthand aliases included) actually
 * supports. The pipeline hard-rejects unsupported efforts at schedule time, so
 * offering them here would let an automation save a selection that can only
 * fail later — e.g. `none` on Fable 5, whose thinking cannot be disabled.
 * `inherit` (and `gh`/`shell`, which never run reasoning phases) keep the full
 * list because the effective provider is not known yet.
 */
export function executorReasoningOptions(
  provider: 'inherit' | AgentType,
  modelId: string,
): ReadonlyArray<{ value: 'inherit' | ReasoningEffort; label: string }> {
  const efforts =
    provider === 'inherit' || provider === 'gh' || provider === 'shell'
      ? ALL_AUTOMATION_REASONING_EFFORTS
      : getSupportedReasoningEfforts(provider, resolveModelAlias(provider, modelId));

  return [
    { value: 'inherit', label: 'Inherit' },
    ...efforts.map((effort) => ({ value: effort, label: formatReasoningEffortLabel(effort) })),
  ];
}

/** Provider-aware placeholder for the automation Model ID field. */
export function executorModelPlaceholder(provider: 'inherit' | AgentType): string {
  switch (provider) {
    case 'openrouter':
      return 'e.g. openrouter/auto';
    case 'codex':
      return 'e.g. gpt-5.6-sol';
    case 'claude':
      return 'e.g. opus or claude-opus-4-8';
    default:
      return 'Inherit from project default';
  }
}
