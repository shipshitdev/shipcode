import {
  CLAUDE_MODEL_IDS,
  CLAUDE_ROLLING_MODEL_ALIASES,
  OPENROUTER_MODEL_IDS,
} from './model-catalog';
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
const CLAUDE_ALWAYS_THINKING_MODELS = new Set<string>([
  CLAUDE_MODEL_IDS.fable5,
  CLAUDE_ROLLING_MODEL_ALIASES.fable,
]);
const OPENROUTER_ADAPTIVE_CLAUDE_EFFORTS = [
  'none',
  'high',
] as const satisfies readonly ReasoningEffort[];

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'anthropic/claude-sonnet-4-6': OPENROUTER_MODEL_IDS.claudeSonnet46,
  'anthropic/claude-opus-4-6': OPENROUTER_MODEL_IDS.claudeOpus46,
  'anthropic/claude-opus-4-8': OPENROUTER_MODEL_IDS.claudeOpus48,
};

// Anthropic models ShipCode treats as adaptive over OpenRouter: it offers `none` or `high`
// and sends nothing more granular.
//
// Live catalog note (2026-08-17): OpenRouter advertises `reasoning_effort` and a
// `supported_efforts` list for all three of these (`max`/`high`/`medium`/`low`, plus `xhigh`
// on Opus 4.8), so the effort is *not* ignored upstream the way this set assumes — the
// two-value offer is coarser than what the models accept. That is pre-existing behaviour and
// changing it moves the wire payload for saved selections, so it is left alone here and
// tracked separately; only Fable 5 was corrected, because this PR is what put it on this
// path. Anything added to this set from now on needs its live `reasoning` metadata checked
// first, exactly as the catalog itself does.
const OPENROUTER_ADAPTIVE_CLAUDE_MODELS = new Set<string>([
  OPENROUTER_MODEL_IDS.claudeSonnet46,
  OPENROUTER_MODEL_IDS.claudeOpus46,
  OPENROUTER_MODEL_IDS.claudeOpus48,
]);

// OpenRouter reports `anthropic/claude-fable-5` as `reasoning.mandatory: true` with
// `supported_efforts: ["max","xhigh","high","medium","low"]` and `default_effort: "high"`
// (live catalog, 2026-08-17). Two consequences, both of which cost this model a place in the
// adaptive set above:
//
//   1. `none` is not a value the model accepts, and the reasoning cannot be switched off, so
//      offering `none` would promise something the wire cannot deliver.
//   2. The remaining efforts are honoured rather than ignored, so clamping every non-none
//      value to `high` would throw away a control the model actually exposes.
//
// `max` has no ShipCode equivalent, so the offer list is the four levels the
// `ReasoningEffort` union can express. Below-floor selections land on `low` — the same
// nearest-supported rule Codex and Gemini use — rather than on `default_effort`, so asking
// for less reasoning never silently asks for more.
const OPENROUTER_MANDATORY_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];
const OPENROUTER_MANDATORY_REASONING_MODELS = new Set<string>([OPENROUTER_MODEL_IDS.claudeFable5]);
const OPENROUTER_MANDATORY_REASONING_MESSAGE =
  'always reasons on OpenRouter and supports Low, Medium, High, and Extra high effort.';

// No curated OpenRouter model currently lacks reasoning support. The set, its `['none']`
// effort list, and both call sites were removed with `qwen/qwen3-coder:free` (the sole
// member, delisted upstream) rather than left empty: an empty Set makes every lookup dead
// code that reads as if a case is still handled. Re-add the pair if a curated model turns up
// with no reasoning controls — the shape to restore is in git history for this line.
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

  if (normalizedModelId && OPENROUTER_MANDATORY_REASONING_MODELS.has(normalizedModelId)) {
    return OPENROUTER_MANDATORY_REASONING_EFFORTS;
  }

  if (normalizedModelId && OPENROUTER_ADAPTIVE_CLAUDE_MODELS.has(normalizedModelId)) {
    return OPENROUTER_ADAPTIVE_CLAUDE_EFFORTS;
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

  if (normalizedModelId && OPENROUTER_MANDATORY_REASONING_MODELS.has(normalizedModelId)) {
    if (configured === 'none' || configured === 'minimal') {
      return {
        configured,
        effective: 'low',
        exact: false,
        message: `${normalizedModelId} ${OPENROUTER_MANDATORY_REASONING_MESSAGE} Using ${formatReasoningEffortLabel('low')}.`,
      };
    }
    return { configured, effective: configured, exact: true, message: null };
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
