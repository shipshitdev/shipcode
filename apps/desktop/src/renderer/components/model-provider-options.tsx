import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS,
  type ExecutorModel,
  getKnownModelLabel,
  OPENROUTER_MODEL_OPTIONS,
} from '@shipcode/shared';

export const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  openrouter: 'OpenRouter',
};

export function getModelOptions(
  provider: ExecutorModel,
): ReadonlyArray<{ value: string; label: string }> {
  if (provider === 'claude') return CLAUDE_MODEL_OPTIONS;
  if (provider === 'codex') return CODEX_MODEL_OPTIONS;
  return OPENROUTER_MODEL_OPTIONS;
}

export function formatProviderSelectionLabel(
  provider: ExecutorModel,
  modelId: string | null,
): string {
  const providerLabel = PROVIDER_DISPLAY[provider];
  const modelLabel = modelId
    ? (getModelOptions(provider).find((option) => option.value === modelId)?.label ?? modelId)
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
      <span className="text-muted">Inherit</span>
      <span className="text-muted">·</span>
      <span className="truncate text-primary">{detail}</span>
    </span>
  );
}
