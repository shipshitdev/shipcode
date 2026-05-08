import { CLAUDE_MODEL_IDS, PINNED_MODEL_DEFAULTS } from './model-catalog';
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

const DEFAULT_PHASE_EFFORTS: Record<ResolvedPhaseModel, ReasoningEffort> = {
  planner: 'xhigh',
  reviewer: 'high',
  executor: 'medium',
  verifier: 'high',
};

function makePhasePreset(
  provider: ExecutorModel,
  modelId: string,
  phase: ResolvedPhaseModel,
): PhasePreset {
  return {
    provider,
    modelId,
    reasoningEffort: resolveProviderReasoningEffort(provider, DEFAULT_PHASE_EFFORTS[phase], modelId)
      .effective,
  };
}

const SHARED_PRD_MODELS = {
  claude: PINNED_MODEL_DEFAULTS.claude.prdRewrite,
  codex: PINNED_MODEL_DEFAULTS.codex.prdRewrite,
} as const;
const SHARED_PHASE_MODELS = {
  claude: PINNED_MODEL_DEFAULTS.claude.phase,
  codex: PINNED_MODEL_DEFAULTS.codex.phase,
} as const;

export const MODEL_CONFIG_PRESETS: readonly ModelConfigPreset[] = [
  {
    key: 'claude',
    label: 'Claude',
    description: 'Anthropic across planning, review, execution, and verification.',
    phases: {
      planner: makePhasePreset('claude', CLAUDE_MODEL_IDS.sonnet46, 'planner'),
      reviewer: makePhasePreset('claude', CLAUDE_MODEL_IDS.sonnet46, 'reviewer'),
      executor: makePhasePreset('claude', CLAUDE_MODEL_IDS.sonnet46, 'executor'),
      verifier: makePhasePreset('claude', CLAUDE_MODEL_IDS.sonnet46, 'verifier'),
    },
    prdRewrite: {
      cli: 'claude',
      modelId: SHARED_PRD_MODELS.claude,
      reasoningEffort: 'none',
    },
  },
  {
    key: 'codex',
    label: 'Codex',
    description: 'OpenAI across planning, review, execution, and verification.',
    phases: {
      planner: makePhasePreset('codex', SHARED_PHASE_MODELS.codex, 'planner'),
      reviewer: makePhasePreset('codex', SHARED_PHASE_MODELS.codex, 'reviewer'),
      executor: makePhasePreset('codex', SHARED_PHASE_MODELS.codex, 'executor'),
      verifier: makePhasePreset('codex', SHARED_PHASE_MODELS.codex, 'verifier'),
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
      planner: makePhasePreset('claude', SHARED_PHASE_MODELS.claude, 'planner'),
      reviewer: makePhasePreset('codex', SHARED_PHASE_MODELS.codex, 'reviewer'),
      executor: makePhasePreset('claude', SHARED_PHASE_MODELS.claude, 'executor'),
      verifier: makePhasePreset('claude', SHARED_PHASE_MODELS.claude, 'verifier'),
    },
    prdRewrite: {
      cli: 'claude',
      modelId: SHARED_PRD_MODELS.claude,
      reasoningEffort: 'none',
    },
  },
] as const;

const PRESET_BY_KEY = Object.fromEntries(
  MODEL_CONFIG_PRESETS.map((preset) => [preset.key, preset]),
) as Record<ModelConfigPresetKey, ModelConfigPreset>;

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
    plannerReasoningEffort: preset.phases.planner.reasoningEffort,
    reviewerReasoningEffort: preset.phases.reviewer.reasoningEffort,
    executorReasoningEffort: preset.phases.executor.reasoningEffort,
    verifierReasoningEffort: preset.phases.verifier.reasoningEffort,
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
    plannerReasoningEffortOverride: preset.phases.planner.reasoningEffort,
    reviewerReasoningEffortOverride: preset.phases.reviewer.reasoningEffort,
    executorReasoningEffortOverride: preset.phases.executor.reasoningEffort,
    verifierReasoningEffortOverride: preset.phases.verifier.reasoningEffort,
  };
}
