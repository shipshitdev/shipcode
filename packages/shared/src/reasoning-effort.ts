import { OPENROUTER_MODEL_IDS } from './model-catalog';
import type { ExecutorModel, ReasoningEffort } from './types';

const ALL_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];

const CLAUDE_REASONING_EFFORTS = [
  'none',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];
const OPENROUTER_ADAPTIVE_CLAUDE_EFFORTS = [
  'none',
  'high',
] as const satisfies readonly ReasoningEffort[];
const OPENROUTER_DISABLED_REASONING_EFFORTS = [
  'none',
] as const satisfies readonly ReasoningEffort[];

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'anthropic/claude-sonnet-4-6': OPENROUTER_MODEL_IDS.claudeSonnet46,
  'anthropic/claude-opus-4-6': OPENROUTER_MODEL_IDS.claudeOpus46,
};

const OPENROUTER_ADAPTIVE_CLAUDE_MODELS = new Set<string>([
  OPENROUTER_MODEL_IDS.claudeSonnet46,
  OPENROUTER_MODEL_IDS.claudeOpus46,
]);

const OPENROUTER_NO_REASONING_MODELS = new Set<string>([OPENROUTER_MODEL_IDS.qwen3CoderFree]);

export interface ProviderReasoningEffortResolution {
  configured: ReasoningEffort;
  effective: ReasoningEffort;
  exact: boolean;
  message: string | null;
}

export function normalizeReasoningModelId(
  provider: ExecutorModel,
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  const trimmed = modelId.trim();
  if (!trimmed) return null;
  if (provider !== 'openrouter') return trimmed;
  return OPENROUTER_MODEL_ALIASES[trimmed] ?? trimmed;
}

export function getSupportedReasoningEfforts(
  provider: ExecutorModel,
  modelId?: string | null,
): readonly ReasoningEffort[] {
  const normalizedModelId = normalizeReasoningModelId(provider, modelId);

  if (provider === 'claude') {
    return CLAUDE_REASONING_EFFORTS;
  }

  if (provider === 'codex') {
    return ALL_REASONING_EFFORTS;
  }

  if (normalizedModelId && OPENROUTER_ADAPTIVE_CLAUDE_MODELS.has(normalizedModelId)) {
    return OPENROUTER_ADAPTIVE_CLAUDE_EFFORTS;
  }

  if (normalizedModelId && OPENROUTER_NO_REASONING_MODELS.has(normalizedModelId)) {
    return OPENROUTER_DISABLED_REASONING_EFFORTS;
  }

  return ALL_REASONING_EFFORTS;
}

export function resolveProviderReasoningEffort(
  provider: ExecutorModel,
  configured: ReasoningEffort,
  modelId?: string | null,
): ProviderReasoningEffortResolution {
  const normalizedModelId = normalizeReasoningModelId(provider, modelId);

  if (provider === 'claude') {
    switch (configured) {
      case 'minimal':
        return {
          configured,
          effective: 'none',
          exact: false,
          message:
            'ShipCode currently uses Claude CLI thinking-token budgets. Minimal maps to no thinking.',
        };
      case 'low':
        return {
          configured,
          effective: 'none',
          exact: false,
          message:
            'ShipCode currently uses Claude CLI thinking-token budgets. Low maps to no thinking.',
        };
      case 'xhigh':
        return {
          configured,
          effective: 'high',
          exact: false,
          message:
            'ShipCode does not expose a distinct xhigh Claude CLI budget yet. xhigh maps to high.',
        };
      default:
        return { configured, effective: configured, exact: true, message: null };
    }
  }

  if (provider === 'codex') {
    return { configured, effective: configured, exact: true, message: null };
  }

  if (normalizedModelId && OPENROUTER_NO_REASONING_MODELS.has(normalizedModelId)) {
    if (configured === 'none') {
      return { configured, effective: 'none', exact: true, message: null };
    }
    return {
      configured,
      effective: 'none',
      exact: false,
      message: `${normalizedModelId} does not expose OpenRouter reasoning controls. ShipCode disables reasoning for this model.`,
    };
  }

  if (normalizedModelId && OPENROUTER_ADAPTIVE_CLAUDE_MODELS.has(normalizedModelId)) {
    if (configured === 'none') {
      return { configured, effective: 'none', exact: true, message: null };
    }
    return {
      configured,
      effective: 'high',
      exact: false,
      message: `${normalizedModelId} uses adaptive thinking on OpenRouter. reasoning.effort is ignored, so ShipCode treats any non-none value as the model default.`,
    };
  }

  if (configured === 'none') {
    return { configured, effective: 'none', exact: true, message: null };
  }

  return {
    configured,
    effective: configured,
    exact: false,
    message:
      normalizedModelId === OPENROUTER_MODEL_IDS.autoPaid ||
      normalizedModelId === OPENROUTER_MODEL_IDS.autoFree
        ? `${normalizedModelId} is a router. OpenRouter may remap the requested effort to the nearest supported level for the selected upstream model.`
        : normalizedModelId
          ? `${normalizedModelId} accepts reasoning via OpenRouter, but OpenRouter may remap unsupported effort levels to the nearest supported level.`
          : 'This OpenRouter selection may remap the requested effort to the nearest supported level for the final model.',
  };
}

export function formatProviderReasoningEffort(
  provider: ExecutorModel,
  configured: ReasoningEffort,
  modelId?: string | null,
): string {
  return resolveProviderReasoningEffort(provider, configured, modelId).effective;
}
