import {
  type ExecutorModel,
  formatReasoningEffortLabel,
  getCapabilitySupportedReasoningEfforts,
  getSupportedReasoningEfforts,
  type IntegrationStatus,
  type OpenRouterModelCheck,
  type ReasoningEffort,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import { SettingsSelectRow } from '@shipcode/ui';
import { Input, SettingsRow } from '@shipshitdev/ui';
import { getModelOptions, PROVIDER_DISPLAY } from '../model-provider-options-data';

const PHASE_PROVIDER_ORDER = [
  'claude',
  'codex',
  'gemini',
  'cursor',
  'openrouter',
] as const satisfies readonly ExecutorModel[];

export function PhaseModelRow({
  label,
  htmlFor,
  modelValue,
  openrouterModelValue,
  resolvedModelId,
  reasoningEffortValue,
  validProviders,
  onModelChange,
  onOpenrouterModelChange,
  onReasoningEffortChange,
  disabledProviders,
  warningMessage,
  modelCheck,
  integrationStatus,
}: {
  label: string;
  htmlFor: string;
  modelValue: string;
  openrouterModelValue: string | null;
  resolvedModelId?: string | null;
  reasoningEffortValue: ReasoningEffort;
  validProviders: ExecutorModel[];
  onModelChange: (value: string) => void;
  onOpenrouterModelChange: (value: string | null) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  disabledProviders?: Partial<Record<ExecutorModel, string>>;
  warningMessage?: string | null;
  modelCheck?: OpenRouterModelCheck | null;
  integrationStatus?: IntegrationStatus;
}) {
  const provider = modelValue as ExecutorModel;
  const modelCheckMessage =
    modelValue === 'openrouter' && modelCheck?.status !== 'not_configured'
      ? modelCheck?.message
      : null;
  const effortResolution = resolveProviderReasoningEffort(
    provider,
    reasoningEffortValue,
    resolvedModelId,
  );
  const displayedEffortValue = effortResolution.effective;
  const supportedEfforts =
    provider === 'openrouter'
      ? getSupportedReasoningEfforts(provider, resolvedModelId)
      : getCapabilitySupportedReasoningEfforts(integrationStatus, provider, resolvedModelId);
  const openrouterModelOptions = getModelOptions('openrouter', integrationStatus);
  const knownOpenRouterValues = new Set(openrouterModelOptions.map((option) => option.value));
  const openrouterSelection = openrouterModelValue ?? '__default__';

  return (
    <>
      <SettingsSelectRow
        id={htmlFor}
        label={label}
        value={modelValue}
        options={PHASE_PROVIDER_ORDER.filter((option) => validProviders.includes(option)).map(
          (option) => ({
            value: option,
            label: `${PROVIDER_DISPLAY[option]}${
              disabledProviders?.[option] ? ` (${disabledProviders[option]})` : ''
            }`,
            disabled: !!disabledProviders?.[option],
          }),
        )}
        onValueChange={onModelChange}
        triggerClassName="w-[160px]"
      />
      {modelValue === 'openrouter' && (
        <SettingsSelectRow
          id={`${htmlFor}-or-model`}
          label="OpenRouter model"
          value={openrouterSelection}
          options={[
            { value: '__default__', label: `Default paid model (${PROVIDER_DISPLAY.openrouter})` },
            ...(openrouterModelValue && !knownOpenRouterValues.has(openrouterModelValue)
              ? [{ value: openrouterModelValue, label: openrouterModelValue }]
              : []),
            ...openrouterModelOptions.map((option) => ({
              value: option.value,
              label: option.label,
            })),
          ]}
          onValueChange={(value) => onOpenrouterModelChange(value === '__default__' ? null : value)}
          triggerClassName="w-[220px]"
        />
      )}
      {modelValue === 'openrouter' && (
        <SettingsRow
          label="Custom OpenRouter slug"
          htmlFor={`${htmlFor}-or-custom`}
          description="Optional raw slug override when the preset list is not enough."
        >
          <Input
            id={`${htmlFor}-or-custom`}
            placeholder="e.g. anthropic/claude-sonnet-4.6"
            defaultValue={
              openrouterModelValue && !knownOpenRouterValues.has(openrouterModelValue)
                ? openrouterModelValue
                : ''
            }
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (!value) {
                if (openrouterModelValue && !knownOpenRouterValues.has(openrouterModelValue)) {
                  onOpenrouterModelChange(null);
                }
                return;
              }
              onOpenrouterModelChange(value);
            }}
          />
        </SettingsRow>
      )}
      <SettingsSelectRow
        id={`${htmlFor}-reasoning`}
        label={provider === 'claude' ? 'Thinking budget' : 'Reasoning effort'}
        value={displayedEffortValue}
        options={supportedEfforts.map((effort) => ({
          value: effort,
          label: formatReasoningEffortLabel(effort),
        }))}
        onValueChange={(value) => onReasoningEffortChange(value as ReasoningEffort)}
        triggerClassName="w-[120px]"
      />
      {!effortResolution.exact && provider !== 'claude' && (
        <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {effortResolution.message}
        </div>
      )}
      {warningMessage && (
        <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {warningMessage}
        </div>
      )}
      {modelCheckMessage && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-[11px] ${
            modelCheck?.status === 'invalid'
              ? 'border-red-500/20 bg-red-500/10 text-red-300'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
          }`}
        >
          {modelCheckMessage}
        </div>
      )}
    </>
  );
}
