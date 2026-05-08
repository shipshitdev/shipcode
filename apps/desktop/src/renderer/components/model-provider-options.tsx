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
  openrouter: 'OpenRouter',
};

export function getModelOptions(
  provider: ExecutorModel,
  integrationStatus?: IntegrationStatus,
): ReadonlyArray<{ value: string; label: string }> {
  if (provider === 'claude' || provider === 'codex' || provider === 'gemini') {
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

export function InheritValueDisplay({ detail }: { detail: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      <span className="text-muted-foreground">Inherit</span>
      <span className="text-muted-foreground">·</span>
      <span className="truncate text-primary">{detail}</span>
    </span>
  );
}
