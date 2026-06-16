import {
  type AgentType,
  CLAUDE_MODEL_OPTIONS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  OPENROUTER_MODEL_OPTIONS,
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

/** Provider-aware placeholder for the automation Model ID field. */
export function executorModelPlaceholder(provider: 'inherit' | AgentType): string {
  switch (provider) {
    case 'openrouter':
      return 'e.g. openrouter/auto';
    case 'codex':
      return 'e.g. gpt-5-codex';
    case 'claude':
      return 'e.g. anthropic/claude-opus-4-7';
    default:
      return 'Inherit from project default';
  }
}
