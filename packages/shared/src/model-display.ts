import { sanitizeResolvedModel } from './model-identifiers';
import type { ExecutorModel } from './types';

export const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Claude',
  codex: 'Codex',
  openrouter: 'OpenRouter',
};

export const MODEL_DISPLAY: Record<string, string> = {
  claude: 'Sonnet 4.6',
  codex: 'GPT-5.4',
  openrouter: 'OpenRouter',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'openrouter/auto': 'Auto (paid)',
  'openrouter/free': 'Auto (free)',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'anthropic/claude-opus-4-6': 'Claude Opus 4.6',
  'anthropic/claude-opus-4.6': 'Claude Opus 4.6',
  'openai/gpt-5-codex': 'GPT-5 Codex',
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
  'qwen/qwen3-coder:free': 'Qwen 3 Coder Free',
};

const CODEX_MODEL_PATTERN = /^gpt-5(?:[.-]|$)/i;

function normalizeModel(value: string | null | undefined): string | null {
  const sanitized = sanitizeResolvedModel(value);
  if (!sanitized) return null;
  const trimmed = sanitized.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function modelDisplay(model: string): string {
  return MODEL_DISPLAY[model] ?? model;
}

export function providerDisplay(provider: ExecutorModel): string {
  return PROVIDER_DISPLAY[provider];
}

export function inferProviderFromModel(
  ...values: Array<string | null | undefined>
): ExecutorModel | null {
  for (const value of values) {
    const normalized = normalizeModel(value);
    if (!normalized) continue;

    if (normalized === 'claude' || normalized.startsWith('claude-')) {
      return 'claude';
    }

    if (normalized === 'codex' || CODEX_MODEL_PATTERN.test(normalized)) {
      return 'codex';
    }

    if (
      normalized === 'openrouter' ||
      normalized.startsWith('openrouter/') ||
      normalized.includes('/')
    ) {
      return 'openrouter';
    }
  }

  return null;
}

export function formatProviderModelDisplay(
  provider: ExecutorModel,
  modelId: string | null | undefined,
): string {
  const providerLabel = providerDisplay(provider);
  const normalizedModel = normalizeModel(modelId);
  if (!normalizedModel) return providerLabel;

  const modelLabel = modelDisplay(normalizedModel);
  if (modelLabel.toLowerCase().startsWith(providerLabel.toLowerCase())) {
    return modelLabel;
  }

  return `${providerLabel} / ${modelLabel}`;
}

function chooseDisplayModel(
  provider: ExecutorModel,
  requestedModel: string | null | undefined,
  resolvedModel: string | null | undefined,
): string | null {
  const requested = normalizeModel(requestedModel);
  const resolved = normalizeModel(resolvedModel);

  if (provider === 'openrouter') {
    return resolved ?? requested;
  }

  if (requested && requested !== provider && inferProviderFromModel(requested) === provider) {
    return requested;
  }

  if (resolved && resolved !== provider && inferProviderFromModel(resolved) === provider) {
    return resolved;
  }

  return resolved ?? requested;
}

export function formatResolvedModelDisplay(
  requestedModel: string | null | undefined,
  resolvedModel: string | null | undefined,
): string | null {
  const provider = inferProviderFromModel(resolvedModel, requestedModel);
  if (!provider) {
    const fallback = normalizeModel(resolvedModel) ?? normalizeModel(requestedModel);
    return fallback ? modelDisplay(fallback) : null;
  }

  return formatProviderModelDisplay(
    provider,
    chooseDisplayModel(provider, requestedModel, resolvedModel),
  );
}
