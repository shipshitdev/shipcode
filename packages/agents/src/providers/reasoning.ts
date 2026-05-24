import { type ReasoningEffort, resolveProviderReasoningEffort } from '@shipcode/shared';

export function mapReasoningEffortToClaudeThinkingTokens(
  effort: ReasoningEffort | undefined,
  modelId?: string | null,
): number | null {
  switch (resolveProviderReasoningEffort('claude', effort ?? 'high', modelId).effective) {
    case 'none':
      return null;
    case 'medium':
      return 8000;
    default:
      return 32000;
  }
}

export function mapReasoningEffortToCodex(
  effort: ReasoningEffort | undefined,
  modelId?: string | null,
): ReasoningEffort {
  return resolveProviderReasoningEffort('codex', effort ?? 'high', modelId).effective;
}

export function normalizeOpenRouterReasoningEffort(
  effort: ReasoningEffort | undefined,
  modelId?: string | null,
): ReasoningEffort {
  return resolveProviderReasoningEffort('openrouter', effort ?? 'high', modelId).effective;
}
