import type { ExecutorModel, OpenRouterModelCheck } from '@shipcode/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipcode/ui';
import { getModelOptions, PROVIDER_DISPLAY } from '../model-provider-options';

export function PhaseModelRow({
  label,
  htmlFor,
  modelValue,
  openrouterModelValue,
  reasoningEffortValue,
  validProviders,
  onModelChange,
  onOpenrouterModelChange,
  onReasoningEffortChange,
  disabledProviders,
  warningMessage,
  modelCheck,
}: {
  label: string;
  htmlFor: string;
  modelValue: string;
  openrouterModelValue: string | null;
  reasoningEffortValue: 'low' | 'medium' | 'high';
  validProviders: ExecutorModel[];
  onModelChange: (value: string) => void;
  onOpenrouterModelChange: (value: string | null) => void;
  onReasoningEffortChange: (value: 'low' | 'medium' | 'high') => void;
  disabledProviders?: Partial<Record<ExecutorModel, string>>;
  warningMessage?: string | null;
  modelCheck?: OpenRouterModelCheck | null;
}) {
  const modelCheckMessage =
    modelValue === 'openrouter' && modelCheck?.status !== 'not_configured'
      ? modelCheck?.message
      : null;
  const openrouterModelOptions = getModelOptions('openrouter');
  const knownOpenRouterValues = new Set(openrouterModelOptions.map((option) => option.value));
  const openrouterSelection = openrouterModelValue ?? '__default__';

  return (
    <>
      <SettingsRow label={label} htmlFor={htmlFor}>
        <Select value={modelValue} onValueChange={onModelChange}>
          <SelectTrigger id={htmlFor} className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {validProviders.includes('claude') && (
              <SelectItem value="claude" disabled={!!disabledProviders?.claude}>
                Anthropic{disabledProviders?.claude ? ` (${disabledProviders.claude})` : ''}
              </SelectItem>
            )}
            {validProviders.includes('codex') && (
              <SelectItem value="codex" disabled={!!disabledProviders?.codex}>
                OpenAI{disabledProviders?.codex ? ` (${disabledProviders.codex})` : ''}
              </SelectItem>
            )}
            {validProviders.includes('openrouter') && (
              <SelectItem value="openrouter" disabled={!!disabledProviders?.openrouter}>
                OpenRouter
                {disabledProviders?.openrouter ? ` (${disabledProviders.openrouter})` : ''}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>
      {modelValue === 'openrouter' && (
        <SettingsRow label="OpenRouter model" htmlFor={`${htmlFor}-or-model`}>
          <Select
            value={openrouterSelection}
            onValueChange={(value) =>
              onOpenrouterModelChange(value === '__default__' ? null : value)
            }
          >
            <SelectTrigger id={`${htmlFor}-or-model`} className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">
                Default paid model ({PROVIDER_DISPLAY.openrouter})
              </SelectItem>
              {openrouterModelValue && !knownOpenRouterValues.has(openrouterModelValue) ? (
                <SelectItem value={openrouterModelValue}>{openrouterModelValue}</SelectItem>
              ) : null}
              {openrouterModelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      )}
      {modelValue === 'openrouter' && (
        <SettingsRow
          label="Custom OpenRouter slug"
          htmlFor={`${htmlFor}-or-custom`}
          description="Optional raw slug override when the preset list is not enough."
        >
          <Input
            id={`${htmlFor}-or-custom`}
            placeholder="e.g. anthropic/claude-sonnet-4-6"
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
      <SettingsRow label="Reasoning effort" htmlFor={`${htmlFor}-reasoning`}>
        <Select
          value={reasoningEffortValue}
          onValueChange={(value) => onReasoningEffortChange(value as 'low' | 'medium' | 'high')}
        >
          <SelectTrigger id={`${htmlFor}-reasoning`} className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">low</SelectItem>
            <SelectItem value="medium">medium</SelectItem>
            <SelectItem value="high">high</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
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
