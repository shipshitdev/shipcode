import {
  type ExecutorModel,
  getCapabilityModelOptions,
  getKnownModelLabel,
  type IntegrationStatus,
  OPENROUTER_MODEL_OPTIONS,
} from '@shipcode/shared';

export const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  gemini: 'Google',
  cursor: 'Cursor',
  openrouter: 'OpenRouter',
};

export function getModelOptions(
  provider: ExecutorModel,
  integrationStatus?: IntegrationStatus,
): ReadonlyArray<{ value: string; label: string }> {
  if (
    provider === 'claude' ||
    provider === 'codex' ||
    provider === 'gemini' ||
    provider === 'cursor'
  ) {
    return getCapabilityModelOptions(integrationStatus, provider);
  }
  return OPENROUTER_MODEL_OPTIONS;
}

export function formatProviderSelectionLabel(
  provider: ExecutorModel,
  modelId: string | null,
  integrationStatus?: IntegrationStatus,
): string {
  const providerLabel = PROVIDER_DISPLAY[provider];
  const modelLabel = modelId
    ? (getModelOptions(provider, integrationStatus).find((option) => option.value === modelId)
        ?.label ?? modelId)
    : `${providerLabel} default`;
  return `${providerLabel} / ${modelLabel}`;
}

export function formatModelInheritanceLabel(
  _provider: ExecutorModel,
  modelId: string | null,
  modelOptions: ReadonlyArray<{ value: string; label: string }>,
): string {
  if (!modelId) return 'Default model';
  return (
    getKnownModelLabel(modelId) ??
    modelOptions.find((option) => option.value === modelId)?.label ??
    modelId
  );
}
