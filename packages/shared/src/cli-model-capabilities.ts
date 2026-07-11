import {
  CLI_PROVIDER_FALLBACK_OPTIONS,
  CLI_PROVIDER_LABELS,
  type KnownModelOption,
} from './model-catalog';
import { getSupportedReasoningEfforts } from './reasoning-effort';
import type {
  CliModelCapabilities,
  CliModelCapabilityOption,
  ExecutorModel,
  IntegrationStatus,
  PhaseCliProvider,
  ReasoningEffort,
} from './types';

export interface ModelAvailabilityAssessment {
  available: boolean;
  message: string | null;
}

function optionToCapability(
  provider: PhaseCliProvider,
  option: KnownModelOption,
): CliModelCapabilityOption {
  return {
    value: option.value,
    label: option.label,
    description: null,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [...getSupportedReasoningEfforts(provider, option.value)],
  };
}

export function fallbackCliModelCapabilities(
  provider: PhaseCliProvider,
  checkedAt = new Date(0).toISOString(),
): CliModelCapabilities {
  const options = CLI_PROVIDER_FALLBACK_OPTIONS[provider];
  return {
    provider,
    source: 'fallback',
    models: options.map((option) => optionToCapability(provider, option)),
    error:
      provider === 'claude'
        ? null
        : provider === 'codex'
          ? 'Codex model catalog could not be read; using conservative ShipCode presets.'
          : provider === 'gemini'
            ? 'Gemini model catalog could not be read; using conservative ShipCode presets.'
            : null,
    checkedAt,
  };
}

export function getProviderModelCapabilities(
  integrationStatus: IntegrationStatus | undefined,
  provider: PhaseCliProvider,
): CliModelCapabilities {
  return getProviderModelCapabilitiesFromMap(integrationStatus?.modelCapabilities, provider);
}

export function getProviderModelCapabilitiesFromMap(
  modelCapabilities: Partial<Record<PhaseCliProvider, CliModelCapabilities>> | null | undefined,
  provider: PhaseCliProvider,
): CliModelCapabilities {
  return (
    modelCapabilities?.[provider] ??
    fallbackCliModelCapabilities(provider, new Date(0).toISOString())
  );
}

export function getCapabilityModelOptions(
  integrationStatus: IntegrationStatus | undefined,
  provider: ExecutorModel,
): ReadonlyArray<CliModelCapabilityOption> {
  if (provider === 'openrouter') return [];
  return getProviderModelCapabilities(integrationStatus, provider).models;
}

export function getCapabilitySupportedReasoningEfforts(
  integrationStatus: IntegrationStatus | undefined,
  provider: ExecutorModel,
  modelId: string | null | undefined,
): readonly ReasoningEffort[] {
  if (provider === 'openrouter') return getSupportedReasoningEfforts(provider, modelId);
  const capabilities = getProviderModelCapabilities(integrationStatus, provider);
  const model = modelId
    ? capabilities.models.find((option) => option.value === modelId)
    : capabilities.models[0];
  return model?.supportedReasoningEfforts ?? getSupportedReasoningEfforts(provider, modelId);
}

export function assessCliModelAvailability(
  integrationStatus: IntegrationStatus | undefined,
  provider: ExecutorModel,
  modelId: string | null | undefined,
): ModelAvailabilityAssessment {
  if (provider === 'openrouter' || !modelId) return { available: true, message: null };
  return assessCliModelAvailabilityFromCapabilities(
    integrationStatus?.modelCapabilities,
    provider,
    modelId,
  );
}

export function assessCliModelAvailabilityFromCapabilities(
  modelCapabilities: Partial<Record<PhaseCliProvider, CliModelCapabilities>> | null | undefined,
  provider: PhaseCliProvider,
  modelId: string | null | undefined,
): ModelAvailabilityAssessment {
  if (!modelId) return { available: true, message: null };
  const capabilities = getProviderModelCapabilitiesFromMap(modelCapabilities, provider);
  if (capabilities.models.some((option) => option.value === modelId)) {
    return { available: true, message: null };
  }

  const providerLabel = CLI_PROVIDER_LABELS[provider];
  const sourceDetail =
    capabilities.source === 'catalog'
      ? 'installed CLI catalog'
      : capabilities.source === 'fallback'
        ? 'available fallback presets'
        : 'installed CLI';
  return {
    available: false,
    message: `${modelId} is not reported by the ${sourceDetail}. Update ${providerLabel} or choose another model.`,
  };
}

export function assessCliReasoningEffortAvailability(
  integrationStatus: IntegrationStatus | undefined,
  provider: ExecutorModel,
  modelId: string | null | undefined,
  effort: ReasoningEffort,
): ModelAvailabilityAssessment {
  if (provider === 'openrouter') return { available: true, message: null };
  return assessCliReasoningEffortAvailabilityFromCapabilities(
    integrationStatus?.modelCapabilities,
    provider,
    modelId,
    effort,
  );
}

export function assessCliReasoningEffortAvailabilityFromCapabilities(
  modelCapabilities: Partial<Record<PhaseCliProvider, CliModelCapabilities>> | null | undefined,
  provider: PhaseCliProvider,
  modelId: string | null | undefined,
  effort: ReasoningEffort,
): ModelAvailabilityAssessment {
  const capabilities = getProviderModelCapabilitiesFromMap(modelCapabilities, provider);
  const model = modelId
    ? capabilities.models.find((option) => option.value === modelId)
    : capabilities.models[0];
  const supported =
    model?.supportedReasoningEfforts ?? getSupportedReasoningEfforts(provider, modelId);
  if (supported.includes(effort)) return { available: true, message: null };
  const modelLabel = modelId ? ` for ${modelId}` : '';
  return {
    available: false,
    message: `${CLI_PROVIDER_LABELS[provider]} does not report ${effort} effort${modelLabel}. Choose a supported effort or update the CLI.`,
  };
}

export function assessCliSelectionAvailabilityFromCapabilities(
  modelCapabilities: Partial<Record<PhaseCliProvider, CliModelCapabilities>> | null | undefined,
  provider: PhaseCliProvider,
  modelId: string | null | undefined,
  effort: ReasoningEffort,
): ModelAvailabilityAssessment {
  const model = assessCliModelAvailabilityFromCapabilities(modelCapabilities, provider, modelId);
  if (!model.available) return model;
  return assessCliReasoningEffortAvailabilityFromCapabilities(
    modelCapabilities,
    provider,
    modelId,
    effort,
  );
}
