import {
  type AppSettings,
  assessCliModelAvailability,
  type ExecutorModel,
  formatProviderReasoningEffort,
  formatReasoningEffortLabel,
  getCapabilitySupportedReasoningEfforts,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipshitdev/ui';
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
  const inheritedModelOptions = getModelOptions(effectiveProvider, integrationStatus);
  const modelOptions = getModelOptions(selectedProvider, integrationStatus);
  const knownModelValues = new Set<string>(modelOptions.map((option) => option.value));
  const inheritedEffort = resolvePhaseReasoningEffort(settings, projectDraft, phase);
  const inheritedEffortResolution = resolveProviderReasoningEffort(
    effectiveProvider,
    inheritedEffort,
    inheritedModelId,
  );
  const supportedEfforts =
    selectedProvider === 'openrouter'
      ? getSupportedReasoningEfforts(selectedProvider, selectedModelId)
      : getCapabilitySupportedReasoningEfforts(
          integrationStatus,
          selectedProvider,
          selectedModelId,
        );
  const effortResolution =
    effortOverride === null
      ? null
      : resolveProviderReasoningEffort(selectedProvider, effortOverride, selectedModelId);
  const displayedEffortValue =
    effortOverride === null ? INHERIT_VALUE : (effortResolution?.effective ?? effortOverride);
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
  const cliModelAvailability =
    selectedProvider === 'openrouter'
      ? { available: true, message: null }
      : assessCliModelAvailability(integrationStatus, selectedProvider, selectedModelId);

  const inheritDescription = `Inherit currently uses ${formatInheritedSummary(
    settings,
    projectDraft,
    phase,
  )}.`;
  const providerSelectId = `project-${phase}-provider`;
  const modelSelectId = `project-${phase}-model`;
  const effortSelectId = `project-${phase}-effort`;
  const customModelId = `project-${phase}-custom-openrouter-model`;

  return (
    <section>
      <div className="mb-2 text-[13px] font-medium text-primary">{label}</div>
      <SettingsRow label="Provider" htmlFor={providerSelectId} description={inheritDescription}>
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
                  : (resolveProviderReasoningEffort(next as ExecutorModel, current[effortKey], null)
                      .effective as Project['plannerReasoningEffortOverride']),
            }));
            setModelValidation((current) => ({ ...current, [phase]: null }));
          }}
        >
          <SelectTrigger id={providerSelectId} className="w-[180px]">
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
      </SettingsRow>

      <SettingsRow label="Model" htmlFor={modelSelectId}>
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
          <SelectTrigger id={modelSelectId} className="w-[220px]">
            <SelectValue>
              {modelIdOverride === null ? (
                <InheritValueDisplay detail={inheritedModelLabel} />
              ) : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_VALUE}>Inherit ({inheritedModelLabel})</SelectItem>
            {modelIdOverride && !knownModelValues.has(modelIdOverride) ? (
              <SelectItem value={modelIdOverride} disabled={!cliModelAvailability.available}>
                {modelIdOverride}
                {!cliModelAvailability.available ? ' (Unavailable)' : ''}
              </SelectItem>
            ) : null}
            {modelOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={selectedProvider === 'claude' ? 'Thinking budget' : 'Effort'}
        htmlFor={effortSelectId}
      >
        <Select
          value={displayedEffortValue}
          onValueChange={(next) => {
            setOverrides((current) => ({
              ...current,
              [effortKey]:
                next === INHERIT_VALUE ? null : (next as Project['plannerReasoningEffortOverride']),
            }));
          }}
        >
          <SelectTrigger id={effortSelectId} className="w-[140px]">
            <SelectValue>
              {effortOverride === null ? (
                <InheritValueDisplay
                  detail={formatReasoningEffortLabel(inheritedEffortResolution.effective)}
                />
              ) : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_VALUE}>
              Inherit ({formatReasoningEffortLabel(inheritedEffortResolution.effective)})
            </SelectItem>
            {supportedEfforts.map((effort) => (
              <SelectItem key={effort} value={effort}>
                {formatReasoningEffortLabel(effort)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {selectedProvider === 'openrouter' && phase !== 'executor' ? (
        <SettingsRow
          label="Custom OpenRouter slug"
          htmlFor={customModelId}
          description="Enter a slug directly to override the curated presets for this project."
        >
          <Input
            id={customModelId}
            key={`${phase}-${modelIdOverride ?? ''}`}
            className="w-[260px]"
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
        </SettingsRow>
      ) : null}

      {providerWarning ? (
        <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {providerWarning}
        </div>
      ) : null}
      {!cliModelAvailability.available ? (
        <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
          {cliModelAvailability.message}
        </div>
      ) : null}
      {effortOverride !== null &&
      effortResolution &&
      !effortResolution.exact &&
      selectedProvider !== 'claude' ? (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {effortResolution.message}
        </div>
      ) : null}
      {effortOverride === null &&
      !inheritedEffortResolution.exact &&
      effectiveProvider !== 'claude' ? (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {`Current inherited ${PROVIDER_DISPLAY[effectiveProvider]} setting resolves to ${formatReasoningEffortLabel(
            formatProviderReasoningEffort(effectiveProvider, inheritedEffort, inheritedModelId),
          )}.`}
        </div>
      ) : null}
      {validationMessage ? (
        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          {validationMessage}
        </div>
      ) : null}
    </section>
  );
}
