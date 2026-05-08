import { getKnownModelLabel, KNOWN_MODEL_LABELS } from './model-catalog';
import { sanitizeResolvedModel } from './model-identifiers';
import type { ExecutorModel } from './types';

export const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
};

export const MODEL_DISPLAY: Record<string, string> = { ...KNOWN_MODEL_LABELS };

const CODEX_MODEL_PATTERN = /^gpt-5(?:[.-]|$)/i;
const GEMINI_MODEL_PATTERN = /^gemini(?:[.-]|$)/i;

function normalizeModel(value: string | null | undefined): string | null {
  const sanitized = sanitizeResolvedModel(value);
  if (!sanitized) return null;
  const trimmed = sanitized.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function modelDisplay(model: string): string {
  return getKnownModelLabel(model) ?? model;
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

    if (normalized === 'gemini' || GEMINI_MODEL_PATTERN.test(normalized)) {
      return 'gemini';
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
