import { CLAUDE_MODEL_IDS, OPENROUTER_MODEL_IDS } from './model-catalog';
import type { ExecutorModel, ReasoningEffort } from './types';

const ALL_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];
const CODEX_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];

const GEMINI_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];

// Cursor's CLI does not expose a reasoning-effort control; the underlying
// model decides. ShipCode therefore offers only `none` (send nothing).
const CURSOR_REASONING_EFFORTS = ['none'] as const satisfies readonly ReasoningEffort[];

// Grok Build's headless mode exposes no reasoning-effort flag either; Grok picks
// its own reasoning depth, so ShipCode offers only `none` (send nothing).
const GROK_REASONING_EFFORTS = ['none'] as const satisfies readonly ReasoningEffort[];

const CLAUDE_REASONING_EFFORTS = [
  'none',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];

// Fable 5's thinking is always on (adaptive) and cannot be disabled, so `none`
// must never be offered or selected for it — only Medium and High budgets.
const CLAUDE_ALWAYS_THINKING_EFFORTS = [
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const CLAUDE_ALWAYS_THINKING_MODELS = new Set<string>([CLAUDE_MODEL_IDS.fable5]);
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
  'anthropic/claude-opus-4-8': OPENROUTER_MODEL_IDS.claudeOpus48,
};

const OPENROUTER_ADAPTIVE_CLAUDE_MODELS = new Set<string>([
  OPENROUTER_MODEL_IDS.claudeSonnet46,
  OPENROUTER_MODEL_IDS.claudeOpus46,
  OPENROUTER_MODEL_IDS.claudeOpus48,
]);

const OPENROUTER_NO_REASONING_MODELS = new Set<string>([OPENROUTER_MODEL_IDS.qwen3CoderFree]);
const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};
const CLAUDE_REASONING_SUPPORT_MESSAGE =
  'Claude in ShipCode supports None, Medium, and High thinking budgets.';
const FABLE_REASONING_SUPPORT_MESSAGE =
  'Fable 5 always uses adaptive thinking; ShipCode supports Medium and High thinking budgets for it.';

export interface ProviderReasoningEffortResolution {
  configured: ReasoningEffort;
  effective: ReasoningEffort;
  exact: boolean;
  message: string | null;
}

export function formatReasoningEffortLabel(effort: ReasoningEffort): string {
  return REASONING_EFFORT_LABELS[effort];
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
    if (normalizedModelId && CLAUDE_ALWAYS_THINKING_MODELS.has(normalizedModelId)) {
      return CLAUDE_ALWAYS_THINKING_EFFORTS;
    }
    return CLAUDE_REASONING_EFFORTS;
  }

  if (provider === 'codex') {
    return CODEX_REASONING_EFFORTS;
  }

  if (provider === 'gemini') {
    return GEMINI_REASONING_EFFORTS;
  }

  if (provider === 'cursor') {
    return CURSOR_REASONING_EFFORTS;
  }

  if (provider === 'grok') {
    return GROK_REASONING_EFFORTS;
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
    if (normalizedModelId && CLAUDE_ALWAYS_THINKING_MODELS.has(normalizedModelId)) {
      switch (configured) {
        case 'none':
        case 'minimal':
        case 'low':
          return {
            configured,
            effective: 'medium',
            exact: false,
            message: `${FABLE_REASONING_SUPPORT_MESSAGE} Using ${formatReasoningEffortLabel('medium')}.`,
          };
        case 'xhigh':
          return {
            configured,
            effective: 'high',
            exact: false,
            message: `${FABLE_REASONING_SUPPORT_MESSAGE} Using ${formatReasoningEffortLabel('high')}.`,
          };
        default:
          return { configured, effective: configured, exact: true, message: null };
      }
    }

    switch (configured) {
      case 'minimal':
        return {
          configured,
          effective: 'none',
          exact: false,
          message: `${CLAUDE_REASONING_SUPPORT_MESSAGE} Using ${formatReasoningEffortLabel('none')}.`,
        };
      case 'low':
        return {
          configured,
          effective: 'none',
          exact: false,
          message: `${CLAUDE_REASONING_SUPPORT_MESSAGE} Using ${formatReasoningEffortLabel('none')}.`,
        };
      case 'xhigh':
        return {
          configured,
          effective: 'high',
          exact: false,
          message: `${CLAUDE_REASONING_SUPPORT_MESSAGE} Using ${formatReasoningEffortLabel('high')}.`,
        };
      default:
        return { configured, effective: configured, exact: true, message: null };
    }
  }

  if (provider === 'codex') {
    if (configured === 'none' || configured === 'minimal') {
      return {
        configured,
        effective: 'low',
        exact: false,
        message: `${normalizedModelId ?? 'Codex'} supports Low, Medium, High, and Extra high reasoning effort. Using ${formatReasoningEffortLabel('low')}.`,
      };
    }
    return { configured, effective: configured, exact: true, message: null };
  }

  if (provider === 'gemini') {
    if (configured === 'none' || configured === 'minimal') {
      return {
        configured,
        effective: 'low',
        exact: false,
        message: `${normalizedModelId ?? 'Gemini'} supports Low, Medium, and High reasoning effort. Using ${formatReasoningEffortLabel('low')}.`,
      };
    }
    if (configured === 'xhigh') {
      return {
        configured,
        effective: 'high',
        exact: false,
        message: `${normalizedModelId ?? 'Gemini'} supports Low, Medium, and High reasoning effort. Using ${formatReasoningEffortLabel('high')}.`,
      };
    }
    return { configured, effective: configured, exact: true, message: null };
  }

  if (provider === 'cursor') {
    if (configured === 'none') {
      return { configured, effective: 'none', exact: true, message: null };
    }
    return {
      configured,
      effective: 'none',
      exact: false,
      message:
        'Cursor selects reasoning automatically per model; ShipCode does not send a reasoning effort.',
    };
  }

  if (provider === 'grok') {
    if (configured === 'none') {
      return { configured, effective: 'none', exact: true, message: null };
    }
    return {
      configured,
      effective: 'none',
      exact: false,
      message:
        'Grok selects reasoning automatically per model; ShipCode does not send a reasoning effort.',
    };
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
): ReasoningEffort {
  return resolveProviderReasoningEffort(provider, configured, modelId).effective;
}
