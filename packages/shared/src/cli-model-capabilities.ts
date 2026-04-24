import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  type KnownModelOption,
} from './model-catalog';
import { getSupportedReasoningEfforts } from './reasoning-effort';
import type {
  CliModelCapabilities,
  CliModelCapabilityOption,
  ExecutorModel,
  GeneratorCli,
  IntegrationStatus,
  ReasoningEffort,
} from './types';

export interface ModelAvailabilityAssessment {
  available: boolean;
  message: string | null;
}

function optionToCapability(
  provider: GeneratorCli,
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
  provider: GeneratorCli,
  checkedAt = new Date(0).toISOString(),
): CliModelCapabilities {
  const options = provider === 'claude' ? CLAUDE_MODEL_OPTIONS : CODEX_FALLBACK_MODEL_OPTIONS;
  return {
    provider,
    source: 'fallback',
    models: options.map((option) => optionToCapability(provider, option)),
    error:
      provider === 'claude'
        ? null
        : 'Codex model catalog could not be read; using conservative ShipCode presets.',
    checkedAt,
  };
}

export function getProviderModelCapabilities(
  integrationStatus: IntegrationStatus | undefined,
  provider: Extract<ExecutorModel, 'claude' | 'codex'>,
): CliModelCapabilities {
  return getProviderModelCapabilitiesFromMap(integrationStatus?.modelCapabilities, provider);
}

export function getProviderModelCapabilitiesFromMap(
  modelCapabilities: Partial<Record<GeneratorCli, CliModelCapabilities>> | null | undefined,
  provider: Extract<ExecutorModel, 'claude' | 'codex'>,
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
  modelCapabilities: Partial<Record<GeneratorCli, CliModelCapabilities>> | null | undefined,
  provider: Extract<ExecutorModel, 'claude' | 'codex'>,
  modelId: string | null | undefined,
): ModelAvailabilityAssessment {
  if (!modelId) return { available: true, message: null };
  const capabilities = getProviderModelCapabilitiesFromMap(modelCapabilities, provider);
  if (capabilities.models.some((option) => option.value === modelId)) {
    return { available: true, message: null };
  }

  const providerLabel = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
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
  modelCapabilities: Partial<Record<GeneratorCli, CliModelCapabilities>> | null | undefined,
  provider: Extract<ExecutorModel, 'claude' | 'codex'>,
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
    message: `${provider === 'claude' ? 'Claude CLI' : 'Codex CLI'} does not report ${effort} effort${modelLabel}. Choose a supported effort or update the CLI.`,
  };
}

export function assessCliSelectionAvailabilityFromCapabilities(
  modelCapabilities: Partial<Record<GeneratorCli, CliModelCapabilities>> | null | undefined,
  provider: Extract<ExecutorModel, 'claude' | 'codex'>,
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
