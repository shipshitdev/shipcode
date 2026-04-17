import {
  type AppSettings,
  type ExecutorModel,
  formatProviderReasoningEffort,
  getSupportedReasoningEfforts,
  type IntegrationStatus,
  type OpenRouterModelValidation,
  type Project,
  resolvePhaseModel,
  resolvePhaseModelId,
  resolvePhaseReasoningEffort,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';
import type { Dispatch, SetStateAction } from 'react';
import {
  formatModelInheritanceLabel,
  getModelOptions,
  InheritValueDisplay,
  PROVIDER_DISPLAY,
} from '../model-provider-options';
import {
  EFFORT_OVERRIDE_KEYS,
  formatInheritedSummary,
  INHERIT_VALUE,
  MODEL_ID_OVERRIDE_KEYS,
  type PhaseKey,
  PROVIDER_OVERRIDE_KEYS,
  type ProjectOverrideState,
} from './shared';

function asExecutorModel(value: Project['plannerModelOverride']): ExecutorModel | null {
  if (value === 'claude' || value === 'codex' || value === 'openrouter') return value;
  return null;
}

export function ProjectPhaseSettingsRow({
  phase,
  label,
  validProviders,
  settings,
  projectDraft,
  overrides,
  setOverrides,
  integrationStatus,
  modelValidation,
  setModelValidation,
}: {
  phase: PhaseKey;
  label: string;
  validProviders: readonly ExecutorModel[];
  settings: AppSettings;
  projectDraft: Project;
  overrides: ProjectOverrideState;
  setOverrides: Dispatch<SetStateAction<ProjectOverrideState>>;
  integrationStatus: IntegrationStatus | undefined;
  modelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  setModelValidation: Dispatch<
    SetStateAction<Partial<Record<PhaseKey, OpenRouterModelValidation | null>>>
  >;
}) {
  const providerKey = PROVIDER_OVERRIDE_KEYS[phase];
  const modelIdKey = MODEL_ID_OVERRIDE_KEYS[phase];
  const effortKey = EFFORT_OVERRIDE_KEYS[phase];

  const providerOverride = overrides[providerKey];
  const modelIdOverride = overrides[modelIdKey];
  const effortOverride = overrides[effortKey];

  const effectiveProvider = resolvePhaseModel(settings, projectDraft, phase);
  const inheritedModelId = resolvePhaseModelId(settings, projectDraft, phase);
  const selectedProvider = asExecutorModel(providerOverride) ?? effectiveProvider;
  const selectedModelId =
    modelIdOverride ?? (selectedProvider === effectiveProvider ? inheritedModelId : null);
  const inheritedModelOptions = getModelOptions(effectiveProvider);
  const modelOptions = getModelOptions(selectedProvider);
  const knownModelValues = new Set<string>(modelOptions.map((option) => option.value));
  const inheritedEffort = resolvePhaseReasoningEffort(settings, projectDraft, phase);
  const inheritedEffortResolution = resolveProviderReasoningEffort(
    effectiveProvider,
    inheritedEffort,
    inheritedModelId,
  );
  const supportedEfforts = getSupportedReasoningEfforts(selectedProvider, selectedModelId);
  const effortResolution =
    effortOverride === null
      ? null
      : resolveProviderReasoningEffort(selectedProvider, effortOverride, selectedModelId);
  const inheritedModelLabel = formatModelInheritanceLabel(
    effectiveProvider,
    inheritedModelId,
    inheritedModelOptions,
  );
  const providerWarning =
    selectedProvider === 'openrouter'
      ? integrationStatus?.openrouter.authStatus !== 'valid'
        ? (integrationStatus?.openrouter.message ?? 'OpenRouter is not ready')
        : null
      : null;
  const validationMessage =
    modelValidation[phase] && modelValidation[phase]?.status !== 'valid'
      ? modelValidation[phase]?.message
      : null;

  return (
    <div className="rounded-md border border-border bg-secondary/50 p-3">
      <div className="mb-3">
        <div className="text-[13px] font-medium text-primary">{label}</div>
        <div className="text-[11px] text-muted">
          Inherit currently uses {formatInheritedSummary(settings, projectDraft, phase)}.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">Provider</Label>
          <Select
            value={providerOverride ?? INHERIT_VALUE}
            onValueChange={(next) => {
              setOverrides((current) => ({
                ...current,
                [providerKey]: next === INHERIT_VALUE ? null : (next as ExecutorModel),
                [modelIdKey]: null,
                [effortKey]:
                  next === INHERIT_VALUE || current[effortKey] === null
                    ? current[effortKey]
                    : (resolveProviderReasoningEffort(
                        next as ExecutorModel,
                        current[effortKey],
                        null,
                      ).effective as Project['plannerReasoningEffortOverride']),
              }));
              setModelValidation((current) => ({ ...current, [phase]: null }));
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {providerOverride === null ? (
                  <InheritValueDisplay detail={PROVIDER_DISPLAY[effectiveProvider]} />
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>
                Inherit ({PROVIDER_DISPLAY[effectiveProvider]})
              </SelectItem>
              {validProviders.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {PROVIDER_DISPLAY[provider]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">Model</Label>
          <Select
            value={modelIdOverride ?? INHERIT_VALUE}
            onValueChange={(next) => {
              const nextModelId = next === INHERIT_VALUE ? null : next;
              setOverrides((current) => ({
                ...current,
                [modelIdKey]: nextModelId,
                [effortKey]:
                  current[effortKey] === null
                    ? null
                    : (resolveProviderReasoningEffort(
                        selectedProvider,
                        current[effortKey],
                        nextModelId,
                      ).effective as Project['plannerReasoningEffortOverride']),
              }));
              setModelValidation((current) => ({ ...current, [phase]: null }));
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {modelIdOverride === null ? (
                  <InheritValueDisplay detail={inheritedModelLabel} />
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>Inherit ({inheritedModelLabel})</SelectItem>
              {modelIdOverride && !knownModelValues.has(modelIdOverride) ? (
                <SelectItem value={modelIdOverride}>{modelIdOverride}</SelectItem>
              ) : null}
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">
            {selectedProvider === 'claude' ? 'Thinking budget' : 'Effort'}
          </Label>
          <Select
            value={effortOverride ?? INHERIT_VALUE}
            onValueChange={(next) => {
              setOverrides((current) => ({
                ...current,
                [effortKey]:
                  next === INHERIT_VALUE
                    ? null
                    : (next as Project['plannerReasoningEffortOverride']),
              }));
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {effortOverride === null ? (
                  <InheritValueDisplay detail={inheritedEffortResolution.effective} />
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT_VALUE}>
                Inherit ({inheritedEffortResolution.effective})
              </SelectItem>
              {effortOverride && effortResolution && !effortResolution.exact ? (
                <SelectItem value={effortOverride}>
                  {`${effortOverride} (maps to ${effortResolution.effective})`}
                </SelectItem>
              ) : null}
              {supportedEfforts.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedProvider === 'openrouter' && phase !== 'executor' ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <Label className="text-[11px] text-secondary">Custom OpenRouter model slug</Label>
          <Input
            key={`${phase}-${modelIdOverride ?? ''}`}
            placeholder="e.g. anthropic/claude-sonnet-4.6"
            defaultValue={modelIdOverride ?? ''}
            onBlur={async (e) => {
              const next = e.target.value.trim() || null;
              setOverrides((current) => ({
                ...current,
                [modelIdKey]: next,
                [effortKey]:
                  current[effortKey] === null
                    ? null
                    : (resolveProviderReasoningEffort(selectedProvider, current[effortKey], next)
                        .effective as Project['plannerReasoningEffortOverride']),
              }));
              if (!next) {
                setModelValidation((current) => ({ ...current, [phase]: null }));
                return;
              }
              const validation = await window.shipcode.invoke<OpenRouterModelValidation>(
                'integrations:validate-openrouter-model',
                { modelId: next },
              );
              setModelValidation((current) => ({ ...current, [phase]: validation }));
            }}
          />
          <p className="text-[11px] text-muted">
            Enter a slug directly to override the curated presets for this project.
          </p>
        </div>
      ) : null}

      {providerWarning ? (
        <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {providerWarning}
        </div>
      ) : null}
      {effortOverride !== null && effortResolution && !effortResolution.exact ? (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {effortResolution.message}
        </div>
      ) : null}
      {effortOverride === null && !inheritedEffortResolution.exact ? (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {`Inherited ${inheritedEffort} maps to ${formatProviderReasoningEffort(
            effectiveProvider,
            inheritedEffort,
            inheritedModelId,
          )} for ${PROVIDER_DISPLAY[effectiveProvider]}.`}
        </div>
      ) : null}
      {validationMessage ? (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {validationMessage}
        </div>
      ) : null}
    </div>
  );
}
