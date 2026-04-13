import type { ExecutorModel } from '@shipcode/shared';

export const PROVIDER_DISPLAY: Record<ExecutorModel, string> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  openrouter: 'OpenRouter',
};

export const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const;

export const CODEX_MODELS = [
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
] as const;

export const OPENROUTER_MODELS = [
  { value: 'openrouter/auto', label: 'Auto (paid)' },
  { value: 'openrouter/free', label: 'Auto (free)' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'qwen/qwen3.6-plus', label: 'Qwen 3.6 Plus' },
  { value: 'qwen/qwen3-coder:free', label: 'Qwen 3 Coder Free' },
] as const;

export function getModelOptions(
  provider: ExecutorModel,
): ReadonlyArray<{ value: string; label: string }> {
  if (provider === 'claude') return CLAUDE_MODELS;
  if (provider === 'codex') return CODEX_MODELS;
  return OPENROUTER_MODELS;
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
  return modelOptions.find((option) => option.value === modelId)?.label ?? modelId;
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
