import type { ResolvedPhaseModel } from './model-resolution';
import { resolveProviderReasoningEffort } from './reasoning-effort';
import type { AppSettings, ExecutorModel, Project, ReasoningEffort } from './types';

export type ModelConfigPresetKey = 'claude' | 'codex' | 'hybrid';

interface PhasePreset {
  provider: ExecutorModel;
  modelId: string | null;
  reasoningEffort: ReasoningEffort;
}

export interface ModelConfigPreset {
  key: ModelConfigPresetKey;
  label: string;
  description: string;
  phases: Record<ResolvedPhaseModel, PhasePreset>;
  prdRewrite: {
    cli: AppSettings['prdRewriteCli'];
    modelId: string | null;
    reasoningEffort: ReasoningEffort;
  };
}

export type ProjectModelPresetOverrides = Pick<
  Project,
  | 'plannerModelOverride'
  | 'reviewerModelOverride'
  | 'executorModelOverride'
  | 'verifierModelOverride'
  | 'plannerModelIdOverride'
  | 'reviewerModelIdOverride'
  | 'executorModelIdOverride'
  | 'verifierModelIdOverride'
  | 'plannerReasoningEffortOverride'
  | 'reviewerReasoningEffortOverride'
  | 'executorReasoningEffortOverride'
  | 'verifierReasoningEffortOverride'
>;

const CLAUDE_PHASE: PhasePreset = {
  provider: 'claude',
  modelId: 'claude-sonnet-4-6',
  reasoningEffort: 'high',
};

const CODEX_PHASE: PhasePreset = {
  provider: 'codex',
  modelId: 'gpt-5.4',
  reasoningEffort: 'high',
};

const SHARED_PRD_MODELS = {
  claude: 'claude-sonnet-4-6',
  codex: 'gpt-5.4-mini',
} as const;

export const MODEL_CONFIG_PRESETS: readonly ModelConfigPreset[] = [
  {
    key: 'claude',
    label: 'Claude',
    description: 'Anthropic across planning, review, execution, and verification.',
    phases: {
      planner: CLAUDE_PHASE,
      reviewer: CLAUDE_PHASE,
      executor: CLAUDE_PHASE,
      verifier: CLAUDE_PHASE,
    },
    prdRewrite: {
      cli: 'claude',
      modelId: SHARED_PRD_MODELS.claude,
      reasoningEffort: 'low',
    },
  },
  {
    key: 'codex',
    label: 'Codex',
    description: 'OpenAI across planning, review, execution, and verification.',
    phases: {
      planner: CODEX_PHASE,
      reviewer: CODEX_PHASE,
      executor: CODEX_PHASE,
      verifier: CODEX_PHASE,
    },
    prdRewrite: {
      cli: 'codex',
      modelId: SHARED_PRD_MODELS.codex,
      reasoningEffort: 'low',
    },
  },
  {
    key: 'hybrid',
    label: 'Hybrid',
    description: 'Claude for plan/execute/verify, Codex for review.',
    phases: {
      planner: CLAUDE_PHASE,
      reviewer: CODEX_PHASE,
      executor: CLAUDE_PHASE,
      verifier: CLAUDE_PHASE,
    },
    prdRewrite: {
      cli: 'claude',
      modelId: SHARED_PRD_MODELS.claude,
      reasoningEffort: 'low',
    },
  },
] as const;

const PRESET_BY_KEY = Object.fromEntries(
  MODEL_CONFIG_PRESETS.map((preset) => [preset.key, preset]),
) as Record<ModelConfigPresetKey, ModelConfigPreset>;

function getPresetPhaseEffort(phase: PhasePreset): ReasoningEffort {
  return resolveProviderReasoningEffort(phase.provider, phase.reasoningEffort, phase.modelId)
    .effective;
}

export function getModelConfigPreset(key: ModelConfigPresetKey): ModelConfigPreset {
  return PRESET_BY_KEY[key];
}

export function buildAppSettingsModelPresetPatch(key: ModelConfigPresetKey): Partial<AppSettings> {
  const preset = getModelConfigPreset(key);
  const prdRewriteEffort = resolveProviderReasoningEffort(
    preset.prdRewrite.cli,
    preset.prdRewrite.reasoningEffort,
    preset.prdRewrite.modelId,
  ).effective;

  return {
    plannerModel: preset.phases.planner.provider,
    reviewerModel: preset.phases.reviewer.provider,
    executorModel: preset.phases.executor.provider,
    verifierModel: preset.phases.verifier.provider,
    plannerReasoningEffort: getPresetPhaseEffort(preset.phases.planner),
    reviewerReasoningEffort: getPresetPhaseEffort(preset.phases.reviewer),
    executorReasoningEffort: getPresetPhaseEffort(preset.phases.executor),
    verifierReasoningEffort: getPresetPhaseEffort(preset.phases.verifier),
    prdRewriteCli: preset.prdRewrite.cli,
    prdRewriteClaudeModel: SHARED_PRD_MODELS.claude,
    prdRewriteCodexModel: SHARED_PRD_MODELS.codex,
    prdRewriteReasoningEffort: prdRewriteEffort,
  };
}

export function buildProjectModelPresetOverrides(
  key: ModelConfigPresetKey,
): ProjectModelPresetOverrides {
  const preset = getModelConfigPreset(key);

  return {
    plannerModelOverride: preset.phases.planner.provider,
    reviewerModelOverride: preset.phases.reviewer.provider,
    executorModelOverride: preset.phases.executor.provider,
    verifierModelOverride: preset.phases.verifier.provider,
    plannerModelIdOverride: preset.phases.planner.modelId,
    reviewerModelIdOverride: preset.phases.reviewer.modelId,
    executorModelIdOverride: preset.phases.executor.modelId,
    verifierModelIdOverride: preset.phases.verifier.modelId,
    plannerReasoningEffortOverride: getPresetPhaseEffort(preset.phases.planner),
    reviewerReasoningEffortOverride: getPresetPhaseEffort(preset.phases.reviewer),
    executorReasoningEffortOverride: getPresetPhaseEffort(preset.phases.executor),
    verifierReasoningEffortOverride: getPresetPhaseEffort(preset.phases.verifier),
  };
}
